import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping } from 'three'
import { NOISE_TEX_SIZE } from '../../core/constants'
import { mulberry32 } from '../terrain/simplex3d'

/**
 * White noise, four independent channels, bilinearly filtered — so sampled at
 * under one texel per pixel it reads as smooth value noise. One texture serves
 * every noise lookup in the terrain shaders:
 *
 * - **R** — the stochastic-tiling index (iq's "texture repetition", technique 3);
 * - **G** — the slope breakup;
 * - **B** — a second, finer breakup octave and the macro brightness.
 *
 * Seeded, so the planet looks the same on every load. Mipmapped: far away it
 * converges to 0.5, which is exactly "no breakup", so it cannot alias.
 */
function createNoiseTexture(seed: number): DataTexture {
  const size = NOISE_TEX_SIZE
  const random = mulberry32(seed)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256)

  const texture = new DataTexture(data, size, size, RGBAFormat)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

export const noiseTexture = createNoiseTexture(0x5eed)
