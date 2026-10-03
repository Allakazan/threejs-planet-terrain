import { Vector3 } from 'three'
import type { Camera } from 'three'
import { CAMERA_ROT_LAG, CHASE_OFFSET } from '../core/constants'
import type { PlayerState } from './PlayerState'

const offset = new Vector3()

/**
 * Places the camera behind the ship. Only the *orientation* lags (a slerp toward
 * the ship's); the position is rigidly `ship + cameraQuat · offset`.
 *
 * A world-space position lerp would leave the camera kilometres behind at cruise
 * and hyperdrive speeds. Deriving the position from the lagged orientation gives
 * the same swing in turns with no dependence on speed.
 *
 * Call after `origin.update()` — `origin` must be this frame's.
 */
export function updateChaseCamera(player: PlayerState, origin: Vector3, camera: Camera, dt: number): void {
  player.cameraQuat.slerp(player.quaternion, 1 - Math.exp(-CAMERA_ROT_LAG * dt))
  offset.set(...CHASE_OFFSET).applyQuaternion(player.cameraQuat)
  camera.position.copy(player.absPosition).sub(origin).add(offset)
  camera.quaternion.copy(player.cameraQuat)
}
