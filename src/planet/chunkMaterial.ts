import { MeshStandardMaterial } from 'three'
import type { WebGLProgramParametersWithUniforms } from 'three'
import { ATMOSPHERE_PARS, TERRAIN_ATMOSPHERE_BODY } from './atmosphere/atmosphere.glsl'
import { atmosphereUniforms } from './atmosphere/atmosphereUniforms'
import { shadingUniforms } from './shading/shadingUniforms'
import { definesChanged, sharedTerrainDefines, terrainMaterialOptions } from './shading/terrainMaterialOptions'
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

/**
 * Splices the terrain GLSL shared by the near and far materials into a standard
 * shader: the varyings, the shared pars, the grid, and the aerial perspective.
 * Each material adds its own colour and normal stages around it.
 *
 * The atmosphere goes in here, for both, because near and far chunks border each
 * other kilometres out: haze on one side only would be a seam (docs/07).
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
  Object.assign(shader.uniforms, shadingUniforms, atmosphereUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${TERRAIN_VERTEX_BODY}`)
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <uv_pars_fragment>',
      `#include <uv_pars_fragment>\n${GRID_PARS}\n${TERRAIN_PARS}\n${ATMOSPHERE_PARS}\n${fragmentPars}`,
    )
    // After <color_fragment>, the last chunk to touch diffuseColor; the grid goes
    // on top of the terrain colour.
    .replace('#include <color_fragment>', `#include <color_fragment>\n${colourBody}\n${GRID_BODY}`)
    // The lit colour, seen through the air — before tone mapping.
    .replace('#include <opaque_fragment>', `${TERRAIN_ATMOSPHERE_BODY}\n#include <opaque_fragment>`)
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
function nearDefines(): Record<string, string> {
  const defines = sharedTerrainDefines()
  if (terrainMaterialOptions.biplanar) defines.TERRAIN_BIPLANAR = ''
  if (terrainMaterialOptions.stochastic) defines.TERRAIN_STOCHASTIC = ''
  return defines
}

function createChunkMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: terrainMaterialOptions.nearRoughness,
    metalness: 0,
  })
  material.defines = nearDefines()

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

/** Re-reads `terrainMaterialOptions`. Recompiles only when a define actually changed. */
export function applyNearOptions(): void {
  chunkMaterial.roughness = terrainMaterialOptions.nearRoughness
  const defines = nearDefines()
  if (!definesChanged(chunkMaterial.defines, defines)) return
  chunkMaterial.defines = defines
  chunkMaterial.needsUpdate = true
}

export function setGridEnabled(on: boolean): void {
  shadingUniforms.uGrid.value = on ? 1 : 0
}

export function isGridEnabled(): boolean {
  return shadingUniforms.uGrid.value === 1
}
