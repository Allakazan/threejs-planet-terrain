import { Color, DataTexture, RGBAFormat, SRGBColorSpace, Vector3, Vector4 } from 'three'
import type { Texture } from 'three'
import {
  BIPLANAR_SHARPNESS,
  BREAKUP_DETAIL,
  BREAKUP_OCTAVE_RATIO,
  BREAKUP_SCALE,
  BREAKUP_STRENGTH,
  CAVITY_DARKEN,
  CHUNK_RESOLUTION,
  CLIFF_TEX_SCALE,
  GRID_BORDER_WIDTH,
  GRID_LINE_WIDTH,
  GROUND_TEX_SCALE,
  HEIGHT_BLEND_DEPTH,
  HEIGHT_BLEND_INFLUENCE,
  MACRO_RANGE,
  MACRO_STRENGTH,
  MACRO_TEX_SCALE,
  NOISE_TEX_SIZE,
  FAR_DETAIL_END,
  FAR_DETAIL_START,
  NEAR_FADE_END,
  NEAR_FADE_START,
  RIDGE_LIGHTEN,
  SHOW_GRID,
  SLOPE_CLIFF_END,
  SLOPE_CLIFF_START,
  STOCHASTIC_BLEND,
  STOCHASTIC_CELLS,
  STOCHASTIC_FADE_END,
  STOCHASTIC_FADE_START,
  TERRAIN_SHADER_MIN_LOD,
  TEX_PERIOD,
  TRIPLANAR_BIAS,
  TRIPLANAR_SHARPNESS,
} from '../../core/constants'
import { faceArc } from '../quadsphere'
import { noiseTexture } from './noiseTexture'

/** 1×1 stand-in until the real image arrives, so nothing samples an empty unit. */
function solidTexture(r: number, g: number, b: number, a: number, srgb: boolean): DataTexture {
  const texture = new DataTexture(new Uint8Array([r, g, b, a]), 1, 1, RGBAFormat)
  if (srgb) texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * Every uniform the near and far terrain materials share, as **one set of
 * objects**: each material's `onBeforeCompile` assigns these same objects into its
 * shader, so a write here reaches every chunk on the next draw and the grid toggle
 * stays a single store. Per-frame state (planet centre, texture offset) is written
 * by `updateShadingFrame`, and the textures by `terrainTextures` once they load.
 */
export const shadingUniforms = {
  // --- debug grid ---
  uGrid: { value: SHOW_GRID ? 1 : 0 },
  uGridRes: { value: CHUNK_RESOLUTION },
  uGridWidth: { value: GRID_LINE_WIDTH },
  uBorderWidth: { value: GRID_BORDER_WIDTH },

  // --- per frame ---
  /** Planet centre in render space. f32 is plenty for an up vector. */
  uPlanetCentre: { value: new Vector3() },
  /** `wrap(origin - centreAbs, TEX_PERIOD)`, computed in f64. See docs/06. */
  uTexOffset: { value: new Vector3() },
  /** Edge length of a level `TERRAIN_SHADER_MIN_LOD - 1` chunk: the handover's scale. */
  uSwitchArc: { value: 1 },

  // --- textures ---
  /** RGB albedo (sRGB) + A height. */
  uGroundAlbedo: { value: solidTexture(110, 120, 80, 128, true) as Texture },
  uGroundNormal: { value: solidTexture(128, 128, 255, 255, false) as Texture },
  uCliffAlbedo: { value: solidTexture(110, 105, 100, 128, true) as Texture },
  uCliffNormal: { value: solidTexture(128, 128, 255, 255, false) as Texture },
  /**
   * Linear average colour of each albedo, **graded** (see `uGroundGrade`): what the
   * textures converge to, and all the far material draws. Written by `materialStore`.
   */
  uGroundAvg: { value: new Color(0.14, 0.17, 0.08) },
  uCliffAvg: { value: new Color(0.15, 0.14, 0.12) },
  uNoise: { value: noiseTexture as Texture },
  uNoiseSize: { value: NOISE_TEX_SIZE },

  // --- tuning: defaults from the constants; the planet panel drives them through `materialStore` ---
  /** Albedo grading per slot: rgb = linear tint × brightness, w = saturation. */
  uGroundGrade: { value: new Vector4(1, 1, 1, 1) },
  uCliffGrade: { value: new Vector4(1, 1, 1, 1) },
  uGroundScale: { value: GROUND_TEX_SCALE },
  uCliffScale: { value: CLIFF_TEX_SCALE },
  uMacroScale: { value: MACRO_TEX_SCALE },
  uMacroStrength: { value: MACRO_STRENGTH },
  uMacroRange: { value: MACRO_RANGE },
  uBreakupScale: { value: BREAKUP_SCALE },
  uBreakupStrength: { value: BREAKUP_STRENGTH },
  uBreakupDetail: { value: BREAKUP_DETAIL },
  uBreakupRatio: { value: BREAKUP_OCTAVE_RATIO },
  uSlopeStart: { value: SLOPE_CLIFF_START },
  uSlopeEnd: { value: SLOPE_CLIFF_END },
  uTriSharpness: { value: TRIPLANAR_SHARPNESS },
  uTriBias: { value: TRIPLANAR_BIAS },
  uBiSharpness: { value: BIPLANAR_SHARPNESS },
  uStochStart: { value: STOCHASTIC_FADE_START },
  uStochEnd: { value: STOCHASTIC_FADE_END },
  uStochCells: { value: STOCHASTIC_CELLS },
  uStochBlend: { value: STOCHASTIC_BLEND },
  uHeightDepth: { value: HEIGHT_BLEND_DEPTH },
  uHeightInfluence: { value: HEIGHT_BLEND_INFLUENCE },
  uNearFadeStart: { value: NEAR_FADE_START },
  uNearFadeEnd: { value: NEAR_FADE_END },
  uFarDetailStart: { value: FAR_DETAIL_START },
  uFarDetailEnd: { value: FAR_DETAIL_END },
  uCavityDarken: { value: CAVITY_DARKEN },
  uRidgeLighten: { value: RIDGE_LIGHTEN },
}

/** Floored modulo: always in `[0, period)`, also for negative `x`. */
function wrap(x: number, period: number): number {
  return ((x % period) + period) % period
}

/**
 * Once per frame, after the rebase. `originAbs - centreAbs` is a planet-relative
 * position of ~10⁶ m, which f32 holds only to ~0.25 m — useless for a 4 m texture
 * tile. Wrapping it by `TEX_PERIOD` *here*, in f64, leaves the shader adding two
 * small numbers. When the wrap jumps, every coordinate moves by a whole period,
 * which every texture repeats over, so the jump is invisible.
 */
export function updateShadingFrame(
  planetCentreRender: Vector3,
  originAbs: Vector3,
  centreAbs: Vector3,
  radius: number,
): void {
  shadingUniforms.uPlanetCentre.value.copy(planetCentreRender)
  shadingUniforms.uTexOffset.value.set(
    wrap(originAbs.x - centreAbs.x, TEX_PERIOD),
    wrap(originAbs.y - centreAbs.y, TEX_PERIOD),
    wrap(originAbs.z - centreAbs.z, TEX_PERIOD),
  )
  shadingUniforms.uSwitchArc.value = faceArc(radius) / 2 ** Math.max(0, TERRAIN_SHADER_MIN_LOD - 1)
}
