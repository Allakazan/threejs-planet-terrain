import { Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three'
import { TEXTURE_PACKS } from './texturePacks'
import type { TexturePack } from './texturePacks'

const ANISOTROPY = 8

type Pixels = { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }

/**
 * Raw pixels, untouched: no colour-space conversion and no premultiplication, so
 * a normal map's bytes are its vectors and a height map's are its heights.
 */
async function loadPixels(url: string, size?: { width: number; height: number }): Promise<Pixels> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const width = size?.width ?? bitmap.width
  const height = size?.height ?? bitmap.height
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('no 2d context')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return { width, height, data: context.getImageData(0, 0, width, height).data }
}

/**
 * `rgb` from one image and `a` from the red channel of another (or 255), rows
 * flipped so v runs up the image — the convention GL normal maps are authored in.
 * Packing by hand rather than through a canvas is deliberate: a canvas stores
 * premultiplied alpha and would wreck the colour wherever the height is low.
 */
function pack(rgb: Pixels, alpha: Pixels | null): Uint8Array<ArrayBuffer> {
  const { width, height } = rgb
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4
    const dst = y * width * 4
    for (let x = 0; x < width * 4; x += 4) {
      out[dst + x] = rgb.data[src + x]
      out[dst + x + 1] = rgb.data[src + x + 1]
      out[dst + x + 2] = rgb.data[src + x + 2]
      out[dst + x + 3] = alpha === null ? 255 : alpha.data[src + x]
    }
  }
  return out
}

function tilingTexture(data: Uint8Array<ArrayBuffer>, width: number, height: number, srgb: boolean): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat)
  if (srgb) texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = LinearFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = ANISOTROPY
  texture.needsUpdate = true
  return texture
}

/** sRGB byte → linear, as a table. */
const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Mean colour in **linear** space — the same average the GPU's sRGB mip chain
 * converges to, so a texture faded to this colour does not shift at the handover.
 */
function averageColour(pixels: Pixels, out: Color): void {
  let r = 0
  let g = 0
  let b = 0
  const { data } = pixels
  for (let i = 0; i < data.length; i += 4) {
    r += SRGB_TO_LINEAR[data[i]]
    g += SRGB_TO_LINEAR[data[i + 1]]
    b += SRGB_TO_LINEAR[data[i + 2]]
  }
  const n = data.length / 4
  out.setRGB(r / n, g / n, b / n)
}

/** A pack ready to bind: RGB albedo (sRGB) + A height, the GL normal, and the albedo's linear mean. */
export type LoadedPack = { readonly albedo: DataTexture; readonly normal: DataTexture; readonly average: Color }

async function loadSet(set: TexturePack): Promise<LoadedPack> {
  const albedo = await loadPixels(set.albedo)
  const size = { width: albedo.width, height: albedo.height }
  const [height, normal] = await Promise.all([loadPixels(set.height, size), loadPixels(set.normal, size)])
  const average = new Color()
  averageColour(albedo, average)
  return {
    albedo: tilingTexture(pack(albedo, height), size.width, size.height, true),
    normal: tilingTexture(pack(normal, null), size.width, size.height, false),
    average,
  }
}

/**
 * Loaded packs, by key. Kept for the session, so flipping back to a pack in the
 * panel is instant; a failed load is dropped, so the next request retries.
 */
const loaded = new Map<string, Promise<LoadedPack>>()

/** Loads a pack (once) from `TEXTURE_PACKS`. Rejects on an unknown key or a failed fetch. */
export function loadTexturePack(key: string): Promise<LoadedPack> {
  let promise = loaded.get(key)
  if (promise === undefined) {
    const set = TEXTURE_PACKS[key]
    if (set === undefined) return Promise.reject(new Error(`unknown texture pack "${key}"`))
    promise = loadSet(set)
    promise.catch(() => loaded.delete(key))
    loaded.set(key, promise)
  }
  return promise
}
