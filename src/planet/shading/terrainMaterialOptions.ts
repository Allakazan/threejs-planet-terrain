import {
  ATMO_TERRAIN_LIGHT_STEPS,
  ATMO_TERRAIN_STEPS,
  FAR_ROUGHNESS,
  NEAR_ROUGHNESS,
  USE_BIPLANAR,
  USE_STOCHASTIC_TILING,
} from '../../core/constants'

/**
 * What the terrain materials take as defines or material properties rather than
 * uniforms: a change means a recompile (or at least a material update), so the
 * stores write here and then call `applyNearOptions` / `applyFarOptions`.
 */
export const terrainMaterialOptions = {
  biplanar: USE_BIPLANAR,
  stochastic: USE_STOCHASTIC_TILING,
  atmoSteps: ATMO_TERRAIN_STEPS,
  atmoLightSteps: ATMO_TERRAIN_LIGHT_STEPS,
  nearRoughness: NEAR_ROUGHNESS,
  farRoughness: FAR_ROUGHNESS,
}

/**
 * Defines both terrain materials carry. three only declares the generic `vUv`
 * varying when USE_UV is defined, which normally happens because some map is
 * bound; defining it by hand gets the uv plumbed through — the grid reads it.
 */
export function sharedTerrainDefines(): Record<string, string> {
  return {
    USE_UV: '',
    ATMO_STEPS: String(terrainMaterialOptions.atmoSteps),
    ATMO_LIGHT_STEPS: String(terrainMaterialOptions.atmoLightSteps),
  }
}

/** Whether two define sets differ, so an unchanged write doesn't force a recompile. */
export function definesChanged(a: Record<string, unknown> | undefined, b: Record<string, string>): boolean {
  if (a === undefined) return true
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return true
  return keys.some((key) => a[key] !== b[key])
}
