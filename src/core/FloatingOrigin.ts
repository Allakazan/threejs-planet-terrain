import { Vector3 } from 'three'
import type { Object3D } from 'three'
import { REBASE_THRESHOLD } from './constants'

/**
 * Something whose true position is too large for float32. `absPosition` is the
 * authority (plain JS numbers, f64); `object3d.position` is derived from it and
 * is rewritten on every rebase.
 */
export interface WorldBody {
  absPosition: Vector3
  object3d: Object3D
}

const THRESHOLD_SQ = REBASE_THRESHOLD * REBASE_THRESHOLD

/**
 * Keeps the renderer looking at small numbers by moving the world instead of
 * the camera. `origin` is the absolute coordinate that render-space (0,0,0)
 * currently represents, so `renderPos = absPos - origin`.
 *
 * A plain class, created outside React: StrictMode's double mount cannot
 * duplicate it, and nothing here needs to survive a re-render.
 */
export class FloatingOrigin {
  readonly origin = new Vector3()
  rebaseCount = 0

  private readonly bodies = new Set<WorldBody>()
  private readonly rebaseListeners = new Set<() => void>()

  /** Registers a body and places it immediately. Returns the unregister fn. */
  register(body: WorldBody): () => void {
    this.bodies.add(body)
    body.object3d.position.copy(body.absPosition).sub(this.origin)
    return () => {
      this.bodies.delete(body)
    }
  }

  /** For systems that cache render-space data and must refresh it on a shift. */
  onRebase(cb: () => void): () => void {
    this.rebaseListeners.add(cb)
    return () => {
      this.rebaseListeners.delete(cb)
    }
  }

  toRender(abs: Vector3, out: Vector3): Vector3 {
    return out.copy(abs).sub(this.origin)
  }

  toAbsolute(render: Vector3, out: Vector3): Vector3 {
    return out.copy(render).add(this.origin)
  }

  get bodyCount(): number {
    return this.bodies.size
  }

  /**
   * Shifts the origin onto the player if they have drifted past the threshold.
   * Returns true if a shift happened.
   *
   * At the top gears the player covers more than the threshold in one frame;
   * that is harmless. The snap is exact, so there is no accumulating error —
   * only a rebase on most frames, which costs one loop over a handful of bodies.
   */
  update(playerAbs: Vector3): boolean {
    if (playerAbs.distanceToSquared(this.origin) <= THRESHOLD_SQ) return false

    this.origin.copy(playerAbs)
    for (const body of this.bodies) {
      body.object3d.position.copy(body.absPosition).sub(this.origin)
    }
    this.rebaseCount++
    for (const cb of this.rebaseListeners) cb()
    return true
  }
}
