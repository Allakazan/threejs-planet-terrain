import { Vector3 } from 'three'
import { faceArc, faceToSphere } from './quadsphere'
import type { FarBakeSettings } from './terrain/terrainSpec'
import type { TerrainSource } from './terrain/TerrainSource'

/**
 * The far material's per-chunk texture: `T²` RGBA8 texels.
 *
 * - **RGB** — the surface normal in the *planet's* frame (object space). Chunks and
 *   the planet root only ever translate, so object space is world orientation:
 *   no tangents, and nothing to disagree about at the cube edges.
 * - **A** — cavity. 0.5 is flat, lower is a valley or crease, higher a ridge.
 *
 * Normals come from the exact terrain function by central differences in f64 —
 * the same method `buildChunk` uses for vertex normals — so this is a normal map
 * that is right by construction, not one recovered from a quantised height image.
 *
 * Texel `i` sits at `i / (T-1)` across the patch, i.e. the first and last texels
 * lie *on* the chunk edges, so two neighbours at the same level sample the same
 * points there. The shader remaps the chunk uv to texel centres to match.
 *
 * Pure and allocation-free past the first call at a given size: runs in a worker.
 */

// Module-scope scratch, like `buildChunk`'s grid. Positions are relative to the
// planet centre, in f64; `alt` is the radial altitude.
let gridSize = -1
let gridX = new Float64Array(0)
let gridY = new Float64Array(0)
let gridZ = new Float64Array(0)
let gridAlt = new Float64Array(0)
/** Summed-area table of `gridAlt`, `(size+1)²`, so a box mean is four reads. */
let sat = new Float64Array(0)

const scratchDir = new Vector3()

function ensureGrid(size: number): void {
  if (gridSize === size) return
  const n = size * size
  gridX = new Float64Array(n)
  gridY = new Float64Array(n)
  gridZ = new Float64Array(n)
  gridAlt = new Float64Array(n)
  sat = new Float64Array((size + 1) * (size + 1))
  gridSize = size
}

export function bakeFarTexture(
  terrain: TerrainSource,
  face: number,
  cu: number,
  cv: number,
  half: number,
  level: number,
  radius: number,
  res: number,
  texRes: number,
  { cavityRadius, cavityGain }: FarBakeSettings,
): Uint8Array<ArrayBuffer> {
  // The ring must cover both the normal's ±1 stencil and the cavity box.
  const ring = Math.max(1, cavityRadius)
  const size = texRes + 2 * ring
  ensureGrid(size)

  // Sample at the level whose Nyquist limit matches the *texel* spacing, not the
  // mesh's: that is what puts finer relief in the texture than the mesh can carry.
  const bakeLevel = level + Math.max(0, Math.round(Math.log2((texRes - 1) / res)))
  const step = (2 * half) / (texRes - 1)

  for (let gj = 0; gj < size; gj++) {
    const v = cv - half + (gj - ring) * step
    for (let gi = 0; gi < size; gi++) {
      const u = cu - half + (gi - ring) * step
      const dir = faceToSphere(face, u, v, scratchDir)
      const alt = terrain.getAltitude(dir, bakeLevel)
      const r = radius + alt
      const g = gj * size + gi
      gridX[g] = dir.x * r
      gridY[g] = dir.y * r
      gridZ[g] = dir.z * r
      gridAlt[g] = alt
    }
  }

  // --- summed-area table: sat[(j+1)(size+1) + (i+1)] = Σ alt over [0..i]×[0..j] ---
  const stride = size + 1
  for (let i = 0; i < stride; i++) sat[i] = 0
  for (let j = 0; j < size; j++) {
    let row = 0
    sat[(j + 1) * stride] = 0
    for (let i = 0; i < size; i++) {
      row += gridAlt[j * size + i]
      sat[(j + 1) * stride + i + 1] = sat[j * stride + i + 1] + row
    }
  }

  // Cavity is `(h - box mean) / texel size`: a height difference over a length, so
  // it reads the same at every level instead of fading as chunks shrink.
  // A patch's edge is `faceArc · half` long (see `QuadTreeNode.arc`).
  const texelMetres = (faceArc(radius) * half) / (texRes - 1)
  const boxArea = (2 * cavityRadius + 1) ** 2

  const out = new Uint8Array(texRes * texRes * 4)
  for (let j = 0; j < texRes; j++) {
    for (let i = 0; i < texRes; i++) {
      const gi = i + ring
      const gj = j + ring
      const g = gj * size + gi

      // `∂u × ∂v` is outward on every face; see quadsphere.ts.
      const tux = gridX[g + 1] - gridX[g - 1]
      const tuy = gridY[g + 1] - gridY[g - 1]
      const tuz = gridZ[g + 1] - gridZ[g - 1]
      const tvx = gridX[g + size] - gridX[g - size]
      const tvy = gridY[g + size] - gridY[g - size]
      const tvz = gridZ[g + size] - gridZ[g - size]
      let nx = tuy * tvz - tuz * tvy
      let ny = tuz * tvx - tux * tvz
      let nz = tux * tvy - tuy * tvx
      const len = Math.hypot(nx, ny, nz)
      if (len > 0) {
        nx /= len
        ny /= len
        nz /= len
      }

      const x0 = gi - cavityRadius
      const x1 = gi + cavityRadius + 1
      const y0 = gj - cavityRadius
      const y1 = gj + cavityRadius + 1
      const boxSum = sat[y1 * stride + x1] - sat[y0 * stride + x1] - sat[y1 * stride + x0] + sat[y0 * stride + x0]
      const cavity = (gridAlt[g] - boxSum / boxArea) / texelMetres

      const o = (j * texRes + i) * 4
      out[o] = Math.round(nx * 127.5 + 127.5)
      out[o + 1] = Math.round(ny * 127.5 + 127.5)
      out[o + 2] = Math.round(nz * 127.5 + 127.5)
      out[o + 3] = Math.round((0.5 + 0.5 * Math.tanh(cavityGain * cavity)) * 255)
    }
  }
  return out
}
