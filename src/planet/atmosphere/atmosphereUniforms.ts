import { Color, Vector3 } from 'three'
import { ATMO_RAYLEIGH_EARTH_SCALE_HEIGHT } from '../../core/constants'
import { DEFAULT_ATMOSPHERE, sunDirection } from './atmosphereSettings'
import type { AtmosphereSettings } from './atmosphereSettings'

/** Earth's haze: Mie scattering at sea level, 1/m, and the scale height it belongs to. */
const MIE_EARTH_BETA = 21e-6
const MIE_EARTH_SCALE_HEIGHT = 1_200

/**
 * Every atmosphere uniform, as one set of objects shared by the sky shell and
 * both terrain materials (the same pattern as `shadingUniforms`): a write here
 * reaches all of them on the next draw. Singletons, so a second planet needs a
 * set of its own.
 */
export const atmosphereUniforms = {
  /** Towards the sun, unit length. */
  uSunDir: { value: new Vector3() },
  uSunIntensity: { value: 0 },
  uPlanetRadius: { value: 1 },
  uAtmoHeight: { value: 0 },
  /** β per channel, 1/m. Derived, see `applyAtmosphereUniforms`. */
  uRayleigh: { value: new Vector3() },
  uRayleighH: { value: 0 },
  uMie: { value: 0 },
  uMieH: { value: 0 },
  /** Mie extinction over scattering. */
  uMieExt: { value: 0 },
  uMieG: { value: 0 },
  uSpaceHaze: { value: 0 },
  uHazeGrazing: { value: 0 },

  // --- per frame ---
  /** Camera altitude over the reference sphere, computed in f64. See `atmoSphereC`. */
  uCamAltitude: { value: 0 },

  // --- night: hooks for a day/night system ---
  /** 0 = the sun drives the sky; 1 = the sun's light is faded out, airglow only, and the sky goes see-through. */
  uNight: { value: 0 },
  /** Airglow, linear radiance per unit of (1 - transmittance). */
  uNightTint: { value: new Color() },
  /** Sky luminance at which it fully hides what is behind it (future stars). Below, alpha falls to `1 - T`. */
  uSkyHide: { value: 0 },
}

/**
 * Writes `settings` into the uniforms, deriving the scattering coefficients:
 *
 * - **Rayleigh** β = coefficients · (Earth's 8 km / our scale height) · density.
 *   Optical depth is β·H, so this keeps Earth's column — and its blue — whatever
 *   the scale height, and `density` scales the column.
 * - **Mie** β = Earth's 21e-6/m · (1.2 km / our Mie scale height) · density, by the
 *   same argument.
 */
export function applyAtmosphereUniforms(settings: AtmosphereSettings): void {
  const u = atmosphereUniforms
  const rayleighScale = (ATMO_RAYLEIGH_EARTH_SCALE_HEIGHT / settings.scaleHeight) * settings.rayleighDensity * 1e-6
  const [r, g, b] = settings.rayleighCoefficients
  u.uRayleigh.value.set(r * rayleighScale, g * rayleighScale, b * rayleighScale)
  u.uRayleighH.value = settings.scaleHeight
  u.uMie.value = MIE_EARTH_BETA * (MIE_EARTH_SCALE_HEIGHT / settings.mieScaleHeight) * settings.mieDensity
  u.uMieH.value = settings.mieScaleHeight
  u.uMieExt.value = settings.mieExtinction
  u.uMieG.value = settings.mieG
  u.uAtmoHeight.value = settings.height

  sunDirection(settings, u.uSunDir.value)
  u.uSunIntensity.value = settings.sunIntensity * settings.airSunScale
  u.uSpaceHaze.value = settings.spaceHaze
  u.uHazeGrazing.value = settings.hazeGrazingPower

  u.uNight.value = settings.night
  const [nr, ng, nb] = settings.nightTint
  u.uNightTint.value.setRGB(nr * 1e-3, ng * 1e-3, nb * 1e-3)
  u.uSkyHide.value = settings.skyHide
}

applyAtmosphereUniforms(DEFAULT_ATMOSPHERE)

/** Once per frame, after the rebase. The subtraction is f64, which is the point. */
export function updateAtmosphereFrame(cameraAbs: Vector3, centreAbs: Vector3, radius: number): void {
  atmosphereUniforms.uPlanetRadius.value = radius
  atmosphereUniforms.uCamAltitude.value = cameraAbs.distanceTo(centreAbs) - radius
}
