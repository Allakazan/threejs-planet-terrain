import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Color } from 'three'
import { shadingUniforms } from './shadingUniforms'

/**
 * The two materials. Swapping a set is one line here: any folder under
 * `public/textures/terrain/` with an albedo, a **GL** (not DX) normal map and a
 * height map works. Maps are resized to the albedo's size on load.
 */
const ROOT = `${import.meta.env.BASE_URL}textures/terrain/`

type MaterialSet = { readonly albedo: string; readonly normal: string; readonly height: string }

const GROUND: MaterialSet = {
  albedo: `${ROOT}Grass001_1K-PNG/Grass001_1K-PNG_Color.png`,
  normal: `${ROOT}Grass001_1K-PNG/Grass001_1K-PNG_NormalGL.png`,
  height: `${ROOT}Grass001_1K-PNG/Grass001_1K-PNG_Displacement.png`,
}

const CLIFF: MaterialSet = {
  albedo: `${ROOT}forest_ground_04_1k/forest_ground_04_diff_1k.png`,
  normal: `${ROOT}forest_ground_04_1k/forest_ground_04_nor_gl_1k.png`,
  height: `${ROOT}forest_ground_04_1k/forest_ground_04_disp_1k.png`,
}

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

async function loadSet(set: MaterialSet, avg: Color): Promise<{ albedo: DataTexture; normal: DataTexture }> {
  const albedo = await loadPixels(set.albedo)
  const size = { width: albedo.width, height: albedo.height }
  const [height, normal] = await Promise.all([loadPixels(set.height, size), loadPixels(set.normal, size)])
  averageColour(albedo, avg)
  return {
    albedo: tilingTexture(pack(albedo, height), size.width, size.height, true),
    normal: tilingTexture(pack(normal, null), size.width, size.height, false),
  }
}

/**
 * Fire-and-forget, once, from module scope. Until it lands the materials draw
 * the 1×1 stand-ins in `shadingUniforms`; a failure leaves them there and warns.
 */
async function loadTerrainTextures(): Promise<void> {
  const u = shadingUniforms
  const [ground, cliff] = await Promise.all([loadSet(GROUND, u.uGroundAvg.value), loadSet(CLIFF, u.uCliffAvg.value)])
  u.uGroundAlbedo.value = ground.albedo
  u.uGroundNormal.value = ground.normal
  u.uCliffAlbedo.value = cliff.albedo
  u.uCliffNormal.value = cliff.normal
}

loadTerrainTextures().catch((error: unknown) => {
  console.warn('terrain textures failed to load; using flat stand-ins', error)
})
