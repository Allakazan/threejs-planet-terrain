import type { Vector3 } from 'three'

/**
 * The single seam between the quadtree and whatever generates relief: one
 * interface, one method. It is a **heightfield** — one altitude per direction — so
 * any heightfield source drops in, but caves and overhangs cannot be expressed
 * through it. A voxel source would need a density interface and a different
 * mesher; see docs/04, "Voxel terrain".
 *
 * `dir` is a **unit** direction from the planet centre; the return is signed
 * metres of relief to add to the radius.
 *
 * `level` exists so the source can band-limit itself: a source that returns
 * detail finer than the mesh at `level` can represent is producing pure aliasing.
 * See `LayeredTerrain` for the Nyquist rule that follows from it.
 *
 * Called once per vertex per chunk, from a worker. Implementations must not
 * allocate, and must be deterministic — face seams are watertight only because
 * two chunks sampling the same `dir` get bit-identical answers.
 */
export interface TerrainSource {
  getAltitude(dir: Vector3, level: number): number
}
