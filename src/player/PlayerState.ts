import { Quaternion, Vector3 } from 'three'
import { CHASE_OFFSET, START_ABS_POSITION, START_GEAR, START_YAW } from '../core/constants'

const UP = new Vector3(0, 1, 0)
const offset = new Vector3()

export const ControlMode = { Ship: 'ship', Flycam: 'flycam' } as const
export type ControlMode = (typeof ControlMode)[keyof typeof ControlMode]

export const HyperState = { Idle: 'idle', Charging: 'charging', Engaged: 'engaged' } as const
export type HyperState = (typeof HyperState)[keyof typeof HyperState]

export const ThrustMode = {
  Coast: 'coast',
  Impulse: 'impulse',
  Cruise: 'cruise',
  Brake: 'brake',
  Reverse: 'reverse',
  Hyper: 'hyperdrive',
} as const
export type ThrustMode = (typeof ThrustMode)[keyof typeof ThrustMode]

/**
 * The player's authoritative state, mutated in place every frame. Never React
 * state — a 60 Hz `setState` would re-render the tree for nothing.
 *
 * In ship mode `absPosition` is the **ship**, not the camera: the floating
 * origin and the LOD split test both follow it. The camera is derived from it.
 *
 * Orientation is a quaternion, not Euler angles: rotations are applied about the
 * *local* axes (post-multiplication), which gives true 6DOF with no gimbal lock.
 */
export class PlayerState {
  readonly absPosition = new Vector3(...START_ABS_POSITION)
  readonly quaternion = new Quaternion().setFromAxisAngle(UP, START_YAW)
  readonly velocity = new Vector3()
  /** Flycam only. */
  gear = START_GEAR

  mode: ControlMode = ControlMode.Ship

  /** Local-frame rad/s: x pitch, y yaw, z roll. */
  readonly angularVelocity = new Vector3()
  /** Virtual stick, inside the unit disc. +x right, +y down (screen convention). */
  readonly reticle = { x: 0, y: 0 }
  /** Visual tilt of the mesh, radians. */
  bank = 0
  /** 0..1, drives the engine glow. */
  throttle = 0
  thrust: ThrustMode = ThrustMode.Coast
  /** Cap of the active thrust mode at this altitude, m/s. For the HUD. */
  speedCap = 0
  altitude = 0
  /** 0 above the atmosphere, 1 at the surface. */
  atmo = 0

  readonly hyper = {
    state: HyperState.Idle as HyperState,
    /** seconds charged so far */
    charge: 0,
    /** Locked at engage; the ship flies along it until dropping out. */
    dir: new Vector3(0, 0, -1),
    /** seconds left on the "too close to planet" warning */
    blocked: 0,
  }

  /** Lags `quaternion`; the chase camera's orientation. */
  readonly cameraQuat = new Quaternion().copy(this.quaternion)

  /** Hands over to the flycam exactly where the chase camera is, so nothing jumps. */
  enterFlycam(): void {
    offset.set(...CHASE_OFFSET).applyQuaternion(this.cameraQuat)
    this.absPosition.add(offset)
    this.quaternion.copy(this.cameraQuat)
    this.velocity.set(0, 0, 0)
    this.hyper.state = HyperState.Idle
    this.hyper.charge = 0
    this.mode = ControlMode.Flycam
  }

  /** Puts the ship ahead of the flycam, so the chase camera lands where the flycam was. */
  enterShip(): void {
    this.cameraQuat.copy(this.quaternion)
    offset.set(...CHASE_OFFSET).applyQuaternion(this.cameraQuat)
    this.absPosition.sub(offset)
    this.velocity.set(0, 0, 0)
    this.angularVelocity.set(0, 0, 0)
    this.reticle.x = 0
    this.reticle.y = 0
    this.bank = 0
    this.mode = ControlMode.Ship
  }
}

/**
 * Module scope for the same reason as the origin store: StrictMode cannot
 * duplicate it, and the HUD can read it without threading a ref out of the
 * Canvas.
 */
export const playerState = new PlayerState()
