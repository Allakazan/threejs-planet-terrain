import { Quaternion, Vector3 } from 'three'
import { MOUSE_SENSITIVITY, MOVE_DAMPING, ROLL_SPEED } from '../core/constants'
import type { PlayerState } from './PlayerState'
import { gearToSpeed } from './speedGears'
import type { LookDelta } from './usePointerLook'

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

// Scratch, module scope: nothing here allocates per frame.
const wish = new Vector3()
const target = new Vector3()
const rotation = new Quaternion()

/**
 * The original 6DOF flycam (docs/01), kept behind V for debugging the origin and
 * LOD without the ship's rules. Mouse look, Q/E roll, WASD + Space/Ctrl, wheel
 * picks the gear.
 */
export function stepFlycam(player: PlayerState, held: ReadonlySet<string>, look: LookDelta, dt: number): void {
  // --- orientation: local axes via post-multiplication ---
  if (look.x !== 0 || look.y !== 0) {
    rotation.setFromAxisAngle(AXIS_Y, -look.x * MOUSE_SENSITIVITY)
    player.quaternion.multiply(rotation)
    rotation.setFromAxisAngle(AXIS_X, -look.y * MOUSE_SENSITIVITY)
    player.quaternion.multiply(rotation)
  }

  let roll = 0
  if (held.has('KeyQ')) roll += 1
  if (held.has('KeyE')) roll -= 1
  if (roll !== 0) {
    rotation.setFromAxisAngle(AXIS_Z, roll * ROLL_SPEED * dt)
    player.quaternion.multiply(rotation)
  }
  // Hundreds of incremental multiplies per second drift off unit length.
  player.quaternion.normalize()

  // --- movement ---
  wish.set(0, 0, 0)
  if (held.has('KeyW')) wish.z -= 1
  if (held.has('KeyS')) wish.z += 1
  if (held.has('KeyD')) wish.x += 1
  if (held.has('KeyA')) wish.x -= 1
  if (held.has('Space')) wish.y += 1
  if (held.has('ControlLeft') || held.has('ControlRight')) wish.y -= 1

  if (wish.lengthSq() > 0) wish.normalize().applyQuaternion(player.quaternion)
  target.copy(wish).multiplyScalar(gearToSpeed(player.gear))

  // Exponential approach, framerate-independent, so stops aren't instant.
  player.velocity.lerp(target, 1 - Math.exp(-MOVE_DAMPING * dt))
  player.absPosition.addScaledVector(player.velocity, dt)
}
