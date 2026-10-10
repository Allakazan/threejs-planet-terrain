import {
  BIPLANAR_SHARPNESS,
  BREAKUP_DETAIL,
  BREAKUP_OCTAVE_RATIO,
  BREAKUP_SCALE,
  BREAKUP_STRENGTH,
  CAVITY_DARKEN,
  CAVITY_GAIN,
  CAVITY_RADIUS,
  CLIFF_TEX_PACK,
  CLIFF_TEX_SCALE,
  FAR_DETAIL_END,
  FAR_DETAIL_START,
  FAR_ROUGHNESS,
  GROUND_TEX_PACK,
  GROUND_TEX_SCALE,
  HEIGHT_BLEND_DEPTH,
  HEIGHT_BLEND_INFLUENCE,
  MACRO_RANGE,
  MACRO_STRENGTH,
  MACRO_TEX_SCALE,
  NEAR_FADE_END,
  NEAR_FADE_START,
  NEAR_ROUGHNESS,
  RIDGE_LIGHTEN,
  SLOPE_CLIFF_END,
  SLOPE_CLIFF_START,
  STOCHASTIC_BLEND,
  STOCHASTIC_CELLS,
  STOCHASTIC_FADE_END,
  STOCHASTIC_FADE_START,
  TRIPLANAR_BIAS,
  TRIPLANAR_SHARPNESS,
  USE_BIPLANAR,
  USE_STOCHASTIC_TILING,
} from '../../core/constants'

/**
 * The terrain material as plain data: what a preset stores, the planet panel
 * edits, and `materialStore` applies. See docs/06 for what each knob does; the
 * constants of the same names document them.
 *
 * Every tile scale must divide `TEX_PERIOD` (powers of two), or each rebase shows
 * a seam; the panel only offers such values.
 */
export type MaterialSettings = {
  // --- textures ---
  /** Keys into `TEXTURE_PACKS`. */
  groundPack: string
  cliffPack: string
  /** Albedo grading per slot, applied to the texture and its average alike: hex sRGB tint, brightness, saturation (0 = grey). */
  groundTint: string
  groundBrightness: number
  groundSaturation: number
  cliffTint: string
  cliffBrightness: number
  cliffSaturation: number
  /** Metres per tile. */
  groundScale: number
  cliffScale: number

  // --- slope blend ---
  slopeStart: number
  slopeEnd: number
  breakupScale: number
  breakupStrength: number
  breakupDetail: number
  breakupRatio: number
  heightBlendDepth: number
  heightBlendInfluence: number

  // --- projection ---
  biplanar: boolean
  triplanarSharpness: number
  triplanarBias: number
  biplanarSharpness: number

  // --- tiling ---
  stochastic: boolean
  stochasticFadeStart: number
  stochasticFadeEnd: number
  stochasticBlend: number
  stochasticCells: number
  macroScale: number
  macroStrength: number
  macroRange: number

  // --- near/far handover, in switch arcs ---
  nearFadeStart: number
  nearFadeEnd: number
  farDetailStart: number
  farDetailEnd: number

  // --- far bake ---
  /** Baked by the workers: changing these rebuilds the planet. */
  cavityRadius: number
  cavityGain: number
  cavityDarken: number
  ridgeLighten: number

  // --- surface ---
  nearRoughness: number
  farRoughness: number
}

export const DEFAULT_MATERIAL: Readonly<MaterialSettings> = {
  groundPack: GROUND_TEX_PACK,
  cliffPack: CLIFF_TEX_PACK,
  groundTint: '#ffffff',
  groundBrightness: 1,
  groundSaturation: 1,
  cliffTint: '#ffffff',
  cliffBrightness: 1,
  cliffSaturation: 1,
  groundScale: GROUND_TEX_SCALE,
  cliffScale: CLIFF_TEX_SCALE,

  slopeStart: SLOPE_CLIFF_START,
  slopeEnd: SLOPE_CLIFF_END,
  breakupScale: BREAKUP_SCALE,
  breakupStrength: BREAKUP_STRENGTH,
  breakupDetail: BREAKUP_DETAIL,
  breakupRatio: BREAKUP_OCTAVE_RATIO,
  heightBlendDepth: HEIGHT_BLEND_DEPTH,
  heightBlendInfluence: HEIGHT_BLEND_INFLUENCE,

  biplanar: USE_BIPLANAR,
  triplanarSharpness: TRIPLANAR_SHARPNESS,
  triplanarBias: TRIPLANAR_BIAS,
  biplanarSharpness: BIPLANAR_SHARPNESS,

  stochastic: USE_STOCHASTIC_TILING,
  stochasticFadeStart: STOCHASTIC_FADE_START,
  stochasticFadeEnd: STOCHASTIC_FADE_END,
  stochasticBlend: STOCHASTIC_BLEND,
  stochasticCells: STOCHASTIC_CELLS,
  macroScale: MACRO_TEX_SCALE,
  macroStrength: MACRO_STRENGTH,
  macroRange: MACRO_RANGE,

  nearFadeStart: NEAR_FADE_START,
  nearFadeEnd: NEAR_FADE_END,
  farDetailStart: FAR_DETAIL_START,
  farDetailEnd: FAR_DETAIL_END,

  cavityRadius: CAVITY_RADIUS,
  cavityGain: CAVITY_GAIN,
  cavityDarken: CAVITY_DARKEN,
  ridgeLighten: RIDGE_LIGHTEN,

  nearRoughness: NEAR_ROUGHNESS,
  farRoughness: FAR_ROUGHNESS,
}

/** A preset's material: the defaults with its own changes on top. */
export function material(overrides: Partial<MaterialSettings>): MaterialSettings {
  return { ...DEFAULT_MATERIAL, ...overrides }
}
