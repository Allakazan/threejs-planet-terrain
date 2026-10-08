import { BackSide, CustomBlending, MeshBasicMaterial, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { shadingUniforms } from '../shading/shadingUniforms'
import { ATMOSPHERE_PARS } from './atmosphere.glsl'
import { atmosphereUniforms } from './atmosphereUniforms'

const SKY_VERTEX_PARS = /* glsl */ `
varying vec3 vSkyPos;
`

const SKY_VERTEX_BODY = /* glsl */ `
vSkyPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`

const SKY_FRAGMENT_PARS = /* glsl */ `
varying vec3 vSkyPos;
uniform vec3 uPlanetCentre;
uniform float uSkyHide;
${ATMOSPHERE_PARS}
`

/**
 * Replaces `<opaque_fragment>`. The mesh only decides which pixels run: the
 * shell and the ground are intersected analytically, so the sphere's facets
 * never show. A ray that misses the shell (the mesh is a little coarser than the
 * sphere at its silhouette) draws nothing.
 *
 * Output is premultiplied. Alpha is how much of what lies behind is hidden: at
 * least the air's extinction, and more where the sky is bright — a stand-in for
 * the eye's adaptation, so future stars vanish by day and show by night.
 */
const SKY_FRAGMENT_BODY = /* glsl */ `
vec3 sO = cameraPosition - uPlanetCentre;
vec3 sD = normalize( vSkyPos - cameraPosition );
vec2 sShell = atmoRaySphere( sO, sD, atmoSphereC( uCamAltitude, uAtmoHeight ) );
if ( sShell.x > sShell.y || sShell.y <= 0.0 ) discard;
float sT0 = max( sShell.x, 0.0 );
float sT1 = sShell.y;
// From inside the reference sphere (a deep valley) the ground test means nothing;
// the terrain occludes by depth anyway.
if ( uCamAltitude > 0.0 ) {
  vec2 sGround = atmoRaySphere( sO, sD, atmoSphereC( uCamAltitude, 0.0 ) );
  if ( sGround.x < sGround.y && sGround.x > 0.0 ) sT1 = min( sT1, sGround.x );
}
vec3 sTrans;
vec3 sIn = atmoScatter( sO, sD, sT0, sT1, sTrans );
float sClear = dot( sTrans, vec3( 1.0 / 3.0 ) );
float sLum = dot( sIn, vec3( 0.2126, 0.7152, 0.0722 ) );
float sAlpha = max( 1.0 - sClear, ( 1.0 - uNight ) * smoothstep( 0.0, uSkyHide, sLum ) );
gl_FragColor = vec4( sIn, sAlpha );
`

/**
 * The sky shell's material: a patched `MeshBasicMaterial` (a raw ShaderMaterial
 * would lose the logdepth chunks), drawn on its **back** faces. From inside the
 * shell they are the dome; from outside they are the far hemisphere, which covers
 * the disk and the rim. Over the disk it loses the depth test to the terrain,
 * which draws its own aerial perspective there.
 */
function createSkyMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  })
  material.defines = { ATMO_STEPS: '16', ATMO_LIGHT_STEPS: '4' }
  material.customProgramCacheKey = () => 'atmosphere-sky'
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms, { uPlanetCentre: shadingUniforms.uPlanetCentre })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SKY_VERTEX_PARS}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${SKY_VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SKY_FRAGMENT_PARS}`)
      .replace('#include <opaque_fragment>', SKY_FRAGMENT_BODY)
  }
  return material
}

export const skyMaterial = createSkyMaterial()
