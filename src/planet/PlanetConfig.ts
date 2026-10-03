import { Vector3 } from 'three'
import { PLANET_RADIUS, SEED } from '../core/constants'
import { layeredTerrain, terrainSpecFor } from './terrain/LayeredTerrain'
import { maxElevation } from './terrain/terrainSpec'
import { getTerrainVersion } from './terrain/terrainStore'
import type { TerrainSource } from './terrain/TerrainSource'

export type PlanetConfig = {
  readonly radius: number
  readonly seed: number
  /**
   * Absolute world position of the planet centre. Held **by identity** — the
   * floating origin re-reads it on every rebase — so it must be a stable
   * `Vector3`, never rebuilt per render.
   */
  readonly centreAbs: Vector3
  /** Which terrain spec this config was built from; sent with every chunk request. */
  readonly terrainVersion: number
  /**
   * Used on the main thread only, for the split test's patch centres. The worker
   * rebuilds its own from `seed` + `radius` + `terrainVersion`; see `layeredTerrain`.
   */
  readonly terrain: TerrainSource
  /** Upper bound on terrain height, metres. Loose; for ray tests. */
  readonly maxElevation: number
}

/**
 * Build a config. Call it at module scope or inside a `useMemo` — a fresh object
 * per render would tear the quadtree down and rebuild it every frame.
 *
 * `centreAbs`, when given, is used as-is rather than copied, so a config rebuilt
 * for a new terrain version keeps the identity the floating origin registered.
 */
export function planetConfig(options?: {
  radius?: number
  seed?: number
  centre?: readonly [number, number, number]
  centreAbs?: Vector3
  terrainVersion?: number
}): PlanetConfig {
  const radius = options?.radius ?? PLANET_RADIUS
  const seed = options?.seed ?? SEED
  const centre = options?.centre ?? [0, 0, 0]
  const terrainVersion = options?.terrainVersion ?? getTerrainVersion()
  return {
    radius,
    seed,
    centreAbs: options?.centreAbs ?? new Vector3(centre[0], centre[1], centre[2]),
    terrainVersion,
    terrain: layeredTerrain(seed, radius, terrainVersion),
    maxElevation: maxElevation(terrainSpecFor(terrainVersion)),
  }
}
