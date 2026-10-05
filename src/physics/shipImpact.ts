import { Quaternion, Vector3 } from 'three'
import {
  COLLISION_FRICTION,
  COLLISION_MIN_BOUNCE,
  COLLISION_RESTITUTION,
  CRASH_MESSAGE_TIME,
  CRASH_SPEED,
  KNOCKBACK_DECAY,
  KNOCKBACK_DISTANCE,
  SHIP_COLLIDER_OFFSET,
  SHIP_HALF_EXTENTS,
  STAGGER_BANK,
  STAGGER_FULL_SPEED,
  STAGGER_MAX_RATE,
  STAGGER_MIN_SPEED,
} from '../core/constants'
import type { PlayerState } from '../player/PlayerState'
import { collisionStats } from './collisionStats'

const [HX, HY, HZ] = SHIP_HALF_EXTENTS
const [OX, OY, OZ] = SHIP_COLLIDER_OFFSET

/** Box inertia per unit mass, about the box centre. Close enough about the pivot. */
const IX = (HY * HY + HZ * HZ) / 3
const IY = (HX * HX + HZ * HZ) / 3
const IZ = (HX * HX + HY * HY) / 3

/**
 * The largest `|I⁻¹ (r × n)|` the box can produce, near enough: a strike at the
 * nose (pitch) or a wingtip (roll). Normalises the lever, so a contact under the
 * centre staggers little and one at an extremity staggers fully.
 */
const LEVER_REF = Math.max((HZ + Math.abs(OZ)) / IX, (HX + Math.abs(OX)) / IZ)

/** Corners within this of the deepest one share the contact: a flat face hits at its middle. */
const CONTACT_TOLERANCE = 0.3

const MAX_KNOCKBACK_SPEED = KNOCKBACK_DISTANCE * KNOCKBACK_DECAY

// Scratch, module scope: nothing here allocates.
const tangent = new Vector3()
const localNormal = new Vector3()
const inverse = new Quaternion()
const contact = new Vector3()
const corner = new Vector3()
const torque = new Vector3()

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * The response to one hit. `n` is the surface normal, unit, pointing at the ship.
 *
 * - Above `CRASH_SPEED` of normal speed, the ship is destroyed and respawns.
 * - Otherwise the into-ground part of the flight velocity is removed (the ship
 *   slides on), friction takes some of the rest, and the bounce goes into
 *   `ship.knockback`, capped so it travels at most `KNOCKBACK_DISTANCE`.
 * - Above `STAGGER_MIN_SPEED` the ship also gets an angular kick, from the impulse
 *   at the contact point.
 */
export function applyImpact(ship: PlayerState, n: Vector3): void {
  const vn = ship.velocity.dot(n)
  const speed = Math.max(0, -vn)

  if (speed > CRASH_SPEED) {
    collisionStats.crashes++
    collisionStats.lastCrashSpeed = speed
    ship.respawn()
    ship.crashTimer = CRASH_MESSAGE_TIME
    ship.crashSpeed = speed
    return
  }

  if (speed > 0) {
    ship.velocity.addScaledVector(n, speed)

    // Coulomb: the tangential loss scales with the normal impulse, so a graze
    // barely slows the ship.
    tangent.copy(ship.velocity).addScaledVector(n, -ship.velocity.dot(n))
    const vt = tangent.length()
    const loss = Math.min(vt, COLLISION_FRICTION * (1 + COLLISION_RESTITUTION) * speed)
    if (vt > 0) ship.velocity.addScaledVector(tangent, -loss / vt)

    collisionStats.impacts++
    collisionStats.lastImpactSpeed = speed
  }

  // Even a resting contact leaves at the minimum, so nothing sticks.
  const push = Math.max(COLLISION_MIN_BOUNCE, Math.min(COLLISION_RESTITUTION * speed, MAX_KNOCKBACK_SPEED))
  ship.knockback.copy(n).multiplyScalar(push)

  if (speed > STAGGER_MIN_SPEED) stagger(ship, n, speed)
}

/**
 * Angular kick from the impulse at the contact: `Δω ∝ I⁻¹ (r × n)` in the ship's
 * frame. The nose hitting pitches it up, a wingtip rolls it, and a flat landing
 * barely turns it. `steer()` eases `angularVelocity` back toward the reticle and
 * auto-level pulls the roll back, so it wobbles and recovers by itself.
 */
function stagger(ship: PlayerState, n: Vector3, speed: number): void {
  inverse.copy(ship.quaternion).invert()
  localNormal.copy(n).applyQuaternion(inverse)

  // The contact is the box's support point against the surface: the mean of the
  // corners deepest along -n. Rapier's witness point can be any corner of a face
  // contact, which would spin a ship that landed flat.
  let deepest = -Infinity
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? HX : -HX, i & 2 ? HY : -HY, i & 4 ? HZ : -HZ)
    deepest = Math.max(deepest, -corner.dot(localNormal))
  }
  contact.set(0, 0, 0)
  let count = 0
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? HX : -HX, i & 2 ? HY : -HY, i & 4 ? HZ : -HZ)
    if (-corner.dot(localNormal) < deepest - CONTACT_TOLERANCE) continue
    contact.add(corner)
    count++
  }
  contact.divideScalar(count)
  contact.x += OX
  contact.y += OY
  contact.z += OZ

  torque.crossVectors(contact, localNormal)
  torque.x /= IX
  torque.y /= IY
  torque.z /= IZ
  const lever = torque.length()
  if (lever < 1e-6) return

  const strength = smoothstep01((speed - STAGGER_MIN_SPEED) / (STAGGER_FULL_SPEED - STAGGER_MIN_SPEED))
  const rate = STAGGER_MAX_RATE * strength * Math.min(1, lever / LEVER_REF)
  ship.angularVelocity.addScaledVector(torque, rate / lever)
  // Visual-only: the mesh shudders the way the hit rolls it.
  ship.bank += STAGGER_BANK * rate * (Math.sign(torque.z) || 1)

  collisionStats.lastStaggerRate = rate
}

/**
 * Moves the ship by its knockback and decays it. Call after `stepShip` and before
 * the collision sweep, so the push is swept against the terrain like any motion.
 */
export function applyKnockback(ship: PlayerState, dt: number): void {
  if (ship.knockback.lengthSq() === 0) return
  ship.absPosition.addScaledVector(ship.knockback, dt)
  ship.knockback.multiplyScalar(Math.exp(-KNOCKBACK_DECAY * dt))
  if (ship.knockback.lengthSq() < 1e-4) ship.knockback.set(0, 0, 0)
}
