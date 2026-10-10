import { Vector3 } from 'three'
import { bakeFarTexture } from './farBake'
import { faceToSphere } from './quadsphere'
import { layeredTerrain, terrainBuildFor } from './terrain/LayeredTerrain'
import type { TerrainBuild } from './terrain/terrainSpec'

/**
 * Everything the generator needs, and nothing that cannot survive a
 * `postMessage`. No `Vector3`, no `TerrainSource` — the worker rebuilds the
 * terrain from `seed` + `radius` + `terrainVersion` through the memoised factory.
 * The spec for that version reaches the worker ahead of the request; see
 * `ChunkWorkerPool`.
 */
export type ChunkRequest = {
  id: number
  face: number
  /** patch centre in face-local coordinates, `(u,v) ∈ [-1,1]²` */
  cu: number
  cv: number
  /** half the patch's face-local extent: `2^-level` */
  half: number
  level: number
  /** quads per edge */
  res: number
  radius: number
  seed: number
  terrainVersion: number
  /**
   * Texels per edge of the far-material bake (`farBake.ts`); absent or 0 = none.
   * Only render chunks coarser than `TERRAIN_SHADER_MIN_LOD` ask. Collision tiles never do.
   */
  bakeRes?: number
}

/**
 * Main thread → worker. A `terrain` message (the version's spec and bake settings)
 * always precedes the first request that names its version; per-worker message
 * order makes that sufficient.
 */
export type WorkerMessage =
  | { kind: 'terrain'; version: number; build: TerrainBuild }
  | { kind: 'chunk'; req: ChunkRequest }

export type ChunkResult = {
  id: number
  /**
   * `(res+1)²` verts, **relative to `chunkOrigin`** — this is Rule B.
   *
   * The buffer type is pinned to `ArrayBuffer` (never `SharedArrayBuffer`) because
   * these two arrays are what the worker transfers, and only a plain ArrayBuffer
   * is `Transferable`.
   */
  positions: Float32Array<ArrayBuffer>
  normals: Float32Array<ArrayBuffer>
  /** offset from the planet centre, f64, applied as the chunk mesh's position */
  chunkOrigin: [number, number, number]
  /**
   * Largest `|position|` in the chunk. Positions are centred on `chunkOrigin`, so
   * the bounding sphere is `(0,0,0)` + this — exact, and free, which beats
   * `computeBoundingSphere()` rescanning 1089 verts on every upload.
   */
  boundingRadius: number
  /** Wall time of `buildChunk`, for the HUD — terrain cost is what dominates it. */
  buildMs: number
  /** `bakeRes²` RGBA8: object-space normal + cavity. Null when no bake was asked for. */
  bake: Uint8Array<ArrayBuffer> | null
  /** Wall time of the bake alone, ms (included in `buildMs`). 0 without one. */
  bakeMs: number
}

/**
 * One vertex of overlap on every side. Normals are taken by central difference,
 * which needs a neighbour beyond the chunk edge; without the ring you get a
 * visible lighting crease on all four borders of every chunk.
 */
const RING = 1

// Scratch, module scope. Reused across every chunk this thread ever builds, so a
// chunk costs zero allocations beyond the two arrays it ships back.
const scratchDir = new Vector3()
const scratchCentre = new Vector3()

/**
 * The `(res+3)²` sample grid, in f64 and relative to the **planet centre**.
 *
 * f64 matters: the subtraction `gridPoint - chunkOrigin` has to happen at full
 * precision before anything is narrowed to f32. Both operands are ~1.7e6, and
 * their difference at LOD 12 is ~20 — computing that in f32 would leave 21 cm of
 * quantisation on a 20 m quad, which is exactly the stair-stepping Rule B exists
 * to prevent.
 */
let gridRes = -1
let gridX = new Float64Array(0)
let gridY = new Float64Array(0)
let gridZ = new Float64Array(0)

function ensureGrid(res: number): void {
  if (gridRes === res) return
  const n = (res + 1 + 2 * RING) ** 2
  gridX = new Float64Array(n)
  gridY = new Float64Array(n)
  gridZ = new Float64Array(n)
  gridRes = res
}

/**
 * Builds one chunk. A **pure function** of its request: same request, same bytes,
 * on any thread. That is what lets `USE_WORKERS = false` run the identical code
 * path synchronously — with breakpoints and real stack traces — and it is also
 * why face seams line up, since two chunks meeting at an edge evaluate the same
 * `faceToSphere` input and get the same f64 answer.
 */
export function buildChunk(req: ChunkRequest): ChunkResult {
  const started = performance.now()
  const { face, cu, cv, half, level, res, radius, seed, terrainVersion } = req
  const terrain = layeredTerrain(seed, radius, terrainVersion)

  ensureGrid(res)
  const stride = res + 1 + 2 * RING
  const step = (2 * half) / res

  // --- sample the grid, ring included, in f64 relative to the planet centre ---
  for (let gj = 0; gj < stride; gj++) {
    const v = cv - half + (gj - RING) * step
    for (let gi = 0; gi < stride; gi++) {
      const u = cu - half + (gi - RING) * step

      const dir = faceToSphere(face, u, v, scratchDir)
      const r = radius + terrain.getAltitude(dir, level)

      const g = gj * stride + gi
      gridX[g] = dir.x * r
      gridY[g] = dir.y * r
      gridZ[g] = dir.z * r
    }
  }

  // --- chunk origin: the patch centre, lifted to its own altitude ---
  // Lifting it (rather than using `dir · radius`) keeps the local extents down to
  // the patch's own size instead of the full terrain relief, which buys four more
  // bits of f32 at the levels where precision actually matters. Computed from
  // `faceToSphere`/`getAltitude` directly so it is bit-identical to the value
  // `QuadTreeNode` derives for its split test.
  const centreDir = faceToSphere(face, cu, cv, scratchCentre)
  const centreR = radius + terrain.getAltitude(centreDir, level)
  const ox = centreDir.x * centreR
  const oy = centreDir.y * centreR
  const oz = centreDir.z * centreR

  // --- emit the interior, local to chunkOrigin, with central-difference normals ---
  const verts = res + 1
  const positions = new Float32Array(verts * verts * 3)
  const normals = new Float32Array(verts * verts * 3)
  let maxRadiusSq = 0

  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const g = (j + RING) * stride + (i + RING)
      const o = (j * verts + i) * 3

      const px = gridX[g] - ox
      const py = gridY[g] - oy
      const pz = gridZ[g] - oz
      positions[o] = px
      positions[o + 1] = py
      positions[o + 2] = pz

      const rsq = px * px + py * py + pz * pz
      if (rsq > maxRadiusSq) maxRadiusSq = rsq

      // Secants across the vertex, one per parameter direction. The sphere's own
      // curvature cancels out of a symmetric stencil, so what survives is the
      // terrain gradient — which is what we want the normal to follow.
      const gu = g + 1
      const gv = g + stride
      const tux = gridX[gu] - gridX[g - 1]
      const tuy = gridY[gu] - gridY[g - 1]
      const tuz = gridZ[gu] - gridZ[g - 1]
      const tvx = gridX[gv] - gridX[g - stride]
      const tvy = gridY[gv] - gridY[g - stride]
      const tvz = gridZ[gv] - gridZ[g - stride]

      // `right × up === forward` for every face (see quadsphere.ts), so
      // `∂u × ∂v` already points outward — no sign correction needed.
      let nx = tuy * tvz - tuz * tvy
      let ny = tuz * tvx - tux * tvz
      let nz = tux * tvy - tuy * tvx
      const len = Math.hypot(nx, ny, nz)
      if (len > 0) {
        nx /= len
        ny /= len
        nz /= len
      }
      normals[o] = nx
      normals[o + 1] = ny
      normals[o + 2] = nz
    }
  }

  let bake: Uint8Array<ArrayBuffer> | null = null
  let bakeMs = 0
  const bakeRes = req.bakeRes ?? 0
  if (bakeRes > 0) {
    const bakeStarted = performance.now()
    const { bake: settings } = terrainBuildFor(req.terrainVersion)
    bake = bakeFarTexture(terrain, face, cu, cv, half, level, radius, res, bakeRes, settings)
    bakeMs = performance.now() - bakeStarted
  }

  return {
    id: req.id,
    positions,
    normals,
    chunkOrigin: [ox, oy, oz],
    boundingRadius: Math.sqrt(maxRadiusSq),
    buildMs: performance.now() - started,
    bake,
    bakeMs,
  }
}
