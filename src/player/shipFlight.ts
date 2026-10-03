import { Quaternion, Vector3 } from 'three'
import {
  ANGULAR_RESPONSE,
  ATMO_COAST_DRAG,
  ATMO_DRAG_LINEAR,
  ATMO_DRAG_QUAD,
  ATMOSPHERE_HEIGHT,
  AUTOLEVEL_MAX_DOT,
  AUTOLEVEL_MAX_RATE,
  AUTOLEVEL_RATE,
  BANK_RESPONSE,
  BRAKE_DECEL_MIN,
  BRAKE_RATE,
  HYPER_BLOCKED_TIME,
  HYPER_CHARGE_TIME,
  HYPER_EXIT_SPEED,
  HYPER_MIN_ALTITUDE,
  HYPER_SPEED,
  HYPER_SPOOL_TIME,
  LATERAL_DAMPING,
  MAX_BANK,
  MAX_PITCH_RATE,
  MAX_REVERSE_SPEED,
  MAX_YAW_RATE,
  RETICLE_DEADZONE,
  RETICLE_RECENTER,
  RETICLE_SENSITIVITY,
  REVERSE_ACCEL_TIME,
  SHIP_ROLL_SPEED,
  THROTTLE_RESPONSE,
  THRUST_CRUISE,
  THRUST_IMPULSE,
} from '../core/constants'
import type { PlanetConfig } from '../planet/PlanetConfig'
import { atmosphereFactor, blendCap, rayHitsSphere, segmentSphereEntry } from './atmosphere'
import { HyperState, ThrustMode } from './PlayerState'
import type { PlayerState } from './PlayerState'

/** One frame of ship controls, already read from the devices. */
export type ShipInput = {
  /** mouse pixels since last frame */
  lookX: number
  lookY: number
  forward: boolean
  cruise: boolean
  brake: boolean
  /** +1 = roll left (A), -1 = roll right (D) */
  roll: number
  hyperHeld: boolean
  /** rising edge of the hyperdrive key this frame */
  hyperPressed: boolean
}

/** What the ship needs to know about a planet. */
type Gravitating = Pick<PlanetConfig, 'centreAbs' | 'radius' | 'maxElevation'>

const FORWARD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)

const THROTTLE: Record<ThrustMode, number> = {
  coast: 0.1,
  impulse: 0.55,
  cruise: 1,
  brake: 0.05,
  reverse: 0.3,
  hyperdrive: 1,
}

// Scratch, module scope: nothing here allocates per frame.
const localUp = new Vector3()
const fwd = new Vector3()
const shipUp = new Vector3()
const proj = new Vector3()
const cross = new Vector3()
const lateral = new Vector3()
const omega = new Vector3()
const targetOmega = new Vector3()
const step = new Vector3()
const rotation = new Quaternion()

/** Exponential smoothing factor for rate `k` (1/s) over `dt`. */
function ease(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt)
}

/**
 * Advances the ship one frame: hyperdrive state, steering, thrust, drag, and the
 * swept atmosphere cutoff. Pure apart from mutating `ship`, and allocation-free.
 * See docs/03 for the model.
 */
export function stepShip(ship: PlayerState, input: ShipInput, planet: Gravitating, dt: number): void {
  // --- where are we ---
  localUp.copy(ship.absPosition).sub(planet.centreAbs)
  const dist = localUp.length()
  localUp.divideScalar(dist || 1)
  const altitude = dist - planet.radius
  const atmo = atmosphereFactor(altitude)
  ship.altitude = altitude
  ship.atmo = atmo

  fwd.copy(FORWARD).applyQuaternion(ship.quaternion)
  stepHyperdrive(ship, input, planet, altitude, dt)
  const engaged = ship.hyper.state === HyperState.Engaged

  if (engaged) {
    // Orientation is frozen along the locked direction; the reticle is parked.
    ship.reticle.x = 0
    ship.reticle.y = 0
    ship.angularVelocity.set(0, 0, 0)
    ship.bank += (0 - ship.bank) * ease(BANK_RESPONSE, dt)

    const speed = ship.velocity.length()
    const next = speed + (HYPER_SPEED - speed) * ease(1 / HYPER_SPOOL_TIME, dt)
    ship.velocity.copy(ship.hyper.dir).multiplyScalar(next)
    ship.thrust = ThrustMode.Hyper
    ship.speedCap = HYPER_SPEED
  } else {
    steer(ship, input, atmo, dt)
    fwd.copy(FORWARD).applyQuaternion(ship.quaternion)
    thrust(ship, input, atmo, dt)
  }

  ship.throttle += (THROTTLE[ship.thrust] - ship.throttle) * ease(THROTTLE_RESPONSE, dt)

  // --- integrate, with the atmosphere as a hard stop for the hyperdrive ---
  step.copy(ship.velocity).multiplyScalar(dt)
  if (engaged) {
    const t = segmentSphereEntry(ship.absPosition, step, planet.centreAbs, planet.radius + ATMOSPHERE_HEIGHT)
    if (t >= 0) {
      ship.absPosition.addScaledVector(step, t)
      dropOutOfHyper(ship)
      return
    }
  }
  ship.absPosition.add(step)
}

/**
 * Clear to jump: above `HYPER_MIN_ALTITUDE` anywhere, or at any altitude when
 * the nose's line misses the planet (tested against the highest the terrain
 * reaches). That is what lets a ship leave from inside the atmosphere: the
 * swept cutoff only fires on *entry*, and a straight line leaving a sphere never
 * re-enters it.
 */
function hyperClear(ship: PlayerState, planet: Gravitating, altitude: number): boolean {
  if (altitude >= HYPER_MIN_ALTITUDE) return true
  return !rayHitsSphere(ship.absPosition, fwd, planet.centreAbs, planet.radius + planet.maxElevation)
}

function stepHyperdrive(
  ship: PlayerState,
  input: ShipInput,
  planet: Gravitating,
  altitude: number,
  dt: number,
): void {
  const hyper = ship.hyper
  hyper.blocked = Math.max(0, hyper.blocked - dt)

  switch (hyper.state) {
    case HyperState.Idle:
      // Rising edge only: Space still held from a disengage must not re-arm it.
      if (!input.hyperPressed) break
      if (hyperClear(ship, planet, altitude)) {
        hyper.state = HyperState.Charging
        hyper.charge = 0
      } else {
        hyper.blocked = HYPER_BLOCKED_TIME
      }
      break

    case HyperState.Charging:
      // Re-checked every frame: steering into the planet mid-charge cancels.
      if (!input.hyperHeld || !hyperClear(ship, planet, altitude)) {
        if (input.hyperHeld) hyper.blocked = HYPER_BLOCKED_TIME
        hyper.state = HyperState.Idle
        hyper.charge = 0
        break
      }
      hyper.charge += dt
      if (hyper.charge >= HYPER_CHARGE_TIME) {
        hyper.state = HyperState.Engaged
        hyper.charge = HYPER_CHARGE_TIME
        hyper.dir.copy(fwd)
      }
      break

    case HyperState.Engaged:
      if (input.hyperPressed) dropOutOfHyper(ship)
      break
  }
}

function dropOutOfHyper(ship: PlayerState): void {
  ship.hyper.state = HyperState.Idle
  ship.hyper.charge = 0
  ship.velocity.copy(ship.hyper.dir).multiplyScalar(HYPER_EXIT_SPEED)
  ship.thrust = ThrustMode.Coast
}

/** Reticle → angular velocity, A/D roll, auto-level, visual bank. */
function steer(ship: PlayerState, input: ShipInput, atmo: number, dt: number): void {
  const r = ship.reticle
  r.x += input.lookX * RETICLE_SENSITIVITY
  r.y += input.lookY * RETICLE_SENSITIVITY
  const len = Math.hypot(r.x, r.y)
  if (len > 1) {
    r.x /= len
    r.y /= len
  }
  const recenter = Math.exp(-RETICLE_RECENTER * dt)
  r.x *= recenter
  r.y *= recenter

  // Rescale past the dead zone so the response starts at 0, not with a step.
  const m = Math.hypot(r.x, r.y)
  const k = m > RETICLE_DEADZONE ? (m - RETICLE_DEADZONE) / (1 - RETICLE_DEADZONE) / m : 0
  targetOmega.set(-r.y * k * MAX_PITCH_RATE, -r.x * k * MAX_YAW_RATE, input.roll * SHIP_ROLL_SPEED)
  ship.angularVelocity.lerp(targetOmega, ease(ANGULAR_RESPONSE, dt))

  omega.copy(ship.angularVelocity)
  if (atmo > 0 && input.roll === 0) omega.z += autoLevelRate(ship, atmo)

  // Local-frame angular velocity → post-multiplied rotation.
  const angle = omega.length() * dt
  if (angle > 0) {
    rotation.setFromAxisAngle(omega.normalize(), angle)
    ship.quaternion.multiply(rotation).normalize()
  }

  // Yaw right (negative y) → right wing down (negative z on the pivot).
  const bankTarget = (ship.angularVelocity.y / MAX_YAW_RATE) * MAX_BANK
  ship.bank += (bankTarget - ship.bank) * ease(BANK_RESPONSE, dt)
}

/**
 * Roll rate about local +Z that turns the ship's up toward the horizon's up.
 * Pitch is never touched. √atmo so it is already noticeable in thin air.
 */
function autoLevelRate(ship: PlayerState, atmo: number): number {
  const d = fwd.dot(localUp)
  if (Math.abs(d) > AUTOLEVEL_MAX_DOT) return 0

  proj.copy(localUp).addScaledVector(fwd, -d).normalize()
  shipUp.copy(UP).applyQuaternion(ship.quaternion)
  // Local +Z is world -forward; measure the signed angle about it.
  cross.crossVectors(shipUp, proj)
  const angle = Math.atan2(-cross.dot(fwd), shipUp.dot(proj))
  const rate = angle * AUTOLEVEL_RATE * Math.sqrt(atmo)
  return Math.max(-AUTOLEVEL_MAX_RATE, Math.min(AUTOLEVEL_MAX_RATE, rate))
}

/** Toward `cap` at `cap / accelTime` from below; settles down onto it from above. */
function drive(s: number, cap: number, accelTime: number, dt: number): number {
  if (s < cap) return Math.min(cap, s + (cap / accelTime) * dt)
  return cap + (s - cap) * Math.exp((-2 * dt) / accelTime)
}

/** Forward speed from W/Shift/S, lateral grip, atmospheric drag. */
function thrust(ship: PlayerState, input: ShipInput, atmo: number, dt: number): void {
  const cruiseCap = blendCap(THRUST_CRUISE.maxSpeedSpace, THRUST_CRUISE.maxSpeedSurface, atmo)
  const impulseCap = blendCap(THRUST_IMPULSE.maxSpeedSpace, THRUST_IMPULSE.maxSpeedSurface, atmo)

  let s = ship.velocity.dot(fwd)
  lateral.copy(ship.velocity).addScaledVector(fwd, -s).multiplyScalar(Math.exp(-LATERAL_DAMPING * dt))

  if (input.brake) {
    if (s > 0) {
      s = Math.max(0, s - Math.max(BRAKE_DECEL_MIN, s * BRAKE_RATE) * dt)
      ship.thrust = ThrustMode.Brake
    } else {
      s = Math.max(-MAX_REVERSE_SPEED, s - (MAX_REVERSE_SPEED / REVERSE_ACCEL_TIME) * dt)
      ship.thrust = ThrustMode.Reverse
    }
    ship.speedCap = MAX_REVERSE_SPEED
  } else if (input.cruise) {
    s = drive(s, cruiseCap, THRUST_CRUISE.accelTime, dt)
    ship.thrust = ThrustMode.Cruise
    ship.speedCap = cruiseCap
  } else if (input.forward) {
    s = drive(s, impulseCap, THRUST_IMPULSE.accelTime, dt)
    ship.thrust = ThrustMode.Impulse
    ship.speedCap = impulseCap
  } else {
    ship.thrust = ThrustMode.Coast
    ship.speedCap = cruiseCap
  }

  ship.velocity.copy(fwd).multiplyScalar(s).add(lateral)
  if (atmo <= 0) return

  // The air brakes anything over the cruise cap (the fastest it allows here) —
  // only the excess, so it never fights thrust that is within the cap.
  let speed = ship.velocity.length()
  if (speed === 0) return
  const before = speed
  if (speed > cruiseCap) {
    const excess = speed - cruiseCap
    const decel = (ATMO_DRAG_LINEAR + ATMO_DRAG_QUAD * excess) * atmo * excess
    speed = Math.max(cruiseCap, speed - decel * dt)
  }
  if (ship.thrust === ThrustMode.Coast) speed *= Math.exp(-ATMO_COAST_DRAG * atmo * dt)
  ship.velocity.multiplyScalar(speed / before)
}
