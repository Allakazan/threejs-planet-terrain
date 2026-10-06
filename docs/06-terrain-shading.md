# Plan 6 — Terrain shading: near triplanar + far "satellite" bake

**Status: implemented 2026-10-05. The bake was verified headlessly, and the shaders were checked in a real browser
(Chrome/ANGLE D3D11, RTX 4060 Ti): no compile errors, 140+ fps, screenshots from orbit to 200 m.** See
[Verification](#verification).

Prerequisites: [02](02-quadsphere-lod-terrain.md) (chunks, material patching, logDepth) and
[04](04-layered-terrain.md) (the terrain function).

## Two materials, switched by LOD

| chunk level | material | colour | normals |
|---|---|---|---|
| `>= TERRAIN_SHADER_MIN_LOD` (11) | **near**, `chunkMaterial.ts`, one shared instance | triplanar ground and cliff textures | vertex normal + triplanar normal maps |
| `<` | **far**, `shading/farMaterialPool.ts`, one per chunk | average texture colours × cavity | per-chunk baked object-space normal map |

`TERRAIN_SHADER_MIN_LOD` is the tuning dial. Both materials patch `MeshStandardMaterial` via `onBeforeCompile`, as
logDepth requires (docs/02). Both splice in the same GLSL from `shading/terrainShading.glsl.ts`, and both bind the same
uniform objects from `shading/shadingUniforms.ts`.

## Near: triplanar

**"Which texture" is separate from "how it's projected".**
- *Selection* compares the slope against **local up**: `up = normalize(vTerrainPos - uPlanetCentre)`,
  `slope = 1 - N·up`, `cliff = smoothstep(SLOPE_CLIFF_START, SLOPE_CLIFF_END, slope + breakup)`. World +Y is only up
  at one pole.
- *Projection* is plain world-axis triplanar, which is isotropic: no up vector, no tangents, and no seams anywhere on
  the sphere. A cube-face tangent frame would break at the 12 cube edges.

Chunks and the planet root only ever translate, so **object-space normals are world normals**. That is why the vertex
normal goes straight into a varying.

**Precision.** Texture coordinates are `vTerrainPos + uTexOffset`. `uTexOffset = wrap(origin - centreAbs, TEX_PERIOD)`
is computed **in f64 on the CPU** every frame (`updateShadingFrame`). A planet-relative position in f32 has about
0.25 m steps, which would ruin a 4 m tile. When the wrap jumps, every coordinate moves by a whole `TEX_PERIOD`.
**Every periodic thing the shader samples must have a period that divides `TEX_PERIOD` (8192 m):**

| sampled | period |
|---|---|
| ground / cliff tile | 4 / 8 m |
| macro | 128 m |
| stochastic index (`NOISE_TEX_SIZE` tiles) | 1024 / 2048 m |
| breakup octaves | 8192 / 2048 m |

Change a scale and you must keep this table true, or a seam appears every time the origin rebases across a period.

**Pipeline**, in `NEAR_COLOR_BODY`:
1. **Projections**: biplanar (iq; the 2 dominant axes, with weights remapped to stay continuous) or triplanar
   (`max(|n| - bias, 0)^k`). Selected by `USE_BIPLANAR`.
2. **Breakup**: two value-noise octaves from the shared noise texture (`noiseTexture.ts`, seeded, mipmapped so it
   averages to "no breakup" at distance) push `slope`. The ground/cliff line stops being a contour.
3. **Per material, per projection**: `terrainSample` reads albedo + height (packed into albedo **alpha** at load time)
   and a tangent normal. With `USE_STOCHASTIC_TILING` this is iq's technique 3: one noise read picks two random
   offsets per region of about one tile, and two taps are blended. **Every fetch is `textureGrad` with the un-offset
   derivatives.** Implicit derivatives would draw a line of wrong mips at every offset jump. The blend hardens to one
   tap between `STOCHASTIC_FADE_START` and `STOCHASTIC_FADE_END`. A material with weight < 0.001 is skipped.
4. **Normal maps**: Golus' whiteout blend per projection. Tangent x/y run along the projection's u/v by construction
   (`terrainUv` is cyclic: a=0 → (y,z), 1 → (z,x), 2 → (x,y)), so no tangent frame is needed. The textures are mirrored
   on negative-facing sides, which doesn't show on grass and rock, and the normals stay correct.
5. **Height blend**: `ha = (1-cliff) + hGround·INFLUENCE`, `hb = cliff + hCliff·INFLUENCE`, blend over
   `HEIGHT_BLEND_DEPTH`. At `cliff = 0` it is guaranteed pure ground, and at 1 pure cliff, because `INFLUENCE` (0.5)
   is more than `DEPTH` below 1. In between, grass fills the rock's cracks.
6. **Macro**: the ground albedo once more at 128 m, single tap, used for its brightness only, plus the breakup noise as
   a brightness wobble. This kills the "carpet" look from altitude, which stochastic tiling can't reach.
7. **Fade to average**: over `NEAR_FADE_START..END · switchArc` the colour goes to `mix(groundAvg, cliffAvg, cliff)`
   and the normal to the vertex normal.

**Textures** (`terrainTextures.ts`) are fetched as raw pixels through `createImageBitmap` (no colour conversion, no
premultiply). They are packed by hand into `DataTexture`s with rows flipped, so v runs up, as GL normal maps expect.
Each albedo's **linear** average colour is computed on load. The set is chosen by one table at the top of the file.

## Far: a per-chunk bake

A GPU port of the terrain was rejected. It would be a second implementation that must match the CPU's bit for bit,
spec-driven GLSL generation, f32 noise coordinates at planet scale, and 3–4 full evaluations per pixel for normals.
Normal maps derived in a shader (from `dFdx` or a quantised height texture) are the classic failure.

Instead, `farBake.ts` (pure, runs in the chunk worker) samples the real terrain on a `(T + 2·CAVITY_RADIUS)²` grid in
f64, at `bakeLevel = level + log2((T-1)/32)`, so Nyquist matches the texel spacing rather than the mesh. It writes
RGBA8:
- **RGB = object-space normal**, by central differences on the 3D positions (the `buildChunk` method). It is exact by
  construction.
- **A = cavity**: `(h - mean of the (2r+1)² box) / texel size`, then `0.5 + 0.5·tanh(CAVITY_GAIN · c)`. The box mean
  comes from a summed-area table. Dividing by the texel size makes it read the same at every level.

**Texel layout.** Texel `i` sits at `i/(T-1)`, so the first and last texels lie *on* the chunk edges, and same-level
neighbours sample identical points. The texture's `repeat`/`offset` map uv onto texel centres, and three applies that
through `normalMapTransform`.

The far material sets the bake as `normalMap` (`ObjectSpaceNormalMap`), which gets three to plumb `vNormalMapUv`.
`FAR_COLOR_BODY` reads it once, before the normal stage. Albedo is the *same* `terrainCliffWeight` rule on the baked
normal, applied to the average colours, times the cavity darkening and ridge lightening. The cavity also scales
indirect diffuse (`FAR_AO_BODY`).

Pooling (`farMaterialPool.ts`) works like the geometry pool: `acquire` copies the bake into a pooled texture and sets
`needsUpdate`, and nothing is disposed. Every far material shares one program (cache key `terrain-far`); only its
`normalMap` differs.

## The handover

A level-`MIN-1` chunk has edge `switchArc`, splits at 2 of them, and merges at 2.5 (centre distance). So **near and
far chunks can border each other for fragments anywhere in about 1.3–3.2 switchArc.** Matching at one distance is not
enough; the two must agree across that whole band:

- near: fully faded to average colour + vertex normals by `NEAR_FADE_END` (1.2);
- far: cavity held at neutral, and normals read **no finer than mip 1** (64 texels: the vertex spacing of the child
  mesh) until `FAR_DETAIL_START` (3.2), fading in by `FAR_DETAIL_END`.

The mip floor is an explicit `textureLod(max(computedLod, 1 - detail))`, not a bias. Near the handover the texture is
magnified, and a bias does nothing there.

Consequence: no cavity is drawn within about 3 switchArc (≈ 18 km at L11). Raising `TERRAIN_SHADER_MIN_LOD` shrinks
that band, and raises the number of far chunks.

## Cost (measured)

Per chunk, steady state, one thread (node, same V8):

| preset | mesh | bake 128² | bake 64² |
|---|---|---|---|
| rocky | 2.6–4.1 ms | 40–85 ms | 11–21 ms |
| earthlike | 1.2–1.5 ms | 16–28 ms | 6–9 ms |
| flatlands | 1.0–1.6 ms | 23–27 ms | 5–7 ms |

**About 4× over the plan's estimate**, which used the old single-FBM terrain's per-sample cost. Also far more far
chunks than planned: the browser run held **400–630 far materials** near the ground (459 far leaves at 200 m). That is
roughly 55 MB of textures with mips. All of it is worker time and VRAM. The frame rate didn't move (140+ fps), but
refinement after a fast approach is slower, and an urgent collision tile can wait behind one bake (≤ 85 ms, against a
0.5 s lookahead).

Levers:
- `FAR_TEX_RES = 64`: 4× cheaper, blurrier from orbit.
- *Lower* `TERRAIN_SHADER_MIN_LOD`: fewer levels are baked, so fewer far chunks, but the handover band moves further
  out.
- Bake only leaves: interior nodes keep their texture today.

## Skirts (docs/02 Stage 2)

Skirt vertices must **copy the edge vertex's normal and uv**. Nothing else changes: this plan adds no vertex
attributes.

## Verification

Headless (bundled with rolldown, run in node), against the real `farBake`:

| check | result |
|---|---|
| baked normals unit length (8-bit) | 0.993–1.007 |
| outward (`n·dir`) | min 0.63 on rocky L10 (steep crater walls), 1.000 on flat presets |
| edge texels vs. same-level right neighbour | **0 byte difference**, every level and preset |
| perfect sphere (no layers): cavity | exactly 128 everywhere |
| cavity mean on real terrain | 127–129, so unbiased |
| `wrap()` across 10,000 simulated rebases | 0 non-period shift |

Browser (Chrome headless, real GPU, driven over CDP): no shader compile errors or warnings.

| view | what it showed |
|---|---|
| orbit (7.5 Mm) | 9 far chunks, cavity relief, no seams at face borders |
| 50 km | crater field from the bake |
| 3 km and 200 m | near textures |
| cube corner and pole | rock on slopes, grass on flats: the local-up test, at both singular places |

Thin dark lines are the known LOD cracks.

Not yet checked: flying through the handover band looking for pops, flying fast at low altitude looking for texture
swim, and A/B of `USE_STOCHASTIC_TILING` / `USE_BIPLANAR`.
