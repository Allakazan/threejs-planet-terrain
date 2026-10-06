/**
 * GLSL for the two terrain materials, injected into `MeshStandardMaterial` through
 * `onBeforeCompile` (a raw ShaderMaterial would drop three's logdepth chunks). See
 * docs/06 for the design; the comments here cover only what the code can't say.
 *
 * Two spaces are in play:
 * - **render space** — `vTerrainPos`, small near the camera, used for distances
 *   and, offset by `uTexOffset`, for texture coordinates;
 * - **world orientation** — chunks and the planet root only ever translate, so
 *   object-space normals *are* world normals. That is why neither material needs
 *   tangents.
 */

// --- vertex (both materials) ---

export const TERRAIN_VERTEX_PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
`

/** After `<worldpos_vertex>`, where `transformed` and `objectNormal` both exist. */
export const TERRAIN_VERTEX_BODY = /* glsl */ `
vTerrainPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTerrainNormal = objectNormal;
`

// --- fragment, shared ---

export const TERRAIN_PARS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;

uniform vec3 uPlanetCentre;
uniform vec3 uTexOffset;
uniform float uSwitchArc;
uniform vec3 uGroundAvg;
uniform vec3 uCliffAvg;
uniform float uSlopeStart;
uniform float uSlopeEnd;

/**
 * The one ground↔cliff rule. Both materials call it — the near one with tiled
 * textures, the far one with their average colours — which is what makes the
 * handover invisible. \`slope\` is 1 - N·up: 0 flat, 1 vertical.
 */
float terrainCliffWeight( float slope, float breakup ) {
  return smoothstep( uSlopeStart, uSlopeEnd, slope + breakup );
}

vec3 terrainAverageColour( float cliff ) {
  return mix( uGroundAvg, uCliffAvg, cliff );
}

/** Local up: away from the planet centre. World +Y is only up at one pole. */
vec3 terrainUp() {
  return normalize( vTerrainPos - uPlanetCentre );
}
`

/**
 * The debug grid, drawn inside the surface shader rather than as a wireframe
 * mesh: \`logarithmicDepthBuffer\` makes polygonOffset a no-op, so a second mesh
 * would z-fight. Line width is in pixels via \`fwidth\`, and both line kinds fade
 * once cells shrink below a few pixels. See docs/02.
 */
export const GRID_PARS = /* glsl */ `
uniform float uGrid;
uniform float uGridRes;
uniform float uGridWidth;
uniform float uBorderWidth;
`

export const GRID_BODY = /* glsl */ `
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

/** After `<normal_fragment_maps>`: hand the terrain's world normal to three's lighting. */
export const TERRAIN_NORMAL_BODY = /* glsl */ `
normal = normalize( ( viewMatrix * vec4( terrainWorldNormal, 0.0 ) ).xyz );
`

// --- fragment, near: triplanar / biplanar ---

export const NEAR_PARS = /* glsl */ `
uniform sampler2D uGroundAlbedo;
uniform sampler2D uGroundNormal;
uniform sampler2D uCliffAlbedo;
uniform sampler2D uCliffNormal;
uniform sampler2D uNoise;
uniform float uNoiseSize;
uniform float uGroundScale;
uniform float uCliffScale;
uniform float uMacroScale;
uniform float uMacroStrength;
uniform float uBreakupScale;
uniform float uBreakupStrength;
uniform float uTriSharpness;
uniform float uTriBias;
uniform float uBiSharpness;
uniform float uStochStart;
uniform float uStochEnd;
uniform float uHeightDepth;
uniform float uHeightInfluence;
uniform float uNearFadeStart;
uniform float uNearFadeEnd;

#ifdef TERRAIN_BIPLANAR
  #define TERRAIN_PROJECTIONS 2
#else
  #define TERRAIN_PROJECTIONS 3
#endif

/**
 * Projection along axis \`a\` reads the other two, cyclically: a=0 → (y,z),
 * a=1 → (z,x), a=2 → (x,y). The same rule maps a tangent-space normal back.
 */
vec2 terrainUv( vec3 p, int a ) {
  return vec2( p[ ( a + 1 ) % 3 ], p[ ( a + 2 ) % 3 ] );
}

/**
 * Which axes to project along, and how much each counts. Weights sum to 1.
 *
 * Triplanar: all three, \`max(|n| - bias, 0)^k\`. Biplanar (iq): the largest and
 * the middle axis only, with weights remapped so the dropped axis reaches zero
 * exactly where the choice of axes changes — that keeps it continuous.
 */
void terrainProjections( vec3 n, out int axis[ 3 ], out float weight[ 3 ] ) {
  vec3 a = abs( n );
#ifdef TERRAIN_BIPLANAR
  int ma = ( a.x > a.y && a.x > a.z ) ? 0 : ( a.y > a.z ? 1 : 2 );
  int mi = ( a.x < a.y && a.x < a.z ) ? 0 : ( a.y < a.z ? 1 : 2 );
  if ( mi == ma ) mi = ( ma + 1 ) % 3; // all three equal
  int me = 3 - mi - ma;
  axis[ 0 ] = ma;
  axis[ 1 ] = me;
  axis[ 2 ] = mi;
  vec2 w = clamp( ( vec2( a[ ma ], a[ me ] ) - 0.5773 ) / ( 1.0 - 0.5773 ), 0.0, 1.0 );
  w = pow( w, vec2( uBiSharpness ) );
  w /= max( w.x + w.y, 1e-5 );
  weight[ 0 ] = w.x;
  weight[ 1 ] = w.y;
  weight[ 2 ] = 0.0;
#else
  axis[ 0 ] = 0;
  axis[ 1 ] = 1;
  axis[ 2 ] = 2;
  vec3 w = pow( max( a - uTriBias, 0.0 ), vec3( uTriSharpness ) );
  w /= max( w.x + w.y + w.z, 1e-5 );
  weight[ 0 ] = w.x;
  weight[ 1 ] = w.y;
  weight[ 2 ] = w.z;
#endif
}

/**
 * Whiteout blend (Ben Golus, "Normal Mapping for a Triplanar Shader"): the
 * tangent-space normal of projection \`a\` added onto the surface normal, in world
 * space. Tangent x runs along the projection's u axis and y along its v, by
 * construction of \`terrainUv\`, so no tangent frame is needed.
 */
vec3 terrainWhiteout( vec3 tn, vec3 n, int a ) {
  int b = ( a + 1 ) % 3;
  int c = ( a + 2 ) % 3;
  vec3 r;
  r[ a ] = abs( tn.z ) * n[ a ];
  r[ b ] = tn.x + n[ b ];
  r[ c ] = tn.y + n[ c ];
  return r;
}

/**
 * One material, one projection: albedo (rgb + height in a) and a tangent-space
 * normal, both in tiles of \`uv\`.
 *
 * With stochastic tiling (iq, "texture repetition", technique 3) a noise lookup
 * picks two random offsets per region of about one tile and blends two taps.
 * Every fetch is \`textureGrad\` with the *un-offset* derivatives: the offsets jump
 * between regions, and implicit derivatives would turn each jump into a line of
 * wrongly chosen mips. \`stoch\` hardens the blend into a single tap with distance,
 * where repetition is no longer the problem and taps are wasted.
 */
void terrainSample( sampler2D albedoMap, sampler2D normalMap, vec2 uv, vec2 dx, vec2 dy, float stoch,
                    out vec4 albedo, out vec3 tnormal ) {
#ifdef TERRAIN_STOCHASTIC
  float s = 1.0 / uNoiseSize;
  float k = textureGrad( uNoise, uv * s, dx * s, dy * s ).r * 8.0;
  float ia = floor( k );
  vec2 oa = sin( vec2( 3.0, 7.0 ) * ia );
  vec2 ob = sin( vec2( 3.0, 7.0 ) * ( ia + 1.0 ) );
  float b = smoothstep( 0.2, 0.8, fract( k ) );
  b = mix( step( 0.5, b ), b, stoch );

  albedo = vec4( 0.0 );
  tnormal = vec3( 0.0 );
  if ( b < 0.999 ) {
    albedo += ( 1.0 - b ) * textureGrad( albedoMap, uv + oa, dx, dy );
    tnormal += ( 1.0 - b ) * textureGrad( normalMap, uv + oa, dx, dy ).xyz;
  }
  if ( b > 0.001 ) {
    albedo += b * textureGrad( albedoMap, uv + ob, dx, dy );
    tnormal += b * textureGrad( normalMap, uv + ob, dx, dy ).xyz;
  }
  tnormal = tnormal * 2.0 - 1.0;
#else
  albedo = textureGrad( albedoMap, uv, dx, dy );
  tnormal = textureGrad( normalMap, uv, dx, dy ).xyz * 2.0 - 1.0;
#endif
}
`

/**
 * After `<color_fragment>`. Leaves `terrainWorldNormal` in scope for
 * `TERRAIN_NORMAL_BODY`, which runs later in the same `main()`.
 */
export const NEAR_COLOR_BODY = /* glsl */ `
vec3 tN = normalize( vTerrainNormal );
float tDist = length( vTerrainPos - cameraPosition );
// 0 close up → 1 where the textures have fully given way to their average colours
float tFade = smoothstep( uNearFadeStart * uSwitchArc, uNearFadeEnd * uSwitchArc, tDist );
float tStoch = 1.0 - smoothstep( uStochStart, uStochEnd, tDist );

// Texture space: render position plus the f64-wrapped offset. Derivatives are
// taken here, in uniform control flow, and passed down explicitly.
vec3 tP = vTerrainPos + uTexOffset;
vec3 tPdx = dFdx( tP );
vec3 tPdy = dFdy( tP );

int tAxis[ 3 ];
float tW[ 3 ];
terrainProjections( tN, tAxis, tW );

// --- breakup: two octaves of value noise, projected like the textures, centred on 0 ---
float tBreak = 0.0;
{
  float s1 = 1.0 / ( uBreakupScale * uNoiseSize );
  float s2 = 4.0 * s1;
  for ( int i = 0; i < TERRAIN_PROJECTIONS; i++ ) {
    vec2 uv = terrainUv( tP, tAxis[ i ] );
    vec2 dx = terrainUv( tPdx, tAxis[ i ] );
    vec2 dy = terrainUv( tPdy, tAxis[ i ] );
    float n1 = textureGrad( uNoise, uv * s1, dx * s1, dy * s1 ).g;
    float n2 = textureGrad( uNoise, uv * s2, dx * s2, dy * s2 ).b;
    tBreak += tW[ i ] * ( 0.65 * n1 + 0.35 * n2 - 0.5 );
  }
}

float tSlope = 1.0 - dot( tN, terrainUp() );
float tCliff = terrainCliffWeight( tSlope, tBreak * 2.0 * uBreakupStrength );

vec3 terrainWorldNormal = tN;
vec3 tColour = terrainAverageColour( tCliff );

if ( tFade < 0.999 ) {
  bool needGround = tCliff < 0.999;
  bool needCliff = tCliff > 0.001;

  vec4 gA = vec4( 0.0 );
  vec4 cA = vec4( 0.0 );
  vec3 gN = vec3( 0.0 );
  vec3 cN = vec3( 0.0 );
  vec3 macro = vec3( 0.0 );

  for ( int i = 0; i < TERRAIN_PROJECTIONS; i++ ) {
    int a = tAxis[ i ];
    float w = tW[ i ];
    if ( w < 0.001 ) continue;
    vec2 uv = terrainUv( tP, a );
    vec2 dx = terrainUv( tPdx, a );
    vec2 dy = terrainUv( tPdy, a );
    vec4 albedo;
    vec3 tn;

    if ( needGround ) {
      float s = 1.0 / uGroundScale;
      terrainSample( uGroundAlbedo, uGroundNormal, uv * s, dx * s, dy * s, tStoch, albedo, tn );
      gA += w * albedo;
      gN += w * terrainWhiteout( tn, tN, a );
    }
    if ( needCliff ) {
      float s = 1.0 / uCliffScale;
      terrainSample( uCliffAlbedo, uCliffNormal, uv * s, dx * s, dy * s, tStoch, albedo, tn );
      cA += w * albedo;
      cN += w * terrainWhiteout( tn, tN, a );
    }

    // Macro: the ground albedo once more, huge and single-tap, read only for its
    // brightness. Breaks up the "carpet" that any tiling shows from altitude.
    float m = 1.0 / uMacroScale;
    macro += w * textureGrad( uGroundAlbedo, uv * m, dx * m, dy * m ).rgb;
  }

  // --- height blend: the slope weight decides the region, texture heights decide
  // the edge, so grass settles into the rock's cracks and rock tops poke through ---
  float ha = ( 1.0 - tCliff ) + gA.a * uHeightInfluence;
  float hb = tCliff + cA.a * uHeightInfluence;
  float hm = max( ha, hb ) - uHeightDepth;
  float wg = max( ha - hm, 0.0 );
  float wc = max( hb - hm, 0.0 );
  float ws = max( wg + wc, 1e-5 );
  wg /= ws;
  wc /= ws;

  vec3 textured = gA.rgb * wg + cA.rgb * wc;

  const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
  float macroLum = dot( macro, LUMA ) / max( dot( uGroundAvg, LUMA ), 1e-4 );
  textured *= mix( 1.0, clamp( macroLum, 0.5, 1.5 ), uMacroStrength );
  textured *= 1.0 + tBreak * uMacroStrength;

  vec3 mapped = vec3( 0.0 );
  if ( needGround ) mapped += wg * normalize( gN );
  if ( needCliff ) mapped += wc * normalize( cN );

  tColour = mix( textured, tColour, tFade );
  terrainWorldNormal = normalize( mix( mapped, tN, tFade ) );
}

diffuseColor.rgb *= tColour;
`

// --- fragment, far: the per-chunk bake ---

export const FAR_PARS = /* glsl */ `
uniform float uFarDetailStart;
uniform float uFarDetailEnd;
uniform float uCavityDarken;
uniform float uRidgeLighten;
`

/**
 * After `<color_fragment>`. The bake is three's own \`normalMap\` (so three plumbs
 * \`vNormalMapUv\`, including the texel-centre remap held in the texture's
 * offset/repeat). Inside the band where far chunks can border near ones, the
 * cavity is held at neutral and the normals read no finer than mip 1 — 64 texels
 * per chunk, the vertex spacing of its children — so both materials agree there.
 * See docs/06.
 */
export const FAR_COLOR_BODY = /* glsl */ `
float tDist = length( vTerrainPos - cameraPosition );
float tDetail = smoothstep( uFarDetailStart * uSwitchArc, uFarDetailEnd * uSwitchArc, tDist );
// An explicit floor on the mip level, not a bias: near the handover the texture is
// *magnified*, where a bias changes nothing.
vec2 tTexels = vNormalMapUv * vec2( textureSize( normalMap, 0 ) );
float tLod = 0.5 * log2( max( max( dot( dFdx( tTexels ), dFdx( tTexels ) ), dot( dFdy( tTexels ), dFdy( tTexels ) ) ), 1e-8 ) );
vec4 tBake = textureLod( normalMap, vNormalMapUv, max( tLod, 1.0 - tDetail ) );
vec3 terrainWorldNormal = normalize( tBake.xyz * 2.0 - 1.0 );
float tCavity = mix( 0.5, tBake.a, tDetail );

float tCliff = terrainCliffWeight( 1.0 - dot( terrainWorldNormal, terrainUp() ), 0.0 );
float tDark = clamp( ( 0.5 - tCavity ) * 2.0, 0.0, 1.0 );
float tRidge = clamp( ( tCavity - 0.5 ) * 2.0, 0.0, 1.0 );
float terrainFarAO = mix( 1.0, uCavityDarken, tDark );

diffuseColor.rgb *= terrainAverageColour( tCliff ) * terrainFarAO * mix( 1.0, uRidgeLighten, tRidge );
`

/** After `<aomap_fragment>`: valleys lose ambient light too, not just albedo. */
export const FAR_AO_BODY = /* glsl */ `
reflectedLight.indirectDiffuse *= terrainFarAO;
`
