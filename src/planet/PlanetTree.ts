import type { Group, Material, Vector3 } from 'three'
import type { ChunkWorkerPool } from './ChunkWorkerPool'
import type { PlanetConfig } from './PlanetConfig'
import { FACE_COUNT } from './quadsphere'
import { QuadTreeNode } from './QuadTreeNode'
import type { NodeContext } from './QuadTreeNode'

/**
 * The six face roots and the per-frame walk over them.
 *
 * Deliberately not a React component and not tied to the render loop: `Planet.tsx`
 * owns the lifecycle and calls `update` once per frame. That keeps the whole LOD
 * system testable from a plain script and means a StrictMode double-mount costs a
 * `dispose` + rebuild rather than a duplicated scene.
 */
export class PlanetTree {
  /** Visible leaves this frame, and the deepest level among them. */
  leaves = 0
  deepest = 0

  private readonly ctx: NodeContext
  private readonly roots: QuadTreeNode[] = []

  constructor(config: PlanetConfig, group: Group, pool: ChunkWorkerPool, material: Material) {
    this.ctx = { config, group, pool, material, nodeCount: 0 }

    for (let face = 0; face < FACE_COUNT; face++) {
      const root = new QuadTreeNode(this.ctx, null, face, 0, 0, 1, 0)
      this.roots.push(root)
      root.request()
    }
  }

  update(playerAbs: Vector3): void {
    this.leaves = 0
    this.deepest = 0
    for (const root of this.roots) root.update(playerAbs, this.visit)

    // After the walk, so this frame's new requests are in the queue and this
    // frame's abandoned ones are already cancelled.
    //
    // With more than one planet each tree pumps separately, which multiplies the
    // upload budget by the planet count. Fine at two; revisit if it grows.
    this.ctx.pool.pump(playerAbs)
  }

  private readonly visit = (node: QuadTreeNode) => {
    this.leaves++
    if (node.level > this.deepest) this.deepest = node.level
  }

  get nodes(): number {
    return this.ctx.nodeCount
  }

  dispose(): void {
    for (const root of this.roots) root.dispose()
    this.roots.length = 0
  }
}
