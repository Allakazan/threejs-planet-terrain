import { Vector3 } from 'three'
import {
  COLLISION_KEEP_FACTOR,
  COLLISION_LOOKAHEAD,
  COLLISION_MARGIN,
  COLLISION_MIN_LEVEL,
  COLLISION_PATH_RADIUS,
} from '../core/constants'
import type { ChunkWorkerPool } from '../planet/ChunkWorkerPool'
import type { PlanetConfig } from '../planet/PlanetConfig'
import { sphereToFace } from '../planet/quadsphere'
import type { FacePoint } from '../planet/quadsphere'
import { CollisionTile } from './CollisionTile'
import type { TileContext, TileStats } from './CollisionTile'

/** Root cells per face edge at `COLLISION_MIN_LEVEL`. */
const ROOT_CELLS = 2 ** COLLISION_MIN_LEVEL
const ROOT_HALF = 1 / ROOT_CELLS

// Scratch, module scope: the per-frame walk allocates nothing but new tiles.
const s0 = new Vector3()
const s1 = new Vector3()
const seg = new Vector3()
const sample = new Vector3()
const offset = new Vector3()
const tangentA = new Vector3()
const tangentB = new Vector3()
const facePoint: FacePoint = { face: 0, u: 0, v: 0 }
const toPoint = new Vector3()

/**
 * The collision tiles of one planet: a sparse forest of `CollisionTile` trees,
 * rooted at `COLLISION_MIN_LEVEL`, covering only the ground under the swept path
 * `ship → ship + v·COLLISION_LOOKAHEAD`. See docs/05.
 *
 * Resolution comes from the distance to the ship (the tiles about to be touched
 * are always the finest); speed only stretches the path, i.e. *where* tiles are
 * wanted.
 */
export class CollisionPatch implements TileContext {
  config: PlanetConfig
  readonly shipAbs = new Vector3()

  /** Ground track of the path: both ends on the reference sphere, planet-relative. */
  private readonly track0 = new Vector3()
  private readonly track1 = new Vector3()

  private readonly pool: ChunkWorkerPool
  private readonly roots = new Map<number, CollisionTile>()
  private readonly wantedRoots = new Set<number>()

  constructor(config: PlanetConfig, pool: ChunkWorkerPool) {
    this.config = config
    this.pool = pool
  }

  /** A new terrain version: every tile was built from the old one. */
  setConfig(config: PlanetConfig): void {
    if (config === this.config) return
    this.clear()
    this.config = config
  }

  update(shipAbs: Vector3, velocity: Vector3): void {
    const { config } = this
    this.shipAbs.copy(shipAbs)
    s0.copy(shipAbs).sub(config.centreAbs)
    s1.copy(velocity).multiplyScalar(COLLISION_LOOKAHEAD).add(s0)

    // Nothing to hit unless the capsule reaches into the terrain shell.
    const shell = config.radius + config.maxElevation + COLLISION_MARGIN + COLLISION_PATH_RADIUS
    if (segmentDistanceToOrigin(s0, s1) > shell) {
      this.clear()
      return
    }

    this.track0.copy(s0).normalize().multiplyScalar(config.radius)
    this.track1.copy(s1).normalize().multiplyScalar(config.radius)
    this.collectRoots()

    for (const [key, root] of this.roots) {
      if (this.wantedRoots.has(key)) continue
      if (this.intersects(root, COLLISION_PATH_RADIUS * COLLISION_KEEP_FACTOR)) continue
      root.deactivate()
      this.roots.delete(key)
    }
    for (const key of this.wantedRoots) {
      if (this.roots.has(key)) continue
      const root = this.makeRoot(key)
      if (this.intersects(root, COLLISION_PATH_RADIUS)) this.roots.set(key, root)
    }

    for (const root of this.roots.values()) root.plan(this)
    for (const root of this.roots.values()) root.show(true)
  }

  /** Distance from the tile's ground centre to the ground track, against its reach. */
  intersects(tile: CollisionTile, radius: number): boolean {
    seg.copy(this.track1).sub(this.track0)
    toPoint.copy(tile.groundCentre).sub(this.track0)
    const lengthSq = seg.lengthSq()
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, toPoint.dot(seg) / lengthSq)) : 0
    const distance = toPoint.addScaledVector(seg, -t).length()
    return distance < tile.reach + radius
  }

  forEachEnabled(visit: (tile: CollisionTile) => void): void {
    for (const root of this.roots.values()) root.forEachEnabled(visit)
  }

  count(stats: TileStats): void {
    for (const root of this.roots.values()) root.count(stats)
  }

  clear(): void {
    for (const root of this.roots.values()) root.deactivate()
    this.roots.clear()
  }

  /**
   * Root cells under the track. Samples along it at half a root's spacing, plus a
   * sample `COLLISION_PATH_RADIUS` to each side, so a path running beside a cell
   * edge — or a face edge — still claims the cell over it.
   */
  private collectRoots(): void {
    const { track0, track1 } = this
    this.wantedRoots.clear()

    seg.copy(track1).sub(track0)
    const rootArc = (Math.PI / 2) * this.config.radius * ROOT_HALF
    const steps = Math.ceil(seg.length() / (rootArc / 2))

    // Two tangents of the sphere at the track; fixed over a path this short.
    tangentA.copy(seg)
    if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0).cross(track0)
    if (tangentA.lengthSq() < 1e-6) tangentA.set(0, 1, 0).cross(track0)
    tangentB.crossVectors(track0, tangentA).normalize().multiplyScalar(COLLISION_PATH_RADIUS)
    tangentA.normalize().multiplyScalar(COLLISION_PATH_RADIUS)

    for (let i = 0; i <= steps; i++) {
      sample.copy(track0).addScaledVector(seg, steps === 0 ? 0 : i / steps)
      this.claim(offset.copy(sample))
      this.claim(offset.copy(sample).add(tangentA))
      this.claim(offset.copy(sample).sub(tangentA))
      this.claim(offset.copy(sample).add(tangentB))
      this.claim(offset.copy(sample).sub(tangentB))
    }
  }

  /** Adds the root cell containing `point`'s direction. Normalises `point`. */
  private claim(point: Vector3): void {
    sphereToFace(point.normalize(), facePoint)
    const i = Math.min(ROOT_CELLS - 1, Math.floor(((facePoint.u + 1) / 2) * ROOT_CELLS))
    const j = Math.min(ROOT_CELLS - 1, Math.floor(((facePoint.v + 1) / 2) * ROOT_CELLS))
    this.wantedRoots.add((facePoint.face * ROOT_CELLS + j) * ROOT_CELLS + i)
  }

  private makeRoot(key: number): CollisionTile {
    const i = key % ROOT_CELLS
    const j = Math.floor(key / ROOT_CELLS) % ROOT_CELLS
    const face = Math.floor(key / (ROOT_CELLS * ROOT_CELLS))
    const cu = -1 + (2 * i + 1) * ROOT_HALF
    const cv = -1 + (2 * j + 1) * ROOT_HALF
    return new CollisionTile(this.config, this.pool, face, cu, cv, ROOT_HALF, COLLISION_MIN_LEVEL)
  }
}

/** Shortest distance from the origin to the segment `a → b`. */
function segmentDistanceToOrigin(a: Vector3, b: Vector3): number {
  seg.copy(b).sub(a)
  const lengthSq = seg.lengthSq()
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, -a.dot(seg) / lengthSq)) : 0
  return toPoint.copy(a).addScaledVector(seg, t).length()
}
