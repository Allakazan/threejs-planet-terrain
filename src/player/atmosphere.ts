import type { Vector3 } from 'three'
import { ATMOSPHERE_HEIGHT, ATMOSPHERE_SCALE_HEIGHT } from '../core/constants'

const TOP = Math.exp(-ATMOSPHERE_HEIGHT / ATMOSPHERE_SCALE_HEIGHT)

/**
 * Normalised density: an exponential profile rescaled so it is exactly 0 at
 * `ATMOSPHERE_HEIGHT` (no discontinuity at the edge) and 1 at the surface.
 */
export function atmosphereFactor(altitude: number): number {
  if (altitude >= ATMOSPHERE_HEIGHT) return 0
  const h = Math.max(0, altitude)
  return (Math.exp(-h / ATMOSPHERE_SCALE_HEIGHT) - TOP) / (1 - TOP)
}

/** `space · (surface/space)^atmo` — falls evenly across orders of magnitude. */
export function blendCap(space: number, surface: number, atmo: number): number {
  return space * Math.pow(surface / space, atmo)
}

/**
 * Whether the ray `from + t·dir (t ≥ 0)` hits the sphere. From inside, it counts
 * as a hit only when heading inward: a ship below the peaks that is climbing has
 * a clear path out, one that is descending doesn't.
 */
export function rayHitsSphere(from: Vector3, dir: Vector3, centre: Vector3, radius: number): boolean {
  const ox = from.x - centre.x
  const oy = from.y - centre.y
  const oz = from.z - centre.z
  const b = ox * dir.x + oy * dir.y + oz * dir.z
  if (b >= 0) return false
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  if (c <= 0) return true
  const a = dir.x * dir.x + dir.y * dir.y + dir.z * dir.z
  return b * b - a * c >= 0
}

/**
 * Where the segment `from → from + step` first enters the sphere, as a fraction
 * `t ∈ [0, 1]` of `step`, or -1 if it doesn't (including when `from` is already
 * inside). Swept rather than a point test: at hyperdrive speed one frame's step
 * is far longer than the atmosphere is deep.
 */
export function segmentSphereEntry(from: Vector3, step: Vector3, centre: Vector3, radius: number): number {
  const ox = from.x - centre.x
  const oy = from.y - centre.y
  const oz = from.z - centre.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  if (c <= 0) return -1
  const b = ox * step.x + oy * step.y + oz * step.z
  if (b >= 0) return -1
  const a = step.x * step.x + step.y * step.y + step.z * step.z
  const disc = b * b - a * c
  if (disc < 0) return -1
  const t = (-b - Math.sqrt(disc)) / a
  return t <= 1 ? t : -1
}
