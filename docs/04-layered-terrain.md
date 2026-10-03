# 04 — Layered terrain

Replaces the single-FBM `NoiseTerrain` from docs/02 with a data-driven stack of noise layers that is edited live.

## Why

The old terrain was one FBM of simplex noise. One FBM has one roughness exponent,
`H = −log(GAIN)/log(LACUNARITY)` (≈ 0.81 at 2.3 / 0.51), so the surface has roughly the same slope, around 10–15 %,
at **every** scale and **everywhere**. It reads as "gently rolling" from orbit and from the ground. The knobs are
coupled: `MAX_ELEVATION` scales every octave at once, and `GAIN`/`LACUNARITY` tilt the whole spectrum, so making
the large scale dramatic also made the small scale noisy.

FBM already sums scales. What it can't do is give each scale band:

1. its **own amplitude in metres**, independent of the other bands;
2. its **own basis**: ridged crests, Worley cells, craters;
3. a **mask** from a coarser band, so mountains only grow where a continent-scale field says so.

(3) is what makes a landscape diverse, with plains next to ranges and maria next to highlands. Layers that are only
added together still look uniform.

## Shape of the data

`src/planet/terrain/terrainSpec.ts`. A `TerrainSpec` is `{ name, layers: TerrainLayer[] }`, and each layer has:

| field | meaning |
|---|---|
| `basis` | `simplex` · `ridged` · `billow` · `worleyF1` · `worleyF2` · `worleyF2F1` · `crater` · `constant` |
| `wavelength` | metres, octave 0 |
| `amplitude` | metres at normalised value 1. Negative inverts. 0 = mask-only layer |
| `octaves`, `lacunarity`, `gain` | the layer's own fractal sum. `octaves` is a cap; Nyquist decides per LOD |
| `masks` | `[{ layer, lo, hi }]`, multiplied. `smoothstep(lo, hi, value of an earlier layer)`; `lo > hi` inverts |
| `warp` | `{ wavelength, strength }` in metres: a 3-channel simplex offset of the sample point |
| `seedOffset` | decorrelates layers. Each layer's noise is seeded from planet seed + this |

It's plain data because it crosses `postMessage` and round-trips through JSON (panel → clipboard → `presets.ts`).

**Masks read earlier layers only.** One forward pass evaluates everything, and nothing can cycle. Forward references
are dropped at compile time, and the panel renumbers masks when layers move or are removed.

### Bases and their ranges

Every basis is scaled so that "no octaves" means 0. A layer that is skipped (masked out, or too fine for this LOD)
adds exactly what it would add with all octaves faded out, so skipping never shifts the surface.

| basis | per-octave value | look |
|---|---|---|
| simplex | ≈ [-1, 1] | rolling |
| ridged | `(1-|n|)²` × Musgrave feedback, [0, 1] | sharp crests, smooth valleys; detail piles onto crests |
| billow | `2|n|`, [0, ~1] | puffy hills, creased valleys |
| worleyF1 | distance to nearest point, [0, ~1] | round pits |
| worleyF2 | second-nearest, [0, ~1.3] | bulging cells |
| worleyF2F1 | `F2 − F1`, [0, ~1] | cell walls: plates, cracked ground |
| crater | sum of crater profiles, ≈ [-1, 0.35] | flat-floored bowls with raised rims; depth ∝ radius |
| constant | 1, ignores octaves and Nyquist | with a mask: flat-raised or sunken regions |

The cellular bases (`cellular3d.ts`) use an integer hash per cell, so unlike the simplex permutation table they have no
256-unit period.

**Craters on a sphere.** Feature points fill 3D, but samples lie on the sphere. Each point is treated as a ball sliced
by the surface: its crater radius shrinks as `√(1 − (h/0.5)²)` with its height `h` off the surface, and it vanishes at
half a cell. That band keeps the field continuous: any point whose crater reaches the sample is within 0.88 cells,
so it is always inside the 3×3×3 search. Projecting points onto the sphere would have been simpler but discontinuous,
because a point two cells up lands on the sample yet is never found.

## LOD rules (carried over from docs/02, generalised)

**Nyquist per octave.** Octave `i` of a layer has wavelength `λᵢ = wavelength / lacunarityⁱ`, and weight
`smoothstep(clamp(log_lac(λᵢ / 2·quadSize(level))))`. This is exactly the old tail-fade, applied to every octave of
every layer. Weights are precomputed per level, they fall monotonically with `i`, and the loop stops at the first
zero, so a 60 m regolith layer costs nothing at L8.

**Normalisation is level-independent.** Each layer multiplies its sum by `1 − gain` (the inverse of the infinite
series), never by the octaves in use. Adding an octave only adds detail; the shape doesn't breathe.

**Masks don't alias.** A layer that something masks on always gets octave 0 at full weight in its *mask* value; its
*relief* still follows Nyquist. Masks are meant to be coarse (hundreds of km), so this only matters if someone masks on
a fine layer.

**Skipping.** A layer is not evaluated at all when its mask product is 0 and nothing masks on it. In the earth-like
preset this skips mountains on 90 % of the planet.

## The simplex fix

The vendored Gustavson simplex used a kernel radius² of **0.6**, which is discontinuous: a corner's kernel hasn't reached
zero where a sample leaves its simplex. Walking a 1 km layer at 1 m and then 0.25 m spacing, the largest step shrank
only 1.35× instead of 4× (≈ 2.5 m steps). Ridged and billow fold `|n|`, which doubles it. The radius is now **0.5**
(the continuous one), with the output rescaled 32 → 76 to keep ≈ [-1, 1]. After the fix every basis halves its step
cleanly (ratio 4.00). This also changes the old terrain's look slightly, which doesn't matter since it was replaced.

## Getting the spec to the workers

- `terrainStore.ts` (main thread): the current spec plus a version number. `setTerrainSpec` clones, bumps the version,
  registers it, and notifies. React sees only the version, via `useTerrainVersion` (`useSyncExternalStore`).
- `LayeredTerrain.ts` keeps a per-thread registry (`registerTerrainSpec` / `terrainSpecFor`) and the memoised
  `layeredTerrain(seed, radius, version)` factory. It keeps two versions, so requests already posted can finish.
- `ChunkRequest.terrainVersion` names the spec. Before posting a request with a version a worker hasn't seen,
  `ChunkWorkerPool.sendTerrain` posts `{ kind: 'terrain', version, spec }`. A worker handles messages in order, so the
  spec is always registered first.
- `App` rebuilds the `PlanetConfig` in a `useMemo` keyed on the version, reusing the module-scope `MOON_CENTRE`
  (the floating origin holds it by identity). `Planet` already rebuilds its tree when the config changes, and the old
  tree's `dispose()` cancels its in-flight jobs.
- `PlanetConfig.maxElevation` (the sum of |amplitude| over enabled layers) replaces `MAX_ELEVATION` in the hyperdrive
  ray test.

## Terrain panel (T)

`src/ui/TerrainPanel.tsx`. Opening it releases pointer lock. Edits go to a local draft:

- **load preset** puts a preset into the draft;
- per layer: enable, name, basis, amp (m), λ (km), octaves, lacunarity, gain, seed; warp toggle with λ/strength (km);
  masks with source layer, lo, hi;
- ↑ ↓ ✕ reorder or remove layers, and masks are renumbered to keep their targets;
- **apply** publishes a new version and rebuilds the planet. **revert** discards the draft;
- **copy JSON** / **paste JSON** move a mix into `presets.ts` and back.

Key events aimed at form fields are ignored by flight and debug bindings (`core/keyboard.ts`). The HUD shows
`build … ms/chunk` (moving average), which is the number to watch when a mix gets expensive.

## Presets (`presets.ts`)

**rocky** (default, `DEFAULT_TERRAIN_PRESET`):

| layer | basis | λ | amp | masked by |
|---|---|---|---|---|
| regions | simplex | 1800 km | 0 (mask only) | — |
| maria | constant | — | −2500 m | regions ↑ (~24 % of the surface) |
| uplands | simplex | 600 km | 3000 m | regions ↓ |
| highlands | ridged, warped | 250 km | 4500 m | regions ↓ (~58 %) |
| big craters | crater ×2 | 120 km | 4000 m | — |
| craters | crater ×3 | 6 km | 700 m | — |
| small craters | crater ×4 | 300 m | 45 m | — |
| rough | simplex ×6 | 2 km | 120 m | — |
| regolith | simplex ×7 | 60 m | 3 m | — |

**earthlike**: continents (simplex 2500 km, ±3 km), a belt mask (900 km), ridged warped mountains (160 km, 7 km;
masked by continent *and* belt, ~10 % of the planet), billow hills on land (25 km, 500 m), rough (3 km, 120 m), and
detail (150 m, 6 m). Roughly 37 % land.

The other ten, and the trick each one demonstrates:

| preset | idea | trick |
|---|---|---|
| alpine | 12 km jagged ranges in bands | ridged with gain 0.55, so it stays rough all the way down |
| desert | dune seas in basins, rock outcrops on high ground | warped ridged = sinuous dune crests (3 km) and ripples (300 m) |
| canyonlands | mesas and canyons | 4 `constant` tiers sharply masked (lo/hi 0.015 apart) at rising thresholds of one field = terraces with cliffs; negative ridged = canyons |
| badlands | eroded rills, flat playas that crack up close | worleyF2F1 at 25 m in the playas, which only appears from about L13 |
| volcanic | shield volcanoes, cinder-cone fields, lava plains | `-worleyF1` puts a cone on every Worley point; a `constant` under the same mask lifts the peaks above the plain |
| icy | Europa: flat plates, grooves, ridges, chaos patches | worleyF2F1 (grooves where cells meet) + warped ridged lines |
| shattered | raised crust plates split by deep V rifts | worleyF2F1 at 600 km, 10 km amplitude |
| archipelago | islands on a deep floor (no water yet) | sharp `constant` shelf + ridged peaks on the island cores |
| foam | alien nested bowls | positive worleyF1 at three octaves |
| flatlands | calm rolling plains | a baseline to add one layer to |

Measured at L12 / L19 (heights in km, cost in ms per chunk):

| preset | height range | cost | mask coverage |
|---|---|---|---|
| rocky | −4.6 … 5.4 | 10.7 | maria 22 %, highlands 60 % |
| earthlike | −2.0 … 7.5 | 3.0 | mountains 10 %, hills 44 % |
| alpine | −1.6 … 11.5 | 3.2 | peaks 47 % |
| desert | −0.9 … 1.4 | 2.9 | dunes 49 %, outcrops 43 % |
| canyonlands | −1.6 … 2.0 | 3.1 | tiers 74 / 57 / 40 / 23 % |
| badlands | −1.7 … 1.3 | 2.5 | playa 29 %, hills 48 % |
| volcanic | −2.0 … 2.9 | 3.1 | shields 23 %, plains 42 %, cinder 12 % |
| icy | −0.2 … 0.7 | 4.6 | chaos 17 % |
| shattered | −0.8 … 5.2 | 4.6 | — |
| archipelago | −1.0 … 5.3 | 1.9 | islands 23 % |
| foam | 1.2 … 7.0 | 3.4 | — |
| flatlands | −0.5 … 0.4 | 1.3 | — |

What the layer model *can't* do: overhangs, arches and caves (it's a heightfield), drainage networks (rivers need an
erosion simulation, not noise), and anything colour-based. Every preset renders in the same grey until terrain
shading lands, and shading by height and slope would separate these presets more than any further noise tuning.

## Verification (numeric, from a script run under Node)

- Determinism: two independently built instances agree bit-for-bit on 4,000 directions, for both presets.
- Range at L12: rocky −5.0 … +5.2 km; earthlike −2.0 … +7.6 km.
- Continuity: walking 200 km at L19 at 1 m and then 0.25 m spacing, the largest step shrinks 4.00× for simplex,
  ridged, crater and worleyF2F1.
- No breathing (rocky): RMS change per level step is 568 m at L0→1 (quad 183 km), 13 m at L9→10 (quad 358 m), and
  0.02 m at L18→19 (quad 0.7 m). It is always fine detail, far below a quad.
- Cost per chunk of terrain samples (35² = 1225): rocky 5 / 9 / 10 ms at L8 / L14 / L19 (it is crater-heavy);
  earthlike 1.7 / 2.4 / 2.8 ms. That's spread over the worker pool.
- **Not yet verified in a browser:** how the presets look, the panel, and the apply → rebuild cycle.

## Voxel terrain (caves): researched, not built

Decision deferred until exploration gameplay shows whether caves matter. Summary of the research:

- **Representation**: a density field `d(p) = (R + h(dir)) − |p| − caves(p)`. This layer stack becomes `h`, so none of
  this work is wasted. Caves come from 3D noise carving: worm tubes via `|n₁| + |n₂| < t`, or Worley `F2−F1` tunnels.
- **Mesher**: Marching Cubes (simple, public tables), Surface Nets (simplest, slightly rounded), or Dual Contouring
  (sharp features, needs gradients; most complex).
- **LOD seams** are the hard part. The standard answer is Transvoxel (Lengyel 2010): transition cells on faces bordering
  a coarser chunk, 512 cases in 73 classes. Surface Nets and DC need their own stitching; skirts are the cheap hack.
- **Cheapest fit with this code**: a hybrid. Keep the heightfield everywhere, and only near the player (e.g. L ≥ 15)
  turn a quadtree leaf into a stack of `(u, v, r)` bricks, meshed in brick space and pushed through `faceToSphere`. The
  quadtree, worker pool, floating origin and chunk-relative vertices all carry over.
- **What it costs**: variable-size meshes (the shared index/UV buffers and geometry pool don't apply; Uint16 indices
  may overflow); ~36k density samples per 32³ brick against ~1.2k heights per chunk now (30–60×); a seam between
  heightfield chunks and bricks; triplanar texturing (no UVs); collision via density queries or trimesh colliders.
- **Libraries**: none mature for three.js planets. `isosurface` (npm) has MC and Surface Nets; Transvoxel exists in Rust
  and C# with tables to transcribe. Expect to write the mesher, seams and brick LOD yourself.
- **Cheaper intermediate steps**: overhangs and cliffs via tangential (vector) displacement on the existing grid; fake
  cave entrances as placed tunnel meshes with the terrain hidden locally.
- **Estimate**: on the order of the whole quadtree/LOD work again. Suggested order: layered terrain (this doc) →
  terrain collision → decide.

References: [Lengyel, Transvoxel](https://transvoxel.org/Lengyel-VoxelTerrain.pdf) ·
[Gildea, chunked Dual Contouring seams](http://ngildea.blogspot.com/2014/09/dual-contouring-chunked-terrain.html) ·
[0fps, isosurfaces](https://0fps.net/2012/08/20/simplifying-isosurfaces-part-2/) ·
[Voxel Planets](https://buckslice.github.io/planet-tech) ·
[Quilez, noise derivatives](https://iquilezles.org/articles/morenoise/)
