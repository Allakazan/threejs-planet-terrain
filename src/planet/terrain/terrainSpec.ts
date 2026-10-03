/**
 * The terrain as plain data: an ordered stack of noise layers. Plain data because
 * it has to cross `postMessage` to the workers and round-trip through JSON for the
 * debug panel's "copy" button. See docs/04 for the design.
 */

/** Noise functions a layer can be built from. See `LayeredTerrain`. */
export const NoiseBasis = {
  Simplex: 'simplex',
  /** `(1-|n|)²` with Musgrave weighting — sharp crests, smooth valleys. */
  Ridged: 'ridged',
  /** `2|n|-1` — rounded hills, creased valleys. */
  Billow: 'billow',
  /** Distance to the nearest Worley point — round pits. */
  WorleyF1: 'worleyF1',
  /** Distance to the second-nearest — bulging cells. */
  WorleyF2: 'worleyF2',
  /** `F2-F1` — cell walls; plates, cracked mud, dunes when warped. */
  WorleyF2F1: 'worleyF2F1',
  /** Impact craters (bowl, flat floor, raised rim) on a jittered grid. */
  Crater: 'crater',
  /** Always 1. With a mask, it lifts or sinks whole regions flat (plateaus, maria). */
  Constant: 'constant',
} as const
export type NoiseBasis = (typeof NoiseBasis)[keyof typeof NoiseBasis]

export const NOISE_BASES: readonly NoiseBasis[] = Object.values(NoiseBasis)

/**
 * `smoothstep(lo, hi, value of an earlier layer)`. `lo > hi` inverts it. The value
 * read is the source layer's *normalised* noise (≈ [-1, 1]), before its amplitude
 * and its own masks — so a layer with `amplitude: 0` works as a pure mask.
 */
export type LayerMask = {
  /** Index of the source layer. Must be lower than this layer's own index. */
  layer: number
  lo: number
  hi: number
}

/** Domain warp: the sample point is pushed around by a low-frequency 3D simplex. */
export type LayerWarp = {
  /** metres */
  wavelength: number
  /** metres of displacement at full noise */
  strength: number
}

export type TerrainLayer = {
  name: string
  enabled: boolean
  basis: NoiseBasis
  /** Wavelength of octave 0, metres. */
  wavelength: number
  /** Metres of relief at normalised noise = 1. Negative flips the layer. */
  amplitude: number
  /** Upper bound; the Nyquist rule decides how many are actually used per LOD. */
  octaves: number
  lacunarity: number
  /** Amplitude ratio between octaves. Must stay below 1. */
  gain: number
  /** Decorrelates layers that share a basis. Any integer. */
  seedOffset: number
  /** Multiplied together. Empty means unmasked. */
  masks: LayerMask[]
  warp: LayerWarp | null
}

export type TerrainSpec = {
  name: string
  layers: TerrainLayer[]
}

/** Upper bound on |altitude|. Loose on purpose — it only feeds a ray test. */
export function maxElevation(spec: TerrainSpec): number {
  let sum = 0
  for (const layer of spec.layers) {
    if (layer.enabled) sum += Math.abs(layer.amplitude)
  }
  return sum
}
