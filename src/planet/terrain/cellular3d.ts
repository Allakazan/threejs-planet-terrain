/**
 * Seeded 3D cellular (Worley) noise, plus a crater field built on the same grid.
 *
 * One jittered feature point per unit cell, found by searching the 3×3×3
 * neighbourhood. The cell → point mapping is an integer hash, not a permutation
 * table, so unlike `Simplex3D` it has no 256-unit period — which matters at the
 * fine octaves, where noise coordinates reach millions.
 *
 * Results come back through fields (`f1`, `f2`, `id`) rather than a returned
 * object, so a sample allocates nothing.
 */

/** Integer hash of a cell and a seed → uint32. Full avalanche, cheap. */
function hashCell(x: number, y: number, z: number, seed: number): number {
  let h = seed ^ Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/** Next value in a per-cell stream: rehash, so one cell yields several randoms. */
function next(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return (h ^ (h >>> 15)) >>> 0
}

const TO_UNIT = 1 / 4294967296

/** Chance that a cell holds a crater at all; the gaps keep fields from looking gridded. */
const CRATER_PRESENCE = 0.6
/**
 * Only feature points within this many cells of the surface make craters. Together
 * with `CRATER_SUPPORT · CRATER_MAX_RADIUS = 0.72`, this keeps every contributing
 * point under one cell away: √(0.5² + 0.72²) ≈ 0.88.
 */
const CRATER_BAND = 0.5
/** Crater radius range, in cells. */
const CRATER_MIN_RADIUS = 0.12
const CRATER_MAX_RADIUS = 0.45
/** Squared normalised distance below which the bowl is flat: a floor at 1 - 0.3 of the depth. */
const CRATER_FLOOR = 0.3
const CRATER_RIM_HEIGHT = 0.35
const CRATER_RIM_WIDTH = 0.6
/** Outer edge of the profile, in crater radii. */
const CRATER_SUPPORT = 1 + CRATER_RIM_WIDTH

export class Cellular3D {
  /** Distance to the nearest feature point, in cells. */
  f1 = 0
  /** Distance to the second-nearest. */
  f2 = 0
  /** Hash of the nearest point's cell — a stable per-cell random in [0, 1). */
  id = 0

  private readonly seed: number

  constructor(seed: number) {
    this.seed = seed | 0
  }

  /** Fills `f1`, `f2`, `id`. */
  worley(x: number, y: number, z: number): void {
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    const cz = Math.floor(z)
    let d1 = Infinity
    let d2 = Infinity
    let id = 0

    for (let k = -1; k <= 1; k++) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ix = cx + i
          const iy = cy + j
          const iz = cz + k
          let h = hashCell(ix, iy, iz, this.seed)
          const px = ix + h * TO_UNIT
          h = next(h)
          const py = iy + h * TO_UNIT
          h = next(h)
          const pz = iz + h * TO_UNIT

          const dx = px - x
          const dy = py - y
          const dz = pz - z
          const d = dx * dx + dy * dy + dz * dz
          if (d < d1) {
            d2 = d1
            d1 = d
            id = h
          } else if (d < d2) {
            d2 = d
          }
        }
      }
    }

    this.f1 = Math.sqrt(d1)
    this.f2 = Math.sqrt(d2)
    this.id = next(id) * TO_UNIT
  }

  /**
   * Sum of crater profiles around `(x,y,z)`, in about [-1, 0.35]: -1 on the floor
   * of the largest craters, a raised rim at one crater radius, 0 far away.
   *
   * The sample points all lie on a sphere (the planet surface in noise units), but
   * the feature points fill 3D. Measuring plain 3D distance would turn a point
   * hovering above the surface into a rim with no bowl. So each point is split into
   * its height `h` off the sphere and its tangential distance, and treated as a
   * ball sliced by the surface: the crater's radius shrinks as `√(1 - (h/H)²)` and
   * reaches zero at `|h| = H = 0.5` cells.
   *
   * That band is what keeps the field continuous. A point with `|h| < 0.5` whose
   * crater reaches the sample is less than one cell away, so it is always inside
   * the 3×3×3 search. A point outside the search always contributes zero. Simply
   * projecting points onto the sphere would break that: a point two cells up would
   * land on top of the sample but never be found.
   *
   * Depth scales with the radius, as real craters do, so small ones are shallow.
   * Overlapping craters add. That is not how impacts work (a new crater erases the
   * old one), but it is continuous everywhere, and at a glance it reads the same.
   */
  craters(x: number, y: number, z: number): number {
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    const cz = Math.floor(z)
    const sphereR = Math.sqrt(x * x + y * y + z * z)
    let sum = 0

    for (let k = -1; k <= 1; k++) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ix = cx + i
          const iy = cy + j
          const iz = cz + k
          let h = hashCell(ix, iy, iz, this.seed)
          if (h * TO_UNIT >= CRATER_PRESENCE) continue
          h = next(h)
          const px = ix + h * TO_UNIT
          h = next(h)
          const py = iy + h * TO_UNIT
          h = next(h)
          const pz = iz + h * TO_UNIT

          const height = Math.sqrt(px * px + py * py + pz * pz) - sphereR
          const slice = 1 - (height * height) / (CRATER_BAND * CRATER_BAND)
          if (slice <= 0) continue

          h = next(h)
          // Squared, so small craters are far more common than big ones.
          const r = h * TO_UNIT
          const radius =
            (CRATER_MIN_RADIUS + (CRATER_MAX_RADIUS - CRATER_MIN_RADIUS) * r * r) * Math.sqrt(slice)

          const dx = px - x
          const dy = py - y
          const dz = pz - z
          // Tangential distance. Treating the surface as locally flat is fine: it
          // spans thousands of cells at every wavelength a crater layer would use.
          const tangentSq = dx * dx + dy * dy + dz * dz - height * height
          const support = CRATER_SUPPORT * radius
          if (tangentSq >= support * support) continue

          const t = Math.sqrt(Math.max(0, tangentSq)) / radius
          sum += (radius / CRATER_MAX_RADIUS) * craterProfile(t)
        }
      }
    }

    return sum
  }
}

/** `t` is distance in crater radii. Bowl with a flat floor, plus a rim bump. */
function craterProfile(t: number): number {
  const tt = t * t
  const bowl = t < 1 ? (Math.max(tt, CRATER_FLOOR) - 1) / (1 - CRATER_FLOOR) : 0
  const u = (t - 1) / CRATER_RIM_WIDTH
  const uu = u * u
  const rim = uu < 1 ? CRATER_RIM_HEIGHT * (1 - uu) * (1 - uu) : 0
  return bowl + rim
}
