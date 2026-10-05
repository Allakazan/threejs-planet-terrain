import RAPIER from '@dimforge/rapier3d-compat'
import type { Collider } from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import {
  CHUNK_RESOLUTION,
  COLLISION_KEEP_FACTOR,
  COLLISION_MAX_LEVEL,
  COLLISION_PATH_RADIUS,
  COLLISION_SPLIT_FACTOR,
  MERGE_HYSTERESIS,
} from '../core/constants'
import type { ChunkResult } from '../planet/chunkGeometry'
import type { ChunkWorkerPool } from '../planet/ChunkWorkerPool'
import type { PlanetConfig } from '../planet/PlanetConfig'
import { faceArc, faceToSphere } from '../planet/quadsphere'
import { chunkIndexAttribute } from '../planet/sharedBuffers'
import { physicsWorld } from './physicsWorld'

/**
 * Tile reach as a multiple of its arc: centre to farthest corner, over the ground.
 * Half the diagonal is 0.71; spherified-cube cells vary in size by up to ~25%
 * across a face, and the slack only costs an occasional extra tile.
 */
const REACH_FACTOR = 0.9

/** Rapier copies the index into WASM, so one Uint32 copy serves every tile. */
let trimeshIndex: Uint32Array | null = null
function sharedTrimeshIndex(): Uint32Array {
  trimeshIndex ??= Uint32Array.from(chunkIndexAttribute().array)
  return trimeshIndex
}

/** This frame's path, as the patch sees it. */
export type TileContext = {
  /** The ship, absolute. The split test measures from here. */
  readonly shipAbs: Vector3
  /** Whether the tile's ground footprint is within `radius` of the swept path. */
  intersects(tile: CollisionTile, radius: number): boolean
}

export type TileStats = { tiles: number; ready: number; enabled: number; deepest: number }

const scratchDir = new Vector3()

/**
 * One collision patch of one cube face: same addressing, same `buildChunk`, same
 * pool as a render `QuadTreeNode`, but its own rules — see docs/05.
 *
 * - It exists only where the swept path wants it (`active`). Siblings off the
 *   path are never built.
 * - It may split before it is Ready, so a fast dive requests the whole chain of
 *   levels at once instead of paying one round trip per level.
 * - **A parent's collider stays enabled until every wanted child is covered** —
 *   the render tree's hole-free handover, applied to colliders. Two levels are
 *   never enabled over the same ground.
 * - Interior tiles keep their (disabled) collider, so a merge is instant.
 */
export class CollisionTile {
  readonly face: number
  readonly cu: number
  readonly cv: number
  readonly half: number
  readonly level: number
  /** Patch centre lifted to its own altitude, absolute. Same value as the render node's. */
  readonly centreAbs = new Vector3()
  /** Patch centre on the reference sphere, relative to the planet centre. For the path test. */
  readonly groundCentre = new Vector3()
  readonly arc: number
  /** Farthest the footprint reaches from `groundCentre`, metres. */
  readonly reach: number

  /** Wanted by the path. Inactive tiles hold nothing and request nothing. */
  active = true

  /** The built surface, relative to `chunkOrigin` (planet-relative). Kept for the debug view. */
  positions: Float32Array | null = null
  readonly chunkOrigin = new Vector3()

  private readonly config: PlanetConfig
  private readonly pool: ChunkWorkerPool
  /** Absolute position of `chunkOrigin`; the collider is registered against it. */
  private readonly originAbs = new Vector3()
  private collider: Collider | null = null
  private children: CollisionTile[] | null = null
  /** Every wanted child is covered, so they replace this tile. */
  private useChildren = false
  private requestId = 0
  private requested = false

  constructor(
    config: PlanetConfig,
    pool: ChunkWorkerPool,
    face: number,
    cu: number,
    cv: number,
    half: number,
    level: number,
  ) {
    this.config = config
    this.pool = pool
    this.face = face
    this.cu = cu
    this.cv = cv
    this.half = half
    this.level = level
    this.arc = faceArc(config.radius) * half
    this.reach = this.arc * REACH_FACTOR

    const dir = faceToSphere(face, cu, cv, scratchDir)
    this.groundCentre.copy(dir).multiplyScalar(config.radius)
    const radius = config.radius + config.terrain.getAltitude(dir, level)
    this.centreAbs.copy(dir).multiplyScalar(radius).add(config.centreAbs)
  }

  get ready(): boolean {
    return this.collider !== null
  }

  /** Tiles whose collider is enabled, for the debug view. */
  forEachEnabled(visit: (tile: CollisionTile) => void): void {
    if (this.collider?.isEnabled()) visit(this)
    if (this.children === null) return
    for (const child of this.children) if (child.active) child.forEachEnabled(visit)
  }

  /** Accumulates this subtree into `stats`, for the HUD. */
  count(stats: TileStats): void {
    stats.tiles++
    if (this.collider !== null) {
      stats.ready++
      if (this.collider.isEnabled()) {
        stats.enabled++
        if (this.level > stats.deepest) stats.deepest = this.level
      }
    }
    if (this.children === null) return
    for (const child of this.children) if (child.active) child.count(stats)
  }

  /**
   * Phase one: shape the subtree for this frame and request what is missing.
   * Returns whether the tile's wanted ground is covered by ready colliders, at
   * its own level or below.
   */
  plan(ctx: TileContext): boolean {
    this.request()

    const splitAt = this.arc * COLLISION_SPLIT_FACTOR * (this.children !== null ? MERGE_HYSTERESIS : 1)
    const split = this.level < COLLISION_MAX_LEVEL && ctx.shipAbs.distanceTo(this.centreAbs) < splitAt

    if (!split) {
      this.dropChildren()
      this.useChildren = false
      return this.ready
    }

    if (this.children === null) {
      const half = this.half / 2
      const { config, pool, face, level, cu, cv } = this
      this.children = [
        new CollisionTile(config, pool, face, cu - half, cv - half, half, level + 1),
        new CollisionTile(config, pool, face, cu + half, cv - half, half, level + 1),
        new CollisionTile(config, pool, face, cu - half, cv + half, half, level + 1),
        new CollisionTile(config, pool, face, cu + half, cv + half, half, level + 1),
      ]
      // Born inactive; the loop below decides which ones the path wants.
      for (const child of this.children) child.active = false
    }

    let covered = true
    for (const child of this.children) {
      const radius = COLLISION_PATH_RADIUS * (child.active ? COLLISION_KEEP_FACTOR : 1)
      if (ctx.intersects(child, radius)) {
        child.active = true
        if (!child.plan(ctx)) covered = false
      } else if (child.active) {
        child.deactivate()
      }
    }
    this.useChildren = covered
    return covered || this.ready
  }

  /** Phase two: enable exactly one level over each piece of wanted ground. */
  show(on: boolean): void {
    const handOver = on && this.children !== null && this.useChildren
    this.collider?.setEnabled(on && !handOver)
    if (this.children === null) return
    for (const child of this.children) if (child.active) child.show(handOver)
  }

  /** Releases everything: pending request, collider, children. The tile can be reused. */
  deactivate(): void {
    this.active = false
    this.dropChildren()
    if (this.requested && this.collider === null) this.pool.cancel(this.requestId)
    this.requested = false
    if (this.collider !== null) {
      physicsWorld.removeStatic(this.collider)
      this.collider = null
    }
    this.positions = null
  }

  private request(): void {
    if (this.requested) return
    this.requested = true
    this.requestId = this.pool.request(
      {
        face: this.face,
        cu: this.cu,
        cv: this.cv,
        half: this.half,
        level: this.level,
        res: CHUNK_RESOLUTION,
        radius: this.config.radius,
        seed: this.config.seed,
        terrainVersion: this.config.terrainVersion,
      },
      this.centreAbs,
      (result) => {
        this.onGeometry(result)
      },
      true,
    )
  }

  private dropChildren(): void {
    const children = this.children
    if (children === null) return
    this.children = null
    for (const child of children) if (child.active) child.deactivate()
  }

  private onGeometry(result: ChunkResult): void {
    const [ox, oy, oz] = result.chunkOrigin
    this.chunkOrigin.set(ox, oy, oz)
    this.originAbs.copy(this.chunkOrigin).add(this.config.centreAbs)

    const desc = RAPIER.ColliderDesc.trimesh(result.positions, sharedTrimeshIndex())
    // Disabled until `show` decides this level is the one over its ground.
    desc.setEnabled(false)
    this.collider = physicsWorld.addStatic(desc, this.originAbs)
    if (this.collider === null) {
      // Rapier hasn't loaded yet: forget the request, so the next frame asks again.
      this.requested = false
      return
    }
    this.positions = result.positions
  }
}
