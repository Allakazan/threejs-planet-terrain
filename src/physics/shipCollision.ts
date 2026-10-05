import RAPIER from '@dimforge/rapier3d-compat'
import type { Cuboid } from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import {
  COLLISION_FRICTION,
  COLLISION_MAX_LEVEL,
  COLLISION_MIN_BOUNCE,
  COLLISION_RESTITUTION,
  COLLISION_SKIN,
  GROUND_CLEARANCE,
  GROUND_GUARD_DEPTH,
  SHIP_COLLIDER_OFFSET,
  SHIP_HALF_EXTENTS,
} from '../core/constants'
import type { PlanetConfig } from '../planet/PlanetConfig'
import type { PlayerState } from '../player/PlayerState'
import { collisionStats } from './collisionStats'
import { physicsWorld } from './physicsWorld'

const [HX, HY, HZ] = SHIP_HALF_EXTENTS
/** Centre to corner of the box, plus the offset: nothing of the ship is farther out. */
const SHIP_REACH = Math.hypot(HX, HY, HZ) + Math.hypot(...SHIP_COLLIDER_OFFSET)

// Scratch, module scope: nothing here allocates per frame (Rapier's hit object aside).
const boxOffset = new Vector3()
const shapePos = new Vector3()
const step = new Vector3()
const normal = new Vector3()
const toShip = new Vector3()
const tangent = new Vector3()
const up = new Vector3()
const boxCentre = new Vector3()
const corner = new Vector3()
const rel = new Vector3()

/** Built on first use: Rapier objects wait for its WASM. */
let shipShape: Cuboid | null = null

/**
 * Sweeps the ship's box over this frame's step (`prevAbs → ship.absPosition`)
 * against the collision tiles, and on a hit stops it at the surface and bounces
 * it. A query, not a body: the flight model stays plain maths and runs first.
 *
 * `origin` is the render-space origin the colliders are currently placed in.
 */
export function resolveShipCollision(ship: PlayerState, prevAbs: Vector3, planet: PlanetConfig, origin: Vector3): void {
  const world = physicsWorld.world
  if (world === null) return
  shipShape ??= new RAPIER.Cuboid(HX, HY, HZ)
  // Flushes last frame's new, toggled and rebased colliders into the broad phase.
  physicsWorld.step()

  boxOffset.set(...SHIP_COLLIDER_OFFSET).applyQuaternion(ship.quaternion)
  shapePos.copy(prevAbs).sub(origin).add(boxOffset)
  step.copy(ship.absPosition).sub(prevAbs)

  // stopAtPenetration = false: a box that starts inside a tile but is moving out
  // is let go, instead of being pinned where it is.
  const hit = world.castShape(shapePos, ship.quaternion, step, shipShape, COLLISION_SKIN, 1, false)
  if (hit === null) return

  const t = hit.time_of_impact
  ship.absPosition.copy(prevAbs).addScaledVector(step, t)

  // Rapier's normal is outward from the triangle that was hit. Point it at the
  // ship whichever side that was, and fall back to local up when there is none
  // (a cast that starts in penetration has no meaningful normal).
  normal.set(hit.normal1.x, hit.normal1.y, hit.normal1.z)
  toShip.copy(shapePos).addScaledVector(step, t)
  toShip.x -= hit.witness1.x
  toShip.y -= hit.witness1.y
  toShip.z -= hit.witness1.z
  if (normal.lengthSq() < 0.5) normal.copy(ship.absPosition).sub(planet.centreAbs).normalize()
  else if (normal.dot(toShip) < 0) normal.negate()

  bounce(ship.velocity, normal)
}

/**
 * Restitution on the normal part, Coulomb friction on the tangential part (the
 * loss scales with the normal impulse, so a graze barely slows the ship), and a
 * minimum separation speed so nothing sticks.
 */
function bounce(velocity: Vector3, n: Vector3): void {
  const vn = velocity.dot(n)
  if (vn < 0) {
    const impulse = -(1 + COLLISION_RESTITUTION) * vn
    velocity.addScaledVector(n, impulse)

    tangent.copy(velocity).addScaledVector(n, -velocity.dot(n))
    const vt = tangent.length()
    if (vt > 0) velocity.addScaledVector(tangent, -Math.min(vt, COLLISION_FRICTION * impulse) / vt)

    collisionStats.impacts++
    collisionStats.lastImpactSpeed = -vn
  }
  const away = velocity.dot(n)
  if (away < COLLISION_MIN_BOUNCE) velocity.addScaledVector(n, COLLISION_MIN_BOUNCE - away)
}

/**
 * The backstop that doesn't need tiles. Samples the terrain function under the
 * eight corners of the ship's box; if any is more than `GROUND_GUARD_DEPTH` below
 * the surface, lifts the ship out along local up and kills the inward velocity.
 *
 * That covers what the tiles can't: a terrain Apply that puts a mountain where the
 * ship is, the frames before the tiles arrive, and any step outside them. The
 * tolerance keeps it from fighting the tiles, whose triangles sit a little off the
 * function between vertices.
 */
export function groundGuard(ship: PlayerState, planet: PlanetConfig): void {
  up.copy(ship.absPosition).sub(planet.centreAbs)
  const distance = up.length()
  if (distance - planet.radius > planet.maxElevation + SHIP_REACH) return
  up.divideScalar(distance)

  boxCentre.set(...SHIP_COLLIDER_OFFSET).applyQuaternion(ship.quaternion).add(ship.absPosition)
  let depth = -Infinity
  for (let i = 0; i < 8; i++) {
    corner
      .set(i & 1 ? HX : -HX, i & 2 ? HY : -HY, i & 4 ? HZ : -HZ)
      .applyQuaternion(ship.quaternion)
      .add(boxCentre)
    rel.copy(corner).sub(planet.centreAbs)
    const r = rel.length()
    const ground = planet.radius + planet.terrain.getAltitude(rel.divideScalar(r), COLLISION_MAX_LEVEL)
    depth = Math.max(depth, ground - r)
  }
  if (depth <= GROUND_GUARD_DEPTH) return

  ship.absPosition.addScaledVector(up, depth + GROUND_CLEARANCE)
  const inward = ship.velocity.dot(up)
  if (inward < 0) ship.velocity.addScaledVector(up, -inward)
  collisionStats.guardPushes++
  collisionStats.lastGuardDepth = depth
}
