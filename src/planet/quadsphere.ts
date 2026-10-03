import { Vector3 } from 'three'
import { CHUNK_RESOLUTION } from '../core/constants'

/**
 * A cube face as an orthonormal basis. Face-local `(u,v) ∈ [-1,1]²` maps to the
 * cube point `forward + u·right + v·up`.
 *
 * **Invariant: `right × up === forward` for all six faces** — i.e. every basis is
 * right-handed with `forward` pointing outward. Two things depend on it:
 *
 * - the shared index buffer's winding (`sharedBuffers.ts`) is CCW seen from
 *   outside only if +u is screen-right and +v is screen-up when looking inward;
 * - `chunkGeometry` takes `cross(∂p/∂u, ∂p/∂v)` as the outward normal with no
 *   sign correction.
 *
 * Change a basis and both break silently — re-check the invariant if you do.
 */
export type FaceBasis = {
  readonly right: Vector3
  readonly up: Vector3
  readonly forward: Vector3
}

function face(
  rx: number, ry: number, rz: number,
  ux: number, uy: number, uz: number,
  fx: number, fy: number, fz: number,
): FaceBasis {
  return {
    right: new Vector3(rx, ry, rz),
    up: new Vector3(ux, uy, uz),
    forward: new Vector3(fx, fy, fz),
  }
}

export const FACES: readonly FaceBasis[] = [
  face(0, 0, -1, 0, 1, 0, 1, 0, 0), //  +X
  face(0, 0, 1, 0, 1, 0, -1, 0, 0), //  -X
  face(1, 0, 0, 0, 0, -1, 0, 1, 0), //  +Y
  face(1, 0, 0, 0, 0, 1, 0, -1, 0), //  -Y
  face(1, 0, 0, 0, 1, 0, 0, 0, 1), //   +Z
  face(-1, 0, 0, 0, 1, 0, 0, 0, -1), // -Z
]

export const FACE_COUNT = FACES.length

/** Arc length of a root face edge: a quarter of a great circle. */
export function faceArc(radius: number): number {
  return (Math.PI / 2) * radius
}

/** World size of one quad at `level`. The LOD table in docs/02 comes from this. */
export function quadSize(radius: number, level: number): number {
  return faceArc(radius) / (CHUNK_RESOLUTION * 2 ** level)
}

/**
 * The spherified cube, not `normalize()`. Plain normalisation bunches triangles
 * badly at the face centres; this costs three sqrts and gives near-uniform quads.
 *
 * `in` may lie slightly outside the cube: `chunkGeometry` samples a one-vertex
 * ring beyond each chunk for seamless normals, and at the edge of a root chunk
 * that ring is off the face. The formula stays analytic there — the `max(0, …)`
 * only guards against a ring so wide that a radicand would go negative, which
 * `CHUNK_RESOLUTION ≥ 32` never produces.
 */
export function spherify(x: number, y: number, z: number, out: Vector3): Vector3 {
  const xx = x * x
  const yy = y * y
  const zz = z * z
  return out.set(
    x * Math.sqrt(Math.max(0, 1 - yy / 2 - zz / 2 + (yy * zz) / 3)),
    y * Math.sqrt(Math.max(0, 1 - zz / 2 - xx / 2 + (zz * xx) / 3)),
    z * Math.sqrt(Math.max(0, 1 - xx / 2 - yy / 2 + (xx * yy) / 3)),
  )
}

/**
 * Face-local `(u,v)` → unit direction on the sphere.
 *
 * Face seams are watertight because the cube point is a shared value: the +X
 * face at `u = -1` and the +Z face at `u = +1` both evaluate to `(1, v, 1)`, and
 * `spherify` is a pure function of that point. Identical input, identical f64
 * output, so adjacent chunks at the same level agree exactly on their shared
 * edge.
 */
export function faceToSphere(faceIndex: number, u: number, v: number, out: Vector3): Vector3 {
  const { right, up, forward } = FACES[faceIndex]
  return spherify(
    forward.x + u * right.x + v * up.x,
    forward.y + u * right.y + v * up.y,
    forward.z + u * right.z + v * up.z,
    out,
  ).normalize()
}
