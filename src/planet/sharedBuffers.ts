import { BufferAttribute, BufferGeometry, Sphere } from 'three'
import { CHUNK_RESOLUTION } from '../core/constants'

export const VERTS_PER_EDGE = CHUNK_RESOLUTION + 1
export const CHUNK_VERTEX_COUNT = VERTS_PER_EDGE * VERTS_PER_EDGE

/**
 * Every chunk on every planet has identical topology, so the index and the UVs
 * are built once and handed to all of them. 33² = 1089 < 65536, so Uint16 holds.
 */
function buildIndex(): BufferAttribute {
  const indices = new Uint16Array(CHUNK_RESOLUTION * CHUNK_RESOLUTION * 6)
  let o = 0
  for (let j = 0; j < CHUNK_RESOLUTION; j++) {
    for (let i = 0; i < CHUNK_RESOLUTION; i++) {
      const a = j * VERTS_PER_EDGE + i
      const b = a + 1
      const c = a + VERTS_PER_EDGE
      const d = c + 1
      // +i runs along the face's `right`, +j along its `up`, and `right × up` is
      // outward — so a→b→d→c is counter-clockwise seen from outside, which is
      // three's front face.
      indices[o++] = a
      indices[o++] = b
      indices[o++] = d
      indices[o++] = a
      indices[o++] = d
      indices[o++] = c
    }
  }
  return new BufferAttribute(indices, 1)
}

/** `(0,0)`–`(1,1)` across the patch. The grid shader reads nothing else. */
function buildUv(): BufferAttribute {
  const uv = new Float32Array(CHUNK_VERTEX_COUNT * 2)
  let o = 0
  for (let j = 0; j < VERTS_PER_EDGE; j++) {
    for (let i = 0; i < VERTS_PER_EDGE; i++) {
      uv[o++] = i / CHUNK_RESOLUTION
      uv[o++] = j / CHUNK_RESOLUTION
    }
  }
  return new BufferAttribute(uv, 2)
}

const sharedIndex = buildIndex()
const sharedUv = buildUv()

/** The shared chunk index, read-only. Collision tiles build their trimeshes from it. */
export function chunkIndexAttribute(): BufferAttribute {
  return sharedIndex
}

/**
 * Free list of chunk geometries.
 *
 * Two problems it solves at once:
 *
 * - `geometry.dispose()` tells three's `WebGLAttributes` to drop the GL buffers of
 *   *every* attribute it holds — including the shared index and UV. Nothing gets
 *   corrupted (three re-uploads lazily) but you pay a hiccup per dispose, on
 *   exactly the frames where you can least afford one.
 * - churning `BufferGeometry` and its typed arrays is GC pressure during fast
 *   flight, which shows up as stutter.
 *
 * So nothing is ever disposed during normal operation. Every geometry in the pool
 * has the same byte lengths, and recycling is `array.set(data)` + `needsUpdate`,
 * which three turns into a `bufferSubData` on the existing GL buffer.
 */
const pool: BufferGeometry[] = []
let created = 0

export function acquireChunkGeometry(): BufferGeometry {
  const recycled = pool.pop()
  if (recycled !== undefined) return recycled

  created++
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(CHUNK_VERTEX_COUNT * 3), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(CHUNK_VERTEX_COUNT * 3), 3))
  geometry.setAttribute('uv', sharedUv)
  geometry.setIndex(sharedIndex)
  // Set once and then only its radius is touched; positions are chunk-local, so
  // the centre is the origin by construction.
  geometry.boundingSphere = new Sphere()
  return geometry
}

export function releaseChunkGeometry(geometry: BufferGeometry): void {
  pool.push(geometry)
}

export function fillChunkGeometry(
  geometry: BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
  boundingRadius: number,
): void {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  ;(position.array as Float32Array).set(positions)
  ;(normal.array as Float32Array).set(normals)
  position.needsUpdate = true
  normal.needsUpdate = true
  // Non-null: every pooled geometry gets one in `acquireChunkGeometry`.
  geometry.boundingSphere!.radius = boundingRadius
}

/** For the HUD: how many geometries exist, and how many are parked. */
export function geometryPoolStats(): { created: number; free: number } {
  return { created, free: pool.length }
}
