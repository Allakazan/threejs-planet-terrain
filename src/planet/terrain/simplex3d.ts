/**
 * 3D simplex noise — Stefan Gustavson's public-domain reference implementation,
 * transcribed to TypeScript and given a seeded permutation table.
 *
 * Vendored rather than added as a dependency: it has to run inside a worker with
 * no bundler ceremony, and it is ~120 lines.
 *
 * The permutation table gives it a period of 256 noise units. `LayeredTerrain`
 * offsets every octave differently and uses a non-integer lacunarity, so the
 * octaves never tile in step.
 */

/** The 12 edge-midpoint gradients of a cube, flattened. */
const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
])

const F3 = 1 / 3
const G3 = 1 / 6

/**
 * Squared radius of each corner's falloff kernel. The reference code uses 0.6, which
 * is **discontinuous**: a corner's kernel has not reached zero where a sample leaves
 * its simplex, so the value steps on every simplex boundary. It never showed at
 * the old terrain's slopes, but a walk at 1 m spacing found steps of several metres
 * on a 1 km layer, which then ridged/billow folding doubles. 0.5 is the largest
 * radius that is continuous.
 */
const KERNEL_R2 = 0.5
/** Brings the 0.5-kernel output back to ≈ [-1, 1] (measured max 0.416 at 32). */
const SCALE = 76

/** Small, fast, well-distributed PRNG — enough to shuffle 256 entries. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Simplex3D {
  /** Doubled to 512 so `perm[i + perm[j + perm[k]]]` never needs a wrap. */
  private readonly perm = new Uint8Array(512)
  private readonly permMod12 = new Uint8Array(512)

  constructor(seed: number) {
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i

    const random = mulberry32(seed)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const tmp = p[i]
      p[i] = p[j]
      p[j] = tmp
    }

    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255]
      this.permMod12[i] = this.perm[i] % 12
    }
  }

  /** Roughly [-1, 1]. Features are about one unit across. */
  noise(x: number, y: number, z: number): number {
    // Skew the input onto the simplex lattice and find the containing cell.
    const s = (x + y + z) * F3
    const i = Math.floor(x + s)
    const j = Math.floor(y + s)
    const k = Math.floor(z + s)

    const t = (i + j + k) * G3
    const x0 = x - (i - t)
    const y0 = y - (j - t)
    const z0 = z - (k - t)

    // Which of the six tetrahedra in the cell are we in? Ranking x0,y0,z0 picks it.
    let i1: number, j1: number, k1: number
    let i2: number, j2: number, k2: number
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0
      }
    }

    const x1 = x0 - i1 + G3
    const y1 = y0 - j1 + G3
    const z1 = z0 - k1 + G3
    const x2 = x0 - i2 + 2 * G3
    const y2 = y0 - j2 + 2 * G3
    const z2 = z0 - k2 + 2 * G3
    const x3 = x0 - 1 + 3 * G3
    const y3 = y0 - 1 + 3 * G3
    const z3 = z0 - 1 + 3 * G3

    const { perm, permMod12 } = this
    const ii = i & 255
    const jj = j & 255
    const kk = k & 255

    let n = 0

    let t0 = KERNEL_R2 - x0 * x0 - y0 * y0 - z0 * z0
    if (t0 > 0) {
      const g = permMod12[ii + perm[jj + perm[kk]]] * 3
      t0 *= t0
      n += t0 * t0 * (GRAD3[g] * x0 + GRAD3[g + 1] * y0 + GRAD3[g + 2] * z0)
    }

    let t1 = KERNEL_R2 - x1 * x1 - y1 * y1 - z1 * z1
    if (t1 > 0) {
      const g = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3
      t1 *= t1
      n += t1 * t1 * (GRAD3[g] * x1 + GRAD3[g + 1] * y1 + GRAD3[g + 2] * z1)
    }

    let t2 = KERNEL_R2 - x2 * x2 - y2 * y2 - z2 * z2
    if (t2 > 0) {
      const g = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3
      t2 *= t2
      n += t2 * t2 * (GRAD3[g] * x2 + GRAD3[g + 1] * y2 + GRAD3[g + 2] * z2)
    }

    let t3 = KERNEL_R2 - x3 * x3 - y3 * y3 - z3 * z3
    if (t3 > 0) {
      const g = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3
      t3 *= t3
      n += t3 * t3 * (GRAD3[g] * x3 + GRAD3[g + 1] * y3 + GRAD3[g + 2] * z3)
    }

    return SCALE * n
  }
}
