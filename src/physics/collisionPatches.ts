import type { Vector3 } from 'three'
import { ATMOSPHERE_HEIGHT } from '../core/constants'
import { chunkWorkerPool } from '../planet/ChunkWorkerPool'
import type { PlanetConfig } from '../planet/PlanetConfig'
import { CollisionPatch } from './CollisionPatch'
import type { CollisionTile, TileStats } from './CollisionTile'
import { collisionStats } from './collisionStats'

const stats: TileStats = { tiles: 0, ready: 0, enabled: 0, deepest: 0 }

/**
 * One `CollisionPatch` per planet whose atmosphere the player is inside; leaving
 * the atmosphere drops the planet's colliders. Keyed by `centreAbs`, which keeps
 * its identity across terrain versions (a new version swaps the config and
 * rebuilds the tiles).
 *
 * `ATMOSPHERE_HEIGHT` is global while there is one planet. With a second one it
 * moves into `PlanetConfig`; nothing here changes but the read.
 */
class CollisionPatches {
  private readonly patches = new Map<Vector3, CollisionPatch>()

  update(planets: readonly PlanetConfig[], shipAbs: Vector3, velocity: Vector3): void {
    for (const planet of planets) {
      const altitude = shipAbs.distanceTo(planet.centreAbs) - planet.radius
      let patch = this.patches.get(planet.centreAbs)

      if (altitude >= ATMOSPHERE_HEIGHT) {
        if (patch !== undefined) {
          patch.clear()
          this.patches.delete(planet.centreAbs)
        }
        continue
      }

      if (patch === undefined) {
        patch = new CollisionPatch(planet, chunkWorkerPool)
        this.patches.set(planet.centreAbs, patch)
      }
      patch.setConfig(planet)
      patch.update(shipAbs, velocity)
    }

    stats.tiles = stats.ready = stats.enabled = stats.deepest = 0
    for (const patch of this.patches.values()) patch.count(stats)
    collisionStats.activePlanets = this.patches.size
    collisionStats.tiles = stats.tiles
    collisionStats.ready = stats.ready
    collisionStats.enabled = stats.enabled
    collisionStats.deepest = stats.deepest
  }

  /** Enabled tiles of the patch around `centreAbs`, for the debug view. */
  forEachEnabled(centreAbs: Vector3, visit: (tile: CollisionTile) => void): void {
    this.patches.get(centreAbs)?.forEachEnabled(visit)
  }

  dispose(): void {
    for (const patch of this.patches.values()) patch.clear()
    this.patches.clear()
  }
}

export const collisionPatches = new CollisionPatches()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    collisionPatches.dispose()
  })
}
