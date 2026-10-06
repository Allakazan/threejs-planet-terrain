import { MeshStandardMaterial } from 'three'
import type { WebGLProgramParametersWithUniforms } from 'three'
import { USE_BIPLANAR, USE_STOCHASTIC_TILING } from '../core/constants'
import { shadingUniforms } from './shading/shadingUniforms'
import {
  GRID_BODY,
  GRID_PARS,
  NEAR_COLOR_BODY,
  NEAR_PARS,
  TERRAIN_NORMAL_BODY,
  TERRAIN_PARS,
  TERRAIN_VERTEX_BODY,
  TERRAIN_VERTEX_PARS,
} from './shading/terrainShading.glsl'
// Side effect: starts loading the terrain textures into `shadingUniforms`.
import './shading/terrainTextures'

/**
 * Splices the terrain GLSL shared by the near and far materials into a standard
 * shader: the varyings, the shared pars, the grid. Each material adds its own
 * colour and normal stages around it.
 *
 * Patching a built-in material through `onBeforeCompile` — rather than writing a
 * `ShaderMaterial` — is what keeps three's `logdepthbuf_*` chunks in the program.
 * A raw ShaderMaterial would drop them and break depth for the whole planet.
 */
export function patchTerrainShader(
  shader: WebGLProgramParametersWithUniforms,
  fragmentPars: string,
  colourBody: string,
): void {
  Object.assign(shader.uniforms, shadingUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${TERRAIN_VERTEX_BODY}`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <uv_pars_fragment>', `#include <uv_pars_fragment>\n${GRID_PARS}\n${TERRAIN_PARS}\n${fragmentPars}`)
    // After <color_fragment>, the last chunk to touch diffuseColor; the grid goes
    // on top of the terrain colour.
    .replace('#include <color_fragment>', `#include <color_fragment>\n${colourBody}\n${GRID_BODY}`)
}

/**
 * The **near** material: triplanar (or biplanar) ground and cliff textures,
 * chosen by slope against the local up, height-blended, with stochastic tiling,
 * macro variation and a distance fade to the textures' average colours. Used for
 * every chunk at `TERRAIN_SHADER_MIN_LOD` and finer.
 *
 * Shared by all those chunks, so they are one shader program and every tuning
 * value is a single uniform write.
 */
function createChunkMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.99,
    metalness: 0,
  })

  // three only declares the generic `vUv` varying when USE_UV is defined, which
  // normally happens because some map is bound. Defining it by hand gets the uv
  // plumbed through by three's own chunks — the grid reads it.
  material.defines = { USE_UV: '' }
  if (USE_BIPLANAR) material.defines.TERRAIN_BIPLANAR = ''
  if (USE_STOCHASTIC_TILING) material.defines.TERRAIN_STOCHASTIC = ''

  // Without this, three's program cache would happily hand this material the
  // unpatched standard program compiled for some other MeshStandardMaterial in
  // the scene — or hand that material *this* one.
  material.customProgramCacheKey = () => 'terrain-near'

  material.onBeforeCompile = (shader) => {
    patchTerrainShader(shader, NEAR_PARS, NEAR_COLOR_BODY)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${TERRAIN_NORMAL_BODY}`,
    )
  }

  return material
}

export const chunkMaterial = createChunkMaterial()

export function setGridEnabled(on: boolean): void {
  shadingUniforms.uGrid.value = on ? 1 : 0
}

export function isGridEnabled(): boolean {
  return shadingUniforms.uGrid.value === 1
}
