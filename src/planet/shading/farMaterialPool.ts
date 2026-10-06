import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  ObjectSpaceNormalMap,
  RGBAFormat,
} from 'three'
import { FAR_TEX_RES } from '../../core/constants'
import { patchTerrainShader } from '../chunkMaterial'
import { FAR_AO_BODY, FAR_COLOR_BODY, FAR_PARS, TERRAIN_NORMAL_BODY } from './terrainShading.glsl'

/**
 * The **far** material: one per chunk coarser than `TERRAIN_SHADER_MIN_LOD`,
 * because each owns its baked texture (`farBake.ts`). They all share one shader
 * program (same cache key) and the same shared-uniform objects; only the
 * `normalMap` differs, which three swaps per draw like any other material's map.
 *
 * Pooled like the chunk geometries: recycling is `data.set` + `needsUpdate`, and
 * nothing is disposed during normal operation.
 */
function createFarMaterial(): MeshStandardMaterial {
  const size = FAR_TEX_RES
  const texture = new DataTexture(new Uint8Array(size * size * 4), size, size, RGBAFormat)
  texture.magFilter = LinearFilter
  // Mipmapped: the shader reads one level coarser near the handover.
  texture.minFilter = LinearMipmapLinearFilter
  texture.generateMipmaps = true
  // The bake's first and last texels sit *on* the chunk edges; map uv 0..1 onto
  // texel centres so neighbours agree there. three applies this through
  // `normalMapTransform`, so the shader needs no remap of its own.
  texture.repeat.set((size - 1) / size, (size - 1) / size)
  texture.offset.set(0.5 / size, 0.5 / size)

  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    normalMap: texture,
    normalMapType: ObjectSpaceNormalMap,
  })
  material.defines = { USE_UV: '' }
  material.customProgramCacheKey = () => 'terrain-far'
  material.onBeforeCompile = (shader) => {
    patchTerrainShader(shader, FAR_PARS, FAR_COLOR_BODY)
    shader.fragmentShader = shader.fragmentShader
      // Replaces three's object-space path outright: the normal was already read
      // with the colour, at the handover's mip bias.
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL_BODY)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FAR_AO_BODY}`)
  }
  return material
}

const pool: MeshStandardMaterial[] = []
let created = 0

/** A far material holding `bake`. Return it with `releaseFarMaterial`. */
export function acquireFarMaterial(bake: Uint8Array): MeshStandardMaterial {
  let material = pool.pop()
  if (material === undefined) {
    material = createFarMaterial()
    created++
  }
  const texture = material.normalMap as DataTexture
  ;(texture.image.data as Uint8Array).set(bake)
  texture.needsUpdate = true
  return material
}

export function releaseFarMaterial(material: MeshStandardMaterial): void {
  pool.push(material)
}

/** For the HUD: far materials (and textures) ever made, and how many are parked. */
export function farMaterialStats(): { created: number; free: number } {
  return { created, free: pool.length }
}
