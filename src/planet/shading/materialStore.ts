import { Color } from 'three'
import type { Vector4 } from 'three'
import { applyNearOptions } from '../chunkMaterial'
import type { FarBakeSettings } from '../terrain/terrainSpec'
import { applyFarOptions } from './farMaterialPool'
import { DEFAULT_MATERIAL } from './materialSettings'
import type { MaterialSettings } from './materialSettings'
import { shadingUniforms } from './shadingUniforms'
import { terrainMaterialOptions } from './terrainMaterialOptions'
import { loadTexturePack } from './terrainTextures'

/**
 * The live terrain material, main thread only. A module singleton like the rest of
 * the app's per-frame state: `setMaterial` writes straight into the shared uniforms
 * (one write reaches every chunk), recompiles only when a define changes, and swaps
 * texture packs once they have loaded.
 *
 * The cavity settings are stored here but act through the terrain build — the
 * workers bake them — see `farBakeSettings`.
 */
let current: MaterialSettings = { ...DEFAULT_MATERIAL }

type Slot = 'ground' | 'cliff'

/** Each slot's albedo mean before grading; the stand-ins' until a pack lands. */
const rawAverage: Record<Slot, Color> = {
  ground: shadingUniforms.uGroundAvg.value.clone(),
  cliff: shadingUniforms.uCliffAvg.value.clone(),
}

/** The pack each slot last asked for: a load that lands after a newer request is dropped. */
const requested: Record<Slot, string | null> = { ground: null, cliff: null }

const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722
const tint = new Color()

export function getMaterial(): Readonly<MaterialSettings> {
  return current
}

/** What the workers need from the material, for the next terrain build. */
export function farBakeSettings(): FarBakeSettings {
  return { cavityRadius: current.cavityRadius, cavityGain: current.cavityGain }
}

/** Merges `patch` into the live material and applies it. */
export function setMaterial(patch: Partial<MaterialSettings>): void {
  current = { ...current, ...patch }
  apply()
}

function apply(): void {
  const m = current
  const u = shadingUniforms

  u.uGroundScale.value = m.groundScale
  u.uCliffScale.value = m.cliffScale
  u.uSlopeStart.value = m.slopeStart
  u.uSlopeEnd.value = m.slopeEnd
  u.uBreakupScale.value = m.breakupScale
  u.uBreakupStrength.value = m.breakupStrength
  u.uBreakupDetail.value = m.breakupDetail
  u.uBreakupRatio.value = m.breakupRatio
  u.uHeightDepth.value = m.heightBlendDepth
  u.uHeightInfluence.value = m.heightBlendInfluence
  u.uTriSharpness.value = m.triplanarSharpness
  u.uTriBias.value = m.triplanarBias
  u.uBiSharpness.value = m.biplanarSharpness
  u.uStochStart.value = m.stochasticFadeStart
  u.uStochEnd.value = m.stochasticFadeEnd
  u.uStochBlend.value = m.stochasticBlend
  u.uStochCells.value = m.stochasticCells
  u.uMacroScale.value = m.macroScale
  u.uMacroStrength.value = m.macroStrength
  u.uMacroRange.value = m.macroRange
  u.uNearFadeStart.value = m.nearFadeStart
  u.uNearFadeEnd.value = m.nearFadeEnd
  u.uFarDetailStart.value = m.farDetailStart
  u.uFarDetailEnd.value = m.farDetailEnd
  u.uCavityDarken.value = m.cavityDarken
  u.uRidgeLighten.value = m.ridgeLighten

  writeGrade(u.uGroundGrade.value, m.groundTint, m.groundBrightness, m.groundSaturation)
  writeGrade(u.uCliffGrade.value, m.cliffTint, m.cliffBrightness, m.cliffSaturation)
  gradeAverage('ground')
  gradeAverage('cliff')

  const o = terrainMaterialOptions
  o.biplanar = m.biplanar
  o.stochastic = m.stochastic
  o.nearRoughness = m.nearRoughness
  o.farRoughness = m.farRoughness
  applyNearOptions()
  applyFarOptions()

  if (requested.ground !== m.groundPack) bindPack('ground', m.groundPack)
  if (requested.cliff !== m.cliffPack) bindPack('cliff', m.cliffPack)
}

/** rgb = linear tint × brightness, w = saturation; the shader's `terrainGrade`. */
function writeGrade(out: Vector4, hex: string, brightness: number, saturation: number): void {
  // `Color.set` takes a hex string as sRGB and stores linear, which is what multiplies a linear albedo.
  tint.set(hex)
  out.set(tint.r * brightness, tint.g * brightness, tint.b * brightness, saturation)
}

/** The same grade on the mean, so the textures still converge to exactly what the far material draws. */
function gradeAverage(slot: Slot): void {
  const raw = rawAverage[slot]
  const grade = (slot === 'ground' ? shadingUniforms.uGroundGrade : shadingUniforms.uCliffGrade).value
  const out = (slot === 'ground' ? shadingUniforms.uGroundAvg : shadingUniforms.uCliffAvg).value
  const luma = raw.r * LUMA_R + raw.g * LUMA_G + raw.b * LUMA_B
  out.setRGB(
    (luma + (raw.r - luma) * grade.w) * grade.x,
    (luma + (raw.g - luma) * grade.w) * grade.y,
    (luma + (raw.b - luma) * grade.w) * grade.z,
  )
}

/** Until it lands, the slot keeps drawing its previous pack (or the 1×1 stand-in); a failure warns and leaves it. */
function bindPack(slot: Slot, key: string): void {
  requested[slot] = key
  loadTexturePack(key).then(
    (pack) => {
      if (requested[slot] !== key) return
      const u = shadingUniforms
      if (slot === 'ground') {
        u.uGroundAlbedo.value = pack.albedo
        u.uGroundNormal.value = pack.normal
      } else {
        u.uCliffAlbedo.value = pack.albedo
        u.uCliffNormal.value = pack.normal
      }
      rawAverage[slot].copy(pack.average)
      gradeAverage(slot)
    },
    (error: unknown) => {
      console.warn(`terrain texture pack "${key}" failed to load`, error)
    },
  )
}

// The defaults go live on import, so the planet draws the real textures even
// before (or without) the panel.
apply()
