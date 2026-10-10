import type { Vector3 } from 'three'
import { MAX_LOD_LEVEL } from '../../core/constants'
import { quadSize } from '../quadsphere'
import { Cellular3D } from './cellular3d'
import { Simplex3D, mulberry32 } from './simplex3d'
import { NoiseBasis } from './terrainSpec'
import type { LayerMask, TerrainBuild, TerrainSpec } from './terrainSpec'
import type { TerrainSource } from './TerrainSource'

/**
 * Musgrave's ridged-multifractal feedback: an octave's weight is the previous
 * octave's signal times this, so detail piles onto crests and valleys stay smooth.
 */
const RIDGE_FEEDBACK = 2
/** Decorrelates the three warp channels, which share one simplex. In noise units. */
const WARP_OFFSET_Y = 31.7
const WARP_OFFSET_Z = 73.1

/** One layer, flattened into what the per-vertex loop wants. */
type CompiledLayer = {
  readonly enabled: boolean
  readonly basis: NoiseBasis
  readonly amplitude: number
  readonly octaves: number
  readonly lacunarity: number
  readonly gain: number
  /** `1 - gain`: the inverse of the infinite amplitude series. */
  readonly normaliser: number
  /** 1 / wavelength of octave 0, so noise coordinates are `metres · this`. */
  readonly frequency: number
  /** `(x,y,z)` per octave. Stops the octaves sharing a lattice origin. */
  readonly offsets: Float64Array
  /**
   * Nyquist weight of every octave at every level, `[level · octaves + i]`. Weights
   * fall as `i` grows, so the loop can stop at the first zero.
   */
  readonly weights: Float64Array
  readonly simplex: Simplex3D
  readonly cellular: Cellular3D
  readonly masks: readonly LayerMask[]
  readonly warp: {
    readonly frequency: number
    readonly strength: number
    /** Nyquist weight per level, like `weights`. */
    readonly weights: Float64Array
    readonly noise: Simplex3D
  } | null
  /** Some later layer masks on this one, so its value is needed even when it adds no relief. */
  readonly isMaskSource: boolean
}

function smoothstep01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/**
 * The tail-fade rule from the old single-FBM terrain, applied to each octave.
 *
 * An octave finer than two quads cannot be represented by the mesh and only adds
 * shimmer. `log_lac(λ / 2q)` is how far an octave of wavelength `λ` sits above that
 * limit, measured in octaves. Smoothstepping it over one octave lets new detail grow
 * in across a level instead of popping at the boundary.
 */
function nyquistWeight(wavelength: number, level: number, radius: number, lacunarity: number): number {
  return smoothstep01(Math.log(wavelength / (2 * quadSize(radius, level))) / Math.log(lacunarity))
}

/** Stable seed per layer, from the planet seed and the layer's own offset. */
function layerSeed(seed: number, seedOffset: number, salt: number): number {
  return (Math.imul(seed, 0x9e3779b1) ^ Math.imul(seedOffset + salt, 0x85ebca77)) | 0
}

/**
 * A stack of noise layers, each a band-limited fractal sum of one basis, with its
 * own wavelength and amplitude in metres, an optional domain warp, and optional
 * masks read from earlier layers. See docs/04.
 *
 * It keeps the two LOD rules the single-FBM terrain had:
 *
 * **1. Normalisation is level-independent.** A layer's octave sum is scaled by the
 * *infinite* series `1 - gain`, never by the octaves actually used, so adding an
 * octave only ever adds detail on top of a fixed shape. The planet does not
 * "breathe" as you descend.
 *
 * **2. Every octave obeys Nyquist** (`nyquistWeight`). A layer whose base
 * wavelength is below the mesh's resolution costs nothing at that level. Bases are
 * scaled so that "no octaves" means 0, which is also what a skipped layer adds.
 *
 * Masks are expected to be coarse. A layer that something masks on always gets its
 * octave 0 at full weight for its *mask* value, so masks never alias away. Its
 * relief still follows Nyquist.
 */
export class LayeredTerrain implements TerrainSource {
  private readonly layers: CompiledLayer[]
  private readonly radius: number
  /** Normalised value of each layer for the current sample. Read by later masks. */
  private readonly values: Float64Array

  constructor(seed: number, radius: number, spec: TerrainSpec) {
    this.radius = radius
    const count = spec.layers.length
    this.values = new Float64Array(count)

    const maskSources = new Set<number>()
    spec.layers.forEach((layer, index) => {
      for (const mask of layer.masks) {
        if (mask.layer >= 0 && mask.layer < index) maskSources.add(mask.layer)
      }
    })

    const levels = MAX_LOD_LEVEL + 1
    this.layers = spec.layers.map((layer, index): CompiledLayer => {
      const octaves = Math.max(1, Math.floor(layer.octaves))
      const lacunarity = Math.max(1.01, layer.lacunarity)
      const gain = Math.min(0.99, Math.max(0, layer.gain))
      const wavelength = Math.max(1e-3, layer.wavelength)

      const random = mulberry32(layerSeed(seed, layer.seedOffset, 1))
      const offsets = new Float64Array(octaves * 3)
      for (let i = 0; i < offsets.length; i++) offsets[i] = random() * 256

      const weights = new Float64Array(levels * octaves)
      for (let level = 0; level < levels; level++) {
        let lambda = wavelength
        for (let i = 0; i < octaves; i++) {
          weights[level * octaves + i] = nyquistWeight(lambda, level, radius, lacunarity)
          lambda /= lacunarity
        }
      }

      let warp: CompiledLayer['warp'] = null
      if (layer.warp !== null && layer.warp.strength !== 0 && layer.warp.wavelength > 0) {
        const warpWeights = new Float64Array(levels)
        for (let level = 0; level < levels; level++) {
          warpWeights[level] = nyquistWeight(layer.warp.wavelength, level, radius, 2)
        }
        warp = {
          frequency: 1 / layer.warp.wavelength,
          strength: layer.warp.strength,
          weights: warpWeights,
          noise: new Simplex3D(layerSeed(seed, layer.seedOffset, 2)),
        }
      }

      return {
        enabled: layer.enabled,
        basis: layer.basis,
        amplitude: layer.amplitude,
        octaves,
        lacunarity,
        gain,
        normaliser: 1 - gain,
        frequency: 1 / wavelength,
        offsets,
        weights,
        simplex: new Simplex3D(layerSeed(seed, layer.seedOffset, 3)),
        cellular: new Cellular3D(layerSeed(seed, layer.seedOffset, 4)),
        // Forward references are dropped here, so the evaluation order is always valid.
        masks: layer.masks.filter((mask) => mask.layer >= 0 && mask.layer < index),
        warp,
        isMaskSource: maskSources.has(index),
      }
    })
  }

  getAltitude(dir: Vector3, level: number): number {
    const lvl = Math.min(Math.max(0, level), MAX_LOD_LEVEL)
    const { layers, values } = this
    const sx = dir.x * this.radius
    const sy = dir.y * this.radius
    const sz = dir.z * this.radius
    let altitude = 0

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li]
      values[li] = 0
      if (!layer.enabled) continue

      let mask = 1
      for (const m of layer.masks) {
        const span = m.hi - m.lo
        mask *= span === 0 ? (values[m.layer] >= m.lo ? 1 : 0) : smoothstep01((values[m.layer] - m.lo) / span)
        if (mask === 0) break
      }

      if (layer.basis === NoiseBasis.Constant) {
        values[li] = 1
        altitude += layer.amplitude * mask
        continue
      }

      const wantRelief = mask > 0 && layer.amplitude !== 0 && layer.weights[lvl * layer.octaves] > 0
      if (!wantRelief && !layer.isMaskSource) continue

      // --- domain warp, in metres ---
      let px = sx
      let py = sy
      let pz = sz
      const warp = layer.warp
      if (warp !== null) {
        const w = warp.weights[lvl] * warp.strength
        if (w > 0) {
          const wx = sx * warp.frequency
          const wy = sy * warp.frequency
          const wz = sz * warp.frequency
          px += w * warp.noise.noise(wx, wy, wz)
          py += w * warp.noise.noise(wx + WARP_OFFSET_Y, wy + WARP_OFFSET_Y, wz + WARP_OFFSET_Y)
          pz += w * warp.noise.noise(wx + WARP_OFFSET_Z, wy + WARP_OFFSET_Z, wz + WARP_OFFSET_Z)
        }
      }

      // --- the fractal sum. `relief` follows Nyquist; `value` forces octave 0 in. ---
      const { octaves, weights, offsets, basis, simplex, cellular, lacunarity, gain } = layer
      const base = lvl * octaves
      let frequency = layer.frequency
      let amplitude = 1
      let ridgeWeight = 1
      let relief = 0
      let value = 0

      for (let i = 0; i < octaves; i++) {
        const w = weights[base + i]
        const wv = i === 0 && layer.isMaskSource ? 1 : w
        if (w === 0 && wv === 0) break

        const o = i * 3
        const x = px * frequency + offsets[o]
        const y = py * frequency + offsets[o + 1]
        const z = pz * frequency + offsets[o + 2]

        let n: number
        switch (basis) {
          case NoiseBasis.Simplex:
            n = simplex.noise(x, y, z)
            break
          case NoiseBasis.Ridged: {
            const r = 1 - Math.abs(simplex.noise(x, y, z))
            n = r * r * ridgeWeight
            ridgeWeight = Math.min(1, Math.max(0, n * RIDGE_FEEDBACK))
            break
          }
          case NoiseBasis.Billow:
            n = 2 * Math.abs(simplex.noise(x, y, z))
            break
          case NoiseBasis.WorleyF1:
            cellular.worley(x, y, z)
            n = cellular.f1
            break
          case NoiseBasis.WorleyF2:
            cellular.worley(x, y, z)
            n = cellular.f2
            break
          case NoiseBasis.WorleyF2F1:
            cellular.worley(x, y, z)
            n = cellular.f2 - cellular.f1
            break
          case NoiseBasis.Crater:
            n = cellular.craters(x, y, z)
            break
          default:
            n = 0
        }

        relief += w * amplitude * n
        value += wv * amplitude * n
        amplitude *= gain
        frequency *= lacunarity
      }

      values[li] = value * layer.normaliser
      if (wantRelief) altitude += relief * layer.normaliser * layer.amplitude * mask
    }

    return altitude
  }
}

// --- registry: build per version, terrain per (seed, radius, version) ---

/**
 * Builds (spec + bake settings) by version. The main thread registers through
 * `terrainStore`; a worker registers whatever the pool sends it. Kept short: once a
 * version is replaced, only requests already posted can still name it.
 */
const builds = new Map<number, TerrainBuild>()
const BUILDS_KEPT = 2

const cache = new Map<string, LayeredTerrain>()

export function registerTerrainBuild(version: number, build: TerrainBuild): void {
  builds.set(version, build)
  for (const old of builds.keys()) {
    if (old <= version - BUILDS_KEPT) builds.delete(old)
  }
  for (const key of cache.keys()) {
    const keyVersion = Number(key.slice(key.lastIndexOf(':') + 1))
    if (!builds.has(keyVersion)) cache.delete(key)
  }
}

export function terrainBuildFor(version: number): TerrainBuild {
  const build = builds.get(version)
  if (build === undefined) throw new Error(`terrain build v${version} was never registered on this thread`)
  return build
}

export function terrainSpecFor(version: number): TerrainSpec {
  return terrainBuildFor(version).spec
}

/**
 * Memoised. Each thread builds its own from `seed` + `radius` + `version` (a
 * `TerrainSource` cannot cross `postMessage`), and since construction is pure, all
 * threads get bit-identical altitudes — which is what keeps the split test and the
 * chunks in agreement.
 */
export function layeredTerrain(seed: number, radius: number, version: number): LayeredTerrain {
  const key = `${seed}:${radius}:${version}`
  let terrain = cache.get(key)
  if (terrain === undefined) {
    terrain = new LayeredTerrain(seed, radius, terrainSpecFor(version))
    cache.set(key, terrain)
  }
  return terrain
}
