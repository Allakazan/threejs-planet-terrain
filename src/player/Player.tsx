import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import type { Group } from 'three'
import { MAX_FRAME_DELTA, PRIORITY_PLAYER } from '../core/constants'
import { useOrigin } from '../core/originContext'
import { collisionPatches } from '../physics/collisionPatches'
import { groundGuard, resolveShipCollision } from '../physics/shipCollision'
import type { PlanetConfig } from '../planet/PlanetConfig'
import { updateChaseCamera } from './chaseCamera'
import { stepFlycam } from './flycam'
import { ControlMode, HyperState, playerState } from './PlayerState'
import { ShipModel } from './ShipModel'
import { stepShip } from './shipFlight'
import type { ShipInput } from './shipFlight'
import { useKeyboard } from './useKeyboard'
import { usePointerLook } from './usePointerLook'
import type { LookDelta } from './usePointerLook'

// Scratch, module scope: nothing here allocates per frame.
const look: LookDelta = { x: 0, y: 0 }
const input: ShipInput = {
  lookX: 0,
  lookY: 0,
  forward: false,
  cruise: false,
  brake: false,
  roll: 0,
  hyperHeld: false,
  hyperPressed: false,
}
const prevAbs = new Vector3()

type Props = {
  /** The planet whose atmosphere the ship flies in. */
  planet: PlanetConfig
}

/**
 * The player: a ship with a chase camera, or (V) the debug flycam. Runs at
 * priority -20, before every other system, so the LOD work later in the frame
 * sees this frame's position and post-rebase origin.
 *
 * `playerState.absPosition` is the *ship*: the floating origin follows it, and
 * the camera is derived from it. Owns the camera outright.
 */
export function Player({ planet }: Props) {
  const origin = useOrigin()
  const camera = useThree((s) => s.camera)
  const keys = useKeyboard()
  const drainLook = usePointerLook(playerState)
  const ship = useRef<Group>(null)
  // Previous frame's key state, for edge-triggered bindings.
  const prev = useRef({ space: false, v: false })
  const planets = useMemo(() => [planet], [planet])

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_FRAME_DELTA)
    const held = keys.current
    const player = playerState
    drainLook(look)

    const v = held.has('KeyV')
    const space = held.has('Space')
    const toggle = v && !prev.current.v
    const spacePressed = space && !prev.current.space
    prev.current.v = v
    prev.current.space = space

    if (toggle) {
      if (player.mode === ControlMode.Ship) player.enterFlycam()
      else player.enterShip()
    }

    if (player.mode === ControlMode.Flycam) {
      stepFlycam(player, held, look, dt)
      origin.update(player.absPosition)
      camera.position.copy(player.absPosition).sub(origin.origin)
      camera.quaternion.copy(player.quaternion)
      return
    }

    input.lookX = look.x
    input.lookY = look.y
    input.forward = held.has('KeyW')
    input.cruise = held.has('ShiftLeft') || held.has('ShiftRight')
    input.brake = held.has('KeyS')
    input.roll = (held.has('KeyA') ? 1 : 0) - (held.has('KeyD') ? 1 : 0)
    input.hyperHeld = space
    input.hyperPressed = spacePressed

    // --- tiles for this frame's path, the flight model, then collision (docs/05).
    // The patch runs first so the colliders it enables are flushed before the sweep.
    prevAbs.copy(player.absPosition)
    collisionPatches.update(planets, player.absPosition, player.velocity)
    stepShip(player, input, planet, dt)
    if (player.hyper.state !== HyperState.Engaged) {
      resolveShipCollision(player, prevAbs, planet, origin.origin)
      groundGuard(player, planet)
    }

    // --- origin, then ship and camera. Order matters: both must see the new origin.
    origin.update(player.absPosition)
    const group = ship.current
    if (group !== null) {
      group.position.copy(player.absPosition).sub(origin.origin)
      group.quaternion.copy(player.quaternion)
    }
    updateChaseCamera(player, origin.origin, camera, dt)
  }, PRIORITY_PLAYER)

  return <ShipModel ref={ship} />
}
