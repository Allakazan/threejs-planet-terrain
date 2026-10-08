/**
 * Single scattering (Rayleigh + Mie), shared by the sky shell and the terrain's
 * aerial perspective, so the two can never disagree. See docs/07.
 *
 * Everything here is **planet-relative**: `o` is the camera minus the planet
 * centre (render space, f32 — about 0.25 m at this radius, plenty for air), and
 * rays are `o + t·d` with `|d| = 1`.
 *
 * `uPlanetCentre` is declared by whoever includes this (the terrain pars already
 * do), so it is not declared again here.
 */

export const ATMOSPHERE_PARS = /* glsl */ `
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uPlanetRadius;
uniform float uAtmoHeight;
uniform vec3 uRayleigh;
uniform float uRayleighH;
uniform float uMie;
uniform float uMieH;
uniform float uMieG;
uniform float uSpaceHaze;
uniform float uCamAltitude;
uniform float uNight;
uniform vec3 uNightTint;

#ifndef ATMO_STEPS
  #define ATMO_STEPS 8
#endif
#ifndef ATMO_LIGHT_STEPS
  #define ATMO_LIGHT_STEPS 3
#endif

/** Mie extinction over scattering: aerosols absorb about a tenth. */
#define ATMO_MIE_EXT 1.11

/**
 * The flight model's density profile (\`atmosphereFactor\`): an exponential
 * renormalised to 1 at the surface and exactly 0 at the shell, so the rim fades
 * out instead of ending on an edge. Below the reference sphere (valleys) it holds 1.
 */
float atmoDensity( float h, float scaleHeight ) {
  float top = exp( -uAtmoHeight / scaleHeight );
  return max( ( exp( -max( h, 0.0 ) / scaleHeight ) - top ) / ( 1.0 - top ), 0.0 );
}

/**
 * \`|o|² - r²\` for a point at altitude \`alt\` over the reference sphere, against
 * a sphere of radius \`R + dr\`, factored so nothing large cancels. In f32 the
 * naive form near the ground is ~10¹³ minus ~10¹³, with an ulp of ~10⁶ m².
 */
float atmoSphereC( float alt, float dr ) {
  return ( alt - dr ) * ( 2.0 * uPlanetRadius + alt + dr );
}

/**
 * Both roots of \`t² + 2bt + c = 0\` — the ray against a sphere about the planet
 * centre — in the stable form (the larger root first, the other as c/q). Returns
 * (near, far), or near > far on a miss.
 */
vec2 atmoRaySphere( vec3 o, vec3 d, float c ) {
  float b = dot( o, d );
  float disc = b * b - c;
  if ( disc < 0.0 ) return vec2( 1.0, -1.0 );
  float s = sqrt( disc );
  float q = b > 0.0 ? -b - s : -b + s;
  if ( abs( q ) < 1e-6 ) return vec2( 0.0 );
  float r = c / q;
  return vec2( min( q, r ), max( q, r ) );
}

/** (Rayleigh, Mie) optical depth from \`p\` (altitude \`h\`) to the sun; huge in the planet's shadow. */
vec2 atmoSunDepth( vec3 p, float h ) {
  // One exit only: an early return here draws "potentially uninitialized" warnings from ANGLE/D3D.
  vec2 g = atmoRaySphere( p, uSunDir, atmoSphereC( h, 0.0 ) );
  float shadow = ( h > 0.0 && g.x < g.y && g.x > 0.0 ) ? 1e9 : 0.0;
  float len = max( atmoRaySphere( p, uSunDir, atmoSphereC( h, uAtmoHeight ) ).y, 0.0 );
  float ds = len / float( ATMO_LIGHT_STEPS );
  vec2 od = vec2( 0.0 );
  for ( int i = 0; i < ATMO_LIGHT_STEPS; i++ ) {
    vec3 q = p + uSunDir * ( ( float( i ) + 0.5 ) * ds );
    float hq = length( q ) - uPlanetRadius;
    od += vec2( atmoDensity( hq, uRayleighH ), atmoDensity( hq, uMieH ) );
  }
  return od * ds + shadow;
}

/**
 * Light scattered towards the eye along \`o + t·d\`, t ∈ [t0, t1]; \`trans\` gets
 * what survives of whatever lies behind. Midpoint rule, uniform steps.
 *
 * \`uNight\` (0..1) is an override for a future day/night system: it fades the
 * sun's contribution out and lets a faint airglow, proportional to the air
 * crossed, take over. With the sun really below the horizon, night happens on
 * its own; this is for when it should happen without moving the sun.
 */
vec3 atmoScatter( vec3 o, vec3 d, float t0, float t1, out vec3 trans ) {
  float ds = ( t1 - t0 ) / float( ATMO_STEPS );
  vec3 betaM = vec3( uMie );
  vec2 od = vec2( 0.0 );
  vec3 sumR = vec3( 0.0 );
  vec3 sumM = vec3( 0.0 );
  for ( int i = 0; i < ATMO_STEPS; i++ ) {
    vec3 p = o + d * ( t0 + ( float( i ) + 0.5 ) * ds );
    float h = length( p ) - uPlanetRadius;
    vec2 dens = vec2( atmoDensity( h, uRayleighH ), atmoDensity( h, uMieH ) ) * ds;
    vec2 sun = atmoSunDepth( p, h );
    vec2 depth = od + 0.5 * dens + sun;
    vec3 att = exp( -( uRayleigh * depth.x + betaM * ATMO_MIE_EXT * depth.y ) );
    sumR += dens.x * att;
    sumM += dens.y * att;
    od += dens;
  }
  trans = exp( -( uRayleigh * od.x + betaM * ATMO_MIE_EXT * od.y ) );

  float mu = dot( d, uSunDir );
  float phaseR = 3.0 / ( 16.0 * PI ) * ( 1.0 + mu * mu );
  float g2 = uMieG * uMieG;
  // Cornette-Shanks: Henyey-Greenstein with the Rayleigh-like (1 + mu²) term.
  float phaseM = 3.0 / ( 8.0 * PI ) * ( ( 1.0 - g2 ) * ( 1.0 + mu * mu ) )
               / ( ( 2.0 + g2 ) * pow( max( 1.0 + g2 - 2.0 * uMieG * mu, 1e-4 ), 1.5 ) );

  float sun = uSunIntensity * ( 1.0 - uNight );
  return sun * ( sumR * uRayleigh * phaseR + sumM * betaM * phaseM ) + uNightTint * uNight * ( 1.0 - trans );
}
`

/**
 * Terrain, before \`<opaque_fragment>\` (so before tone mapping): the surface seen
 * through the air between it and the camera. From space the segment starts where
 * the view ray enters the shell.
 */
export const TERRAIN_ATMOSPHERE_BODY = /* glsl */ `
{
  vec3 aO = cameraPosition - uPlanetCentre;
  vec3 aV = vTerrainPos - cameraPosition;
  float aLen = length( aV );
  vec3 aD = aV / max( aLen, 1e-6 );
  vec2 aShell = atmoRaySphere( aO, aD, atmoSphereC( uCamAltitude, uAtmoHeight ) );
  float aT0 = max( aShell.x, 0.0 );
  float aT1 = min( aShell.y, aLen );
  if ( aShell.x < aShell.y && aT1 > aT0 ) {
    vec3 aTrans;
    vec3 aIn = atmoScatter( aO, aD, aT0, aT1, aTrans );
    // Artistic: from space, thin the haze over the disk (uSpaceHaze), but not at
    // grazing angles, where the terrain's edge meets the sky shell's rim.
    float aSpace = smoothstep( 0.0, uAtmoHeight, uCamAltitude );
    float aGrazing = 1.0 - abs( dot( aD, normalize( vTerrainPos - uPlanetCentre ) ) );
    float aHaze = mix( 1.0, uSpaceHaze, aSpace * ( 1.0 - pow( aGrazing, 4.0 ) ) );
    outgoingLight = outgoingLight * mix( vec3( 1.0 ), aTrans, aHaze ) + aIn * aHaze;
  }
}
`
