import type { Vector3 } from 'three'
import {
  AMBIENT_INTENSITY,
  ATMO_HAZE_GRAZING_POWER,
  ATMO_MIE_DENSITY,
  ATMO_MIE_EXTINCTION,
  ATMO_MIE_G,
  ATMO_MIE_SCALE_HEIGHT,
  ATMO_NIGHT,
  ATMO_NIGHT_TINT,
  ATMO_RAYLEIGH_COEFFICIENTS,
  ATMO_RAYLEIGH_DENSITY,
  ATMO_SKY_HIDE,
  ATMO_SKY_LIGHT_STEPS,
  ATMO_SKY_STEPS,
  ATMO_SPACE_HAZE,
  ATMO_SUN_SCALE,
  ATMO_TERRAIN_LIGHT_STEPS,
  ATMO_TERRAIN_STEPS,
  ATMOSPHERE_HEIGHT,
  ATMOSPHERE_SCALE_HEIGHT,
  SUN_DIRECTION,
  SUN_INTENSITY,
} from '../../core/constants'

const DEG = Math.PI / 180

/**
 * The atmosphere and the sun as plain data: what a preset stores, the planet
 * panel edits, and `atmosphereStore` applies. See docs/07; the constants of the
 * same names document each field. Height and scale height are the flight model's
 * too (`atmosphereState`).
 */
export type AtmosphereSettings = {
  /** Shell height over the radius, metres. Also where drag starts and the hyperdrive cuts out. */
  height: number
  /** Rayleigh (and flight-density) e-folding height, metres. */
  scaleHeight: number
  rayleighDensity: number
  /** 1e-6/m, R G B, at Earth's 8 km scale height. */
  rayleighCoefficients: [number, number, number]
  mieScaleHeight: number
  mieDensity: number
  mieExtinction: number
  mieG: number

  /** Degrees. Azimuth turns about +Y from +Z towards +X; elevation lifts towards +Y. */
  sunAzimuth: number
  sunElevation: number
  /** The directional light. */
  sunIntensity: number
  /** The scattering's sun, as a multiple of `sunIntensity`. */
  airSunScale: number
  ambient: number

  spaceHaze: number
  hazeGrazingPower: number

  night: number
  /** Airglow, linear radiance in 1e-3, R G B. */
  nightTint: [number, number, number]
  skyHide: number

  terrainSteps: number
  terrainLightSteps: number
  skySteps: number
  skyLightSteps: number
}

/** `SUN_DIRECTION` as angles, so the default sun is exactly the constant's. */
function sunAngles(): { azimuth: number; elevation: number } {
  const [x, y, z] = SUN_DIRECTION
  return {
    azimuth: Math.atan2(x, z) / DEG,
    elevation: Math.asin(y / Math.hypot(x, y, z)) / DEG,
  }
}

const SUN = sunAngles()

export const DEFAULT_ATMOSPHERE: Readonly<AtmosphereSettings> = {
  height: ATMOSPHERE_HEIGHT,
  scaleHeight: ATMOSPHERE_SCALE_HEIGHT,
  rayleighDensity: ATMO_RAYLEIGH_DENSITY,
  rayleighCoefficients: [...ATMO_RAYLEIGH_COEFFICIENTS],
  mieScaleHeight: ATMO_MIE_SCALE_HEIGHT,
  mieDensity: ATMO_MIE_DENSITY,
  mieExtinction: ATMO_MIE_EXTINCTION,
  mieG: ATMO_MIE_G,

  sunAzimuth: SUN.azimuth,
  sunElevation: SUN.elevation,
  sunIntensity: SUN_INTENSITY,
  airSunScale: ATMO_SUN_SCALE,
  ambient: AMBIENT_INTENSITY,

  spaceHaze: ATMO_SPACE_HAZE,
  hazeGrazingPower: ATMO_HAZE_GRAZING_POWER,

  night: ATMO_NIGHT,
  nightTint: [ATMO_NIGHT_TINT[0] * 1e3, ATMO_NIGHT_TINT[1] * 1e3, ATMO_NIGHT_TINT[2] * 1e3],
  skyHide: ATMO_SKY_HIDE,

  terrainSteps: ATMO_TERRAIN_STEPS,
  terrainLightSteps: ATMO_TERRAIN_LIGHT_STEPS,
  skySteps: ATMO_SKY_STEPS,
  skyLightSteps: ATMO_SKY_LIGHT_STEPS,
}

/** A preset's atmosphere: the defaults with its own changes on top. */
export function atmosphere(overrides: Partial<AtmosphereSettings>): AtmosphereSettings {
  return { ...DEFAULT_ATMOSPHERE, ...overrides }
}

/** Towards the sun, unit length. */
export function sunDirection(settings: AtmosphereSettings, out: Vector3): Vector3 {
  const azimuth = settings.sunAzimuth * DEG
  const elevation = settings.sunElevation * DEG
  return out.set(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  )
}

/**
 * The live atmosphere shape, for the flight model and the collision patch: plain
 * numbers, so the pure flight code needs no store. `atmosphereStore` writes it.
 */
export const atmosphereState = {
  height: DEFAULT_ATMOSPHERE.height,
  scaleHeight: DEFAULT_ATMOSPHERE.scaleHeight,
}
