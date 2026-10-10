# Plan 7 — Atmosphere: sky shell + aerial perspective

**Status: implemented 2026-10-06. Checked in a real browser (Chrome headless, ANGLE D3D11, RTX 4060 Ti, driven over
CDP): no shader compile warnings, ~144 fps, screenshots from 7.5 Mm down to 4 m above the ground.** See
[Verification](#verification).

Prerequisites: [02](02-quadsphere-lod-terrain.md) (logDepth, material patching) and
[06](06-terrain-shading.md) (the two terrain materials and their shared uniforms).

## Two halves

Single scattering (Rayleigh + Mie), split the way O'Neil splits it (GPU Gems 2, ch. 16):

| what | where | draws |
|---|---|---|
| **sky shell** | `atmosphere/SkyShell.tsx` + `skyMaterial.ts`: a sphere at `R + ATMOSPHERE_HEIGHT` | the sky from inside, the rim from outside |
| **aerial perspective** | spliced into **both** terrain materials by `patchTerrainShader` | `lit · T + inscatter` along camera → fragment: haze over the disk from orbit, distance fog near the ground |

Both call the same `atmoScatter` (`atmosphere/atmosphere.glsl.ts`) with the same uniform objects
(`atmosphereUniforms`), so the sky behind a mountain and the haze in front of it can't disagree.

**Why both terrain materials.** Near and far chunks border each other 1.3–3.2 switchArc out (≈6–18 km, docs/06). If
only the far material was hazed, that band would be a seam.

## The shell

- Drawn on its **back faces**. From inside, they are the dome. From outside, they are the far hemisphere, which covers
  the disk and the rim. One mesh and one shader work on both sides of the shell, so crossing it can't pop. Over the
  disk the shell is behind the terrain and loses the depth test; the terrain draws its own haze there.
- **The mesh only decides which pixels run.** The fragment intersects the view ray with the true shell and ground
  spheres analytically, so the facets of the 128×64 sphere (≤ 1.2 km sag) never show. A ray that misses the shell
  discards.
- A child of the planet's root group, so it rebases for free. A patched `MeshBasicMaterial`, not a `ShaderMaterial`:
  logDepth (docs/02).
- Transparent, `depthWrite: false`, premultiplied (`One`, `OneMinusSrcAlpha`). **Alpha** is how much of what lies
  behind is hidden: `max(1 - mean(T), smoothstep(0, uSkyHide, luminance))`. A bright sky hides it, as eye adaptation
  would, and a dark sky only extinguishes it. That is what lets stars behind it show at night and vanish by day. Tone
  mapping runs on premultiplied colour, which is only approximate where alpha < 1 (the outer rim). That is invisible
  against black space.

## Scattering

- **Density** is the flight model's profile (`atmosphereFactor`): an exponential renormalised to 1 at the surface and
  **exactly 0 at the shell**, so the rim fades to nothing instead of ending on an edge. The Rayleigh scale height is
  `ATMOSPHERE_SCALE_HEIGHT`, so what you see is what drags. Mie has its own (`ATMO_MIE_SCALE_HEIGHT`).
- **Coefficients** are derived in `atmosphereUniforms.applyAtmosphereUniforms`, not stored: Rayleigh β =
  `ATMO_RAYLEIGH_COEFFICIENTS` (Earth's, 1e-6/m) × 8 km / our scale height × density; Mie β = Earth's 21e-6/m ×
  1.2 km / our Mie scale height × density. Optical depth is β·H, so the column, and so the colours, stay Earth-like
  whatever the scale heights; other ratios between the three Rayleigh coefficients give other sky colours.
- **Raymarch**: uniform midpoint steps, `ATMO_STEPS` × `ATMO_LIGHT_STEPS`: 16×4 for the sky and 8×3 for the terrain.
  Light rays that hit the reference sphere are in shadow, which gives the night side and the red terminator. Phases:
  Rayleigh and Cornette-Shanks.
- **Sun**: the direction (azimuth/elevation, defaulting to `SUN_DIRECTION`) and `SUN_INTENSITY` are shared with the
  directional light (`SunLights`), so the light and the scattering can't drift apart. The scattering's sun is
  `ATMO_SUN_SCALE` (2) × `SUN_INTENSITY`. 1× is physically consistent with the terrain's lighting,
  but over this dim ground it reads as a grey sky. At 20 (the first guess) the haze buried the terrain from orbit.

### Tuning knobs

Defaults in `constants.ts`; live in the planet panel's **atmosphere** folder (`AtmosphereSettings`, applied by
`atmosphereStore`). Height and scale height drive the flight model too (`atmosphereState`); the collision patch stays
active up to at least the terrain's `maxElevation` + `COLLISION_ACTIVATION_MARGIN`, since the air can now be thinner
than the mountains are tall. Mie extinction (`ATMO_MIE_EXTINCTION`), the limb power of the space haze, the night hooks
and the raymarch step counts (a recompile) are panel knobs as well.

Looking straight down from orbit crosses the same air column as looking straight up from the ground, so physically
the disk's haze is exactly as bright as the zenith. You can't have a bright zenith and a subtle planet from space with
physical parameters alone, so the two are decoupled:

| constant | what it does |
|---|---|
| `ATMO_SUN_SCALE` | overall sky brightness, the **zenith lever**. Too high and the horizon washes out white. |
| `ATMO_SPACE_HAZE` (0..1) | haze over the terrain **seen from space looking down** (1 = physical). Fades in as the camera climbs through the atmosphere and back out at grazing angles, so the terrain's edge still meets the shell's rim without a ring. Artistic, terrain only. |
| `ATMO_RAYLEIGH_DENSITY` | air density relative to Earth. Changes how deep the blue is and how wide the rim is; barely changes zenith brightness (tested at 1.8). |
| `ATMO_MIE_SCALE_HEIGHT` / `ATMO_MIE_DENSITY` | how milky the horizon is and the size of the sun glow. |

### Precision

Rays are planet-relative (`cameraPosition - uPlanetCentre`, f32, about 0.25 m: fine for air). The weak spot is the
ray-sphere constant `c = |o|² - r²`: near the ground in f32 that is ~10¹³ minus ~10¹³, with an ulp of ~10⁶ m². So
`c` is built from the camera's altitude, which `updateAtmosphereFrame` computes **in f64 on the CPU**
(`uCamAltitude`), as `(alt - dr)(2R + alt + dr)`, and the roots use the stable `q`, `c/q` form. Sample altitudes along
the ray come from f32 `length(p) - R` (~0.5 m), which is irrelevant against kilometre scale heights.

## Night (`uNight`)

A hook for the future day/night system; deliberately not a constant yet. With the sun really below the horizon, night
already happens on its own. `uNight` (0..1) is for when it should happen without moving the sun:
- the sun's term in the scattering fades to 0;
- a faint airglow `uNightTint · (1 - T)` takes over (more of it at the horizon and on the rim, where there is more
  air);
- the sky's alpha falls to the bare extinction `1 - mean(T)`, so stars drawn behind it would show.

The terrain's own lighting is untouched; it stays lit. A day/night system drives both.

## Cost

~144 fps in every view, the same as before. The terrain pays 8×3 samples per fragment: if that ever shows up, a
Bruneton/Hillaire transmittance LUT is the next step. It is not needed yet.

## Not done

- Sunlight reaching the terrain is not filtered by the air (reddened at low sun). That belongs to lighting.
- The uniforms are singletons, like the terrain shading's: a second planet needs a set per planet.
- Uniform steps under-sample the Mie layer on long rays from orbit. The result is smooth, just not exact.

## Verification

Headless Chrome on a real GPU, the flycam placed by script (and the ship for the ground view), with the sun ~25° up at
the low views:

| view | what it showed |
|---|---|
| 3 R, sun behind camera | blue rim fading to nothing, haze over the disk, terrain readable |
| side-on, 2.2 R | day side, black night side, thin warm terminator in the rim |
| 500 km, limb | rim from above, smooth |
| 60 km | dark-blue zenith to pale horizon, craters fading with distance |
| 8 km, towards / away from the sun | sun glow (Mie), hazy horizon, **no seam at the near/far handover** |
| 8 km, up | plain blue |
| 8 km, `uNight = 1` | near-black sky (terrain still lit, as intended) |
| ship on the ground (camera ~4 m above the surface at 1.8 km) | clean sky, no banding at the horizon |

Not yet checked: flying through the shell at speed, and the hyperdrive dropping out at the shell.
