import { Color, Vector3 } from 'three'
import {
  ATMO_MIE_BETA,
  ATMO_MIE_G,
  ATMO_MIE_SCALE_HEIGHT,
  ATMO_RAYLEIGH_BETA,
  ATMO_SPACE_HAZE,
  ATMO_SUN_INTENSITY,
  ATMOSPHERE_HEIGHT,
  ATMOSPHERE_SCALE_HEIGHT,
  SUN_DIRECTION,
} from '../../core/constants'

/**
 * Every atmosphere uniform, as one set of objects shared by the sky shell and
 * both terrain materials (the same pattern as `shadingUniforms`): a write here
 * reaches all of them on the next draw. Singletons, so a second planet needs a
 * set of its own.
 */
export const atmosphereUniforms = {
  /** Towards the sun, unit length. */
  uSunDir: { value: new Vector3(...SUN_DIRECTION).normalize() },
  uSunIntensity: { value: ATMO_SUN_INTENSITY },
  uPlanetRadius: { value: 1 },
  uAtmoHeight: { value: ATMOSPHERE_HEIGHT },
  uRayleigh: { value: new Vector3(...ATMO_RAYLEIGH_BETA) },
  uRayleighH: { value: ATMOSPHERE_SCALE_HEIGHT },
  uMie: { value: ATMO_MIE_BETA },
  uMieH: { value: ATMO_MIE_SCALE_HEIGHT },
  uMieG: { value: ATMO_MIE_G },
  uSpaceHaze: { value: ATMO_SPACE_HAZE },

  // --- per frame ---
  /** Camera altitude over the reference sphere, computed in f64. See `atmoSphereC`. */
  uCamAltitude: { value: 0 },

  // --- night: hooks for a day/night system, deliberately not constants yet ---
  /** 0 = the sun drives the sky; 1 = the sun's light is faded out, airglow only, and the sky goes see-through. */
  uNight: { value: 0 },
  /** Airglow, linear radiance per unit of (1 - transmittance). */
  uNightTint: { value: new Color(0.004, 0.007, 0.018) },
  /** Sky luminance at which it fully hides what is behind it (future stars). Below, alpha falls to `1 - T`. */
  uSkyHide: { value: 0.3 },
}

/** Once per frame, after the rebase. The subtraction is f64, which is the point. */
export function updateAtmosphereFrame(cameraAbs: Vector3, centreAbs: Vector3, radius: number): void {
  atmosphereUniforms.uPlanetRadius.value = radius
  atmosphereUniforms.uCamAltitude.value = cameraAbs.distanceTo(centreAbs) - radius
}
