import { Vector3 } from 'three'
import { applyNearOptions } from '../chunkMaterial'
import { applyFarOptions } from '../shading/farMaterialPool'
import { terrainMaterialOptions } from '../shading/terrainMaterialOptions'
import { DEFAULT_ATMOSPHERE, atmosphereState, sunDirection } from './atmosphereSettings'
import type { AtmosphereSettings } from './atmosphereSettings'
import { applyAtmosphereUniforms } from './atmosphereUniforms'
import { setSkySteps } from './skyMaterial'

/**
 * The live atmosphere and sun, main thread only. `setAtmosphere` writes the
 * scattering uniforms, the raymarch defines (a recompile, only when they change),
 * the flight model's `atmosphereState`, and `sunLight` for the scene's lights.
 */
let current: AtmosphereSettings = { ...DEFAULT_ATMOSPHERE }

/** Read per frame by `SunLights`: plain numbers, never React state. */
export const sunLight = {
  /** Towards the sun, unit length. */
  direction: sunDirection(DEFAULT_ATMOSPHERE, new Vector3()),
  intensity: DEFAULT_ATMOSPHERE.sunIntensity,
  ambient: DEFAULT_ATMOSPHERE.ambient,
}

export function getAtmosphere(): Readonly<AtmosphereSettings> {
  return current
}

/** Merges `patch` into the live atmosphere and applies it. */
export function setAtmosphere(patch: Partial<AtmosphereSettings>): void {
  current = { ...current, ...patch }
  const a = current

  applyAtmosphereUniforms(a)
  atmosphereState.height = a.height
  atmosphereState.scaleHeight = a.scaleHeight

  sunDirection(a, sunLight.direction)
  sunLight.intensity = a.sunIntensity
  sunLight.ambient = a.ambient

  terrainMaterialOptions.atmoSteps = a.terrainSteps
  terrainMaterialOptions.atmoLightSteps = a.terrainLightSteps
  applyNearOptions()
  applyFarOptions()
  setSkySteps(a.skySteps, a.skyLightSteps)
}
