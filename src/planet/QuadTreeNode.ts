import { Mesh, Vector3 } from 'three'
import type { Group, Material } from 'three'
import {
  CHUNK_RESOLUTION,
  MAX_LOD_LEVEL,
  MERGE_HYSTERESIS,
  SPLIT_FACTOR,
} from '../core/constants'
import type { ChunkResult } from './chunkGeometry'
import type { ChunkWorkerPool } from './ChunkWorkerPool'
import type { PlanetConfig } from './PlanetConfig'
import { faceArc, faceToSphere } from './quadsphere'
import { acquireChunkGeometry, fillChunkGeometry, releaseChunkGeometry } from './sharedBuffers'

/** `erasableSyntaxOnly` forbids `enum`, so: const object + derived union. */
export const NodeState = {
  /** Built, but no geometry asked for yet. */
  Idle: 'idle',
  /** Geometry requested; nothing to draw. */
  Pending: 'pending',
  /** Has a mesh. A leaf if `children` is null, otherwise mid-split. */
  Ready: 'ready',
  /** Four ready children are drawn in its place; its own mesh is kept, hidden. */
  Split: 'split',
} as const

export type NodeState = (typeof NodeState)[keyof typeof NodeState]

export type NodeContext = {
  readonly config: PlanetConfig
  /** Render-space root; its position is owned by the floating origin. */
  readonly group: Group
  readonly pool: ChunkWorkerPool
  readonly material: Material
  /** Live total, for the HUD. Nodes maintain it. */
  nodeCount: number
}

const scratchDir = new Vector3()

/**
 * One patch of one cube face, and the subtree beneath it.
 *
 * The state machine is small but two of its rules carry the whole thing:
 *
 * **A parent stays visible until all four children are `Ready`.** Children are
 * created hidden, and only when the last one's geometry lands does the parent hide
 * and the four appear, in the same tick. This is the entire defence against holes
 * in the surface — any other ordering shows background through the planet.
 *
 * **Interior nodes keep their geometry.** A node that splits hangs on to its own
 * (hidden) mesh, so merging is instant and cannot pop. The interior of a full
 * quadtree costs about a third of its leaves — a few dozen chunks. Not worth being
 * clever about.
 */
export class QuadTreeNode {
  readonly level: number
  readonly face: number
  readonly cu: number
  readonly cv: number
  readonly half: number

  /**
   * Absolute world position of the patch centre, lifted to its own altitude.
   * Static, so it is computed once here rather than per frame.
   *
   * It is derived through exactly the same `faceToSphere` + `getAltitude` calls
   * that `buildChunk` uses for `chunkOrigin`, which keeps the split test and the
   * geometry talking about the same point.
   */
  readonly centreAbs = new Vector3()

  /** World length of this patch's edge: the scale the split test is measured in. */
  readonly arc: number

  state: NodeState = NodeState.Idle

  private readonly ctx: NodeContext
  private readonly parent: QuadTreeNode | null
  private mesh: Mesh | null = null
  private children: QuadTreeNode[] | null = null
  private requestId = 0

  constructor(
    ctx: NodeContext,
    parent: QuadTreeNode | null,
    face: number,
    cu: number,
    cv: number,
    half: number,
    level: number,
  ) {
    this.ctx = ctx
    this.parent = parent
    this.face = face
    this.cu = cu
    this.cv = cv
    this.half = half
    this.level = level
    this.arc = faceArc(ctx.config.radius) * half

    const dir = faceToSphere(face, cu, cv, scratchDir)
    const radius = ctx.config.radius + ctx.config.terrain.getAltitude(dir, level)
    this.centreAbs.copy(dir).multiplyScalar(radius).add(ctx.config.centreAbs)

    ctx.nodeCount++
  }

  /** Asks for this node's geometry. Separate from construction so the caller controls when. */
  request(): void {
    this.state = NodeState.Pending
    this.requestId = this.ctx.pool.request(
      {
        face: this.face,
        cu: this.cu,
        cv: this.cv,
        half: this.half,
        level: this.level,
        res: CHUNK_RESOLUTION,
        radius: this.ctx.config.radius,
        seed: this.ctx.config.seed,
        terrainVersion: this.ctx.config.terrainVersion,
      },
      this.centreAbs,
      (result) => {
        this.onGeometry(result)
      },
    )
  }

  /**
   * Split/merge walk, top-down, stopping at the leaves of the *visible* tree.
   * `visit` is called once per visible leaf, for the HUD counters.
   *
   * Centre distance is an approximation — closest-point-on-patch would be tighter —
   * but it is the standard choice and `SPLIT_FACTOR` absorbs the slack.
   */
  update(playerAbs: Vector3, visit: (node: QuadTreeNode) => void): void {
    const distance = playerAbs.distanceTo(this.centreAbs)
    const splitAt = this.arc * SPLIT_FACTOR
    // The hysteresis band is what stops split/merge thrash when hovering exactly
    // at a boundary.
    const mergeAt = splitAt * MERGE_HYSTERESIS

    if (this.state === NodeState.Split) {
      if (distance > mergeAt) {
        this.merge()
        visit(this)
        return
      }
      for (const child of this.children!) child.update(playerAbs, visit)
      return
    }

    visit(this)

    if (this.children !== null) {
      // A split is in flight. If the player has already left, throw it away rather
      // than pay for geometry nobody will see.
      if (distance > mergeAt) this.discardChildren()
      return
    }

    if (this.state === NodeState.Ready && distance < splitAt && this.level < MAX_LOD_LEVEL) {
      this.split()
    }
  }

  private split(): void {
    const half = this.half / 2
    const { face, level, ctx } = this
    this.children = [
      new QuadTreeNode(ctx, this, face, this.cu - half, this.cv - half, half, level + 1),
      new QuadTreeNode(ctx, this, face, this.cu + half, this.cv - half, half, level + 1),
      new QuadTreeNode(ctx, this, face, this.cu - half, this.cv + half, half, level + 1),
      new QuadTreeNode(ctx, this, face, this.cu + half, this.cv + half, half, level + 1),
    ]
    for (const child of this.children) child.request()
  }

  private merge(): void {
    this.discardChildren()
    if (this.mesh !== null) this.mesh.visible = true
    this.state = NodeState.Ready
  }

  private discardChildren(): void {
    const children = this.children
    if (children === null) return
    this.children = null
    for (const child of children) child.dispose()
  }

  private onGeometry(result: ChunkResult): void {
    const geometry = acquireChunkGeometry()
    fillChunkGeometry(geometry, result.positions, result.normals, result.boundingRadius)

    const mesh = new Mesh(geometry, this.ctx.material)
    mesh.position.set(result.chunkOrigin[0], result.chunkOrigin[1], result.chunkOrigin[2])
    // A chunk never moves relative to the planet root, so its local matrix is
    // computed once. The root's rebase still propagates, because three multiplies
    // the parent's matrixWorld through regardless.
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    // Stay hidden until the parent's split actually completes.
    mesh.visible = this.parent === null || this.parent.state === NodeState.Split

    this.mesh = mesh
    this.ctx.group.add(mesh)
    this.state = NodeState.Ready

    this.parent?.onChildReady()
  }

  /** The hole-free handover. Nothing becomes visible until all four siblings landed. */
  private onChildReady(): void {
    const children = this.children
    if (children === null || this.state !== NodeState.Ready) return
    for (const child of children) {
      if (child.state !== NodeState.Ready) return
    }

    if (this.mesh !== null) this.mesh.visible = false
    for (const child of children) {
      if (child.mesh !== null) child.mesh.visible = true
    }
    this.state = NodeState.Split
  }

  /**
   * Releases this node and everything under it: cancels a pending request, returns
   * the geometry to the pool (never disposes it), and detaches the mesh.
   */
  dispose(): void {
    this.discardChildren()

    if (this.state === NodeState.Pending) this.ctx.pool.cancel(this.requestId)

    if (this.mesh !== null) {
      this.ctx.group.remove(this.mesh)
      releaseChunkGeometry(this.mesh.geometry)
      this.mesh = null
    }

    this.state = NodeState.Idle
    this.ctx.nodeCount--
  }
}
