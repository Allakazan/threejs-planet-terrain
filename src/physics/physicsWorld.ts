import RAPIER from '@dimforge/rapier3d-compat'
import type { Collider, ColliderDesc, World } from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three'
import { floatingOrigin } from '../core/originContext'

const scratch = new Vector3()

/**
 * The one Rapier world. A module singleton, like `chunkWorkerPool`, so StrictMode
 * cannot build two.
 *
 * Rapier's JS builds are f32-only, so the world lives in **render space**, like
 * the scene graph. Every static collider is registered with its f64 absolute
 * position and re-placed on each rebase — the `WorldBody` pattern, applied to
 * colliders. Moved colliders reach the broad phase on the next `step()`, which
 * runs before every query.
 *
 * Gravity is 0. Nothing here is simulated yet: the ship collides through queries.
 * Gravity toward a planet centre is per-body and will arrive with the walker.
 */
class PhysicsWorld {
  /** Null until the WASM has loaded. Every caller treats that as "no collision yet". */
  world: World | null = null

  private readonly statics = new Map<Collider, Vector3>()
  private disposed = false
  private readonly unsubscribe: () => void

  constructor() {
    void RAPIER.init().then(() => {
      if (this.disposed) return
      this.world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    })
    this.unsubscribe = floatingOrigin.onRebase(this.onRebase)
  }

  /**
   * Adds a collider with no body, fixed at `absPosition` (kept by reference and
   * read on every rebase, so the caller must not mutate it). Returns null before
   * Rapier is ready.
   */
  addStatic(desc: ColliderDesc, absPosition: Vector3): Collider | null {
    const world = this.world
    if (world === null) return null
    floatingOrigin.toRender(absPosition, scratch)
    desc.setTranslation(scratch.x, scratch.y, scratch.z)
    const collider = world.createCollider(desc)
    this.statics.set(collider, absPosition)
    return collider
  }

  removeStatic(collider: Collider): void {
    if (!this.statics.delete(collider)) return
    this.world?.removeCollider(collider, false)
  }

  /** Flushes collider changes into the broad phase. Call before querying. */
  step(): void {
    this.world?.step()
  }

  get staticCount(): number {
    return this.statics.size
  }

  private readonly onRebase = () => {
    for (const [collider, abs] of this.statics) {
      collider.setTranslation(floatingOrigin.toRender(abs, scratch))
    }
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe()
    this.statics.clear()
    this.world?.free()
    this.world = null
  }
}

export const physicsWorld = new PhysicsWorld()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    physicsWorld.dispose()
  })
}
