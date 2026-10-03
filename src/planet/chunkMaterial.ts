import { MeshStandardMaterial } from 'three'
import {
  CHUNK_RESOLUTION,
  GRID_BORDER_WIDTH,
  GRID_LINE_WIDTH,
  SHOW_GRID,
} from '../core/constants'

/**
 * Shared by every chunk, so the whole planet is one shader program and toggling
 * the grid is a single uniform write rather than a per-chunk walk.
 */
const uniforms = {
  uGrid: { value: SHOW_GRID ? 1 : 0 },
  uGridRes: { value: CHUNK_RESOLUTION },
  uGridWidth: { value: GRID_LINE_WIDTH },
  uBorderWidth: { value: GRID_BORDER_WIDTH },
}

const GRID_PARS = /* glsl */ `
uniform float uGrid;
uniform float uGridRes;
uniform float uGridWidth;
uniform float uBorderWidth;
`

/**
 * The grid is drawn *inside the surface shader*, not as a second wireframe mesh.
 *
 * The obvious approach — a second mesh with `wireframe: true` and a
 * `polygonOffset` to lift it clear — cannot work here: `logarithmicDepthBuffer`
 * writes `gl_FragDepth`, and polygon offset is applied before that write, so it
 * becomes a no-op and you get guaranteed z-fighting along every line.
 *
 * Doing it in the fragment shader instead is one draw call, zero extra geometry,
 * immune to depth fighting, and shows the *quad* grid rather than triangle
 * diagonals — which is strictly more readable when the thing you are debugging is
 * a quadtree.
 *
 * Two details that are not optional:
 *
 * - **`fwidth` antialiasing.** Line width is measured in pixels, by dividing the
 *   uv-space distance to the nearest line by the uv-space size of one pixel.
 *   A fixed uv-space width would shimmer violently at distance.
 * - **Fading out when cells get smaller than a few pixels.** Below that, every
 *   pixel is inside a line and the surface turns into flat grey mush with moiré
 *   on top. The chunk border fades much later, since it stays useful far longer.
 */
const GRID_BODY = /* glsl */ `
#ifdef USE_UV
  if ( uGrid > 0.5 ) {
    // uv units covered by one pixel, in each direction
    vec2 px = max( fwidth( vUv ), vec2( 1e-9 ) );

    // uv-space distance to the nearest cell line (lines sit at integer uv*res)
    vec2 cell = abs( fract( vUv * uGridRes - 0.5 ) - 0.5 ) / uGridRes;
    float cellPx = min( cell.x / px.x, cell.y / px.y );
    float line = 1.0 - min( cellPx / uGridWidth, 1.0 );

    // uv-space distance to the patch border
    vec2 edge = min( vUv, 1.0 - vUv );
    float edgePx = min( edge.x / px.x, edge.y / px.y );
    float border = 1.0 - min( edgePx / uBorderWidth, 1.0 );

    float pxPerCell = 1.0 / ( max( px.x, px.y ) * uGridRes );
    line *= smoothstep( 1.5, 4.0, pxPerCell );
    border *= smoothstep( 4.0, 12.0, pxPerCell * uGridRes );

    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05 ), line * 0.6 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.11, 0.02 ), border );
  }
#endif
`

function createChunkMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0x8a8578,
    roughness: 0.95,
    metalness: 0,
  })

  // three only declares the generic `vUv` varying when USE_UV is defined, which
  // normally happens because some map is bound. Defining it by hand gets the uv
  // plumbed through by three's own chunks instead of a hand-rolled varying.
  material.defines = { USE_UV: '' }

  // Without this, three's program cache would happily hand this material the
  // unpatched standard program compiled for some other MeshStandardMaterial in
  // the scene — or hand that material *this* one.
  material.customProgramCacheKey = () => 'chunk-grid'

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <uv_pars_fragment>', `#include <uv_pars_fragment>\n${GRID_PARS}`)
      // after <color_fragment>, which is the last chunk to touch diffuseColor
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GRID_BODY}`)
  }

  return material
}

/**
 * Patching a built-in material through `onBeforeCompile` — rather than writing a
 * `ShaderMaterial` — is what keeps three's `logdepthbuf_*` chunks in the program.
 * A raw ShaderMaterial would drop them and break depth for the whole planet.
 */
export const chunkMaterial = createChunkMaterial()

export function setGridEnabled(on: boolean): void {
  uniforms.uGrid.value = on ? 1 : 0
}

export function isGridEnabled(): boolean {
  return uniforms.uGrid.value === 1
}
