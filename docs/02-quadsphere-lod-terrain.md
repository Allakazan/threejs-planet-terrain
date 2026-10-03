# Plan 2 — Quad-Sphere Quadtree LOD Terrain

**Status: implemented 2026-10-01; maths and quadtree verified automatically, appearance not yet eyeballed.**
See [Verification](#verification--plan-2) for exactly what was proven and what still needs a browser.
Corrections this plan's own numbers needed are marked **⚠ corrected** below.

Prerequisite: [01-floating-origin-and-player.md](01-floating-origin-and-player.md). The toolchain constraints and
the two precision rules (Rule A / Rule B) stated there apply throughout and are not repeated here.

## Cube → sphere mapping

Six faces, each with a `(right, up, forward)` basis. Face-local `(u,v) ∈ [-1,1]²` → cube point
`forward + u·right + v·up` → sphere.

**All six bases are built right-handed, so `right × up === forward` (outward).** Two things silently depend on it:
the shared index buffer's winding, and `chunkGeometry` taking `∂u × ∂v` as the outward normal with no sign
correction. Verified numerically for all six faces.

Use the **spherified-cube** mapping rather than `normalize()`. Plain normalisation bunches triangles badly at face
centres; this costs a few multiplies and gives far more uniform quads:

```
x' = x · sqrt(1 - y²/2 - z²/2 + y²z²/3)
y' = y · sqrt(1 - z²/2 - x²/2 + z²x²/3)
z' = z · sqrt(1 - x²/2 - y²/2 + x²y²/3)
```

Then `position_local = dir · (RADIUS + terrain.getAltitude(dir, level)) - chunkOrigin`.

The mapping is **exact on the cube surface** — `|spherify(p)| = 1` to within one f64 ULP — and face seams are
watertight for free, because adjacent faces evaluate the *same cube point*: the +X face at `u=-1` and the +Z face
at `u=+1` both produce `(1, v, 1)`, and `spherify` is a pure function of it. All 12 cube edges were checked and
agree **bit-for-bit**, not just to tolerance.

One thing to know before the skirt work: four of the twelve edges meet with a **reversed parameter** (face A's `+u`
runs along face B's `-u`). Adjacent faces agree on the shared *point*, never on the direction their axes run.
Nothing in Plan 2 does neighbour lookups, so nothing depends on it yet — but anything that stitches across a cube
edge later must handle it.

## LOD level maths (derived, not guessed)

Root face edge arc = `(π/2) · R` = **2,728,473 m** (⚠ corrected — this plan originally said 2,727,851, a 0.02%
arithmetic slip that propagated through the whole table). With `CHUNK_RESOLUTION = 32` quads per edge:

```
quadSize(L) = 2,728,473 / (32 · 2^L) = 85,265 / 2^L
```

| L | quad size | nodeArc |
|---|---|---|
| 0 | 85.3 km | 2,728 km |
| 4 | 5.33 km | 170 km |
| 8 | 333 m | 10.7 km |
| 12 | 20.8 m | 666 m |
| 16 | **1.30 m** | 41.6 m |
| 17 | 0.65 m | 20.8 m |

So **`MAX_LOD_LEVEL = 16` reaches metre-scale triangles.** Start at **12** while building — it's plenty to prove
the system and keeps chunk counts and generation load low — then raise it.

Worth internalising, because it caused a wrong conclusion while verifying: a node's **local vertex extent is its own
half-diagonal (~0.71 · nodeArc), not its quad size.** A level-12 chunk's vertices span ±520 m, not ±20 m. The quad
size is the spacing *between* vertices. Both numbers matter, for different things — quad size for detail, extent for
f32 precision.

## Node lifecycle

No `enum` (toolchain forbids it): `const NodeState = { Idle:'idle', Pending:'pending', Ready:'ready', Split:'split' } as const`.

```
Idle ──request──▶ Pending ──geometry arrives──▶ Ready ──wants split──▶ Split
                     │                            ▲                      │
                     └──cancelled─────────────────┘◀────wants merge──────┘
```

Rules that matter:

- **A parent stays visible until all four children are `Ready`.** Only then does the parent's mesh hide and the
  children show. This is the entire defence against holes.
- **Interior nodes keep their geometry.** A node that splits retains its own (hidden) mesh, so merging is instant
  and never pops. Memory overhead of a full quadtree's interior is ~⅓ of the leaves — a few dozen chunks, which is
  nothing. Do not be clever here.
- **Merging** disposes the children recursively and cancels any of their pending requests.
- **Split test**, evaluated per node per frame, top-down, stopping at leaves:
  ```
  nodeArc = 2,728,473 / 2^level                      // world size of this node's edge
  centreAbs = planetCentreAbs + mapToSphere(nodeCentre) · (R + altitude(centre, level))
  d = playerAbs.distanceTo(centreAbs)
  split if  d < nodeArc · SPLIT_FACTOR        and level < MAX_LOD_LEVEL
  merge if  d > nodeArc · SPLIT_FACTOR · MERGE_HYSTERESIS
  ```
  The hysteresis band is what stops split/merge thrash when hovering at a boundary. Centre-distance is an
  approximation (closest-point-on-patch would be tighter); it's standard and fine, and `SPLIT_FACTOR` absorbs the
  slack. `centreAbs` is static, so it is computed once in the node's constructor.

  Note that `d` is measured **to the terrain**, not to the reference sphere — patch centres sit at
  `R + altitude`. Since relief runs to ±8 km, "100 m above the sphere" can be 2.6 km above the actual ground and
  will not reach `MAX_LOD_LEVEL`. That is correct behaviour, and it is easy to misread as the LOD failing to refine.

## Shared buffers — one index and one UV for the whole planet

Every chunk has identical topology, so build **one** `Uint16` index attribute and **one** UV attribute at startup
and assign them to every chunk geometry. 33² = 1089 verts < 65536, so Uint16 is safe.

Two traps:

- `geometry.dispose()` tells three's `WebGLAttributes` to delete the GL buffers of *all* its attributes — including
  the shared index. three would re-upload it lazily rather than corrupt anything, but it's a per-dispose hiccup.
- Churning `BufferGeometry` objects causes GC pressure during fast flight.

Both are solved by a **geometry pool**: a free-list of `BufferGeometry` objects whose position/normal arrays are
always the same byte length. Recycling = `attr.array.set(newData); attr.needsUpdate = true`. Nothing is ever
disposed during normal operation.

## Worker protocol

Generation is a **pure function** so the same code runs in a worker or synchronously behind `USE_WORKERS = false`
(invaluable for debugging — you get breakpoints and stack traces):

```ts
// src/planet/chunkGeometry.ts
export function buildChunk(req: ChunkRequest): ChunkResult
```

```ts
type ChunkRequest = { id, face, cu, cv, half, level, res, radius, seed }
type ChunkResult  = { id, positions: Float32Array, normals: Float32Array,
                      chunkOrigin: [number, number, number],   // relative to planet centre, f64
                      boundingRadius }                          // largest |position| in the chunk
```

- Response transfers `[positions.buffer, normals.buffer]`. The index and UV buffers are **never** sent.
  Typed as `Float32Array<ArrayBuffer>`, since only a plain `ArrayBuffer` is `Transferable`.
- `chunkOrigin` is the chunk's sphere-projected centre **lifted to its own altitude** —
  `dir · (R + altitude(centre, level))`, not `dir · R`. Using the bare radius would leave every chunk's local
  extent padded by the full ±`MAX_ELEVATION`; lifting it keeps the extent down to the patch's own size, which is
  worth about four bits of f32 exactly where precision matters. It is computed through the same
  `faceToSphere`/`getAltitude` calls the quadtree uses for `centreAbs`, so the two cannot drift apart.
- **`boundingRadius` replaces the planned `minAlt`/`maxAlt`.** Positions are centred on `chunkOrigin`, so the
  bounding sphere is `(0,0,0)` plus the largest `|position|` — exact, and free during the emit loop, where
  `computeBoundingSphere()` would rescan all 1089 verts on every upload.
- **f64 scratch grid.** The sample grid is `Float64Array`, so `gridPoint - chunkOrigin` happens at full precision
  before anything narrows to f32. Both operands are ~1.7e6 and their difference at L12 is ~20 m; doing that
  subtraction in f32 would leave 21 cm of quantisation on a 20 m quad — precisely the stair-stepping Rule B exists
  to prevent. Measured: L12 vertex precision is **62 µm**.
- **Normals**: the worker generates a `(res+3)²` grid — a one-vertex border ring beyond the chunk — computes
  normals by central differences, then emits only the interior `(res+1)²`. Cost is ~+13% vertices and it removes
  normal seams at chunk borders entirely. The alternative, `computeVertexNormals` on the bare chunk, leaves a
  visible lighting crease on every edge.

  At the edge of a *root* chunk the ring falls off the cube face, which is fine: `spherify` stays analytic there,
  and the symmetric stencil cancels the sphere's own curvature, so what the normal follows is the terrain gradient.
  The radicands were checked at the worst case (a root corner, ring step 1/16) and bottom out at 0.296 — nowhere
  near negative. There is still a `max(0, …)` guarding the sqrt, which only matters if `CHUNK_RESOLUTION` ever
  drops far below 32.
- **Pool**: `WORKER_COUNT = clamp(hardwareConcurrency - 1, 1, 6)`, created once at module scope (StrictMode-safe).
- **Queue**: a priority queue keyed on distance — nearest first. Priorities are recomputed as the player moves, so
  a queue scan each frame beats a fixed heap.
- **Cancellation**: `requestId → node` map. Cancelling before dispatch removes from the queue; cancelling in flight
  marks the id dead and the arriving result is dropped into the geometry pool.
- **Upload budget**: at most `MAX_UPLOADS_PER_FRAME = 2` geometries are attached per frame, so a burst of arrivals
  can't spike a frame.

## Material — shaded surface with a grid on top

The requirement is editor-style: shaded surface *with* black wireframe over it. The obvious second mesh with
`wireframe: true` + `polygonOffset` **will not work here**, because `logarithmicDepthBuffer` writes `gl_FragDepth`
and that makes polygon offset a no-op → guaranteed z-fighting.

Instead, draw the grid **in the surface shader itself**, from the shared UV attribute. Patch
`MeshStandardMaterial` with `onBeforeCompile`:

- Get the chunk UV as a varying by setting `material.defines = { USE_UV: '' }`. three only declares its generic
  `vUv` when some map is bound; defining `USE_UV` by hand makes three's own `uv_pars_*`/`uv_vertex` chunks plumb it
  through, instead of hand-rolling a varying that would then have to be kept in sync.
- **⚠ corrected formula.** This plan originally specified `d = min(abs(fract(uv·RES) - 0.5))`. That is zero at cell
  *centres* and 0.5 at the lines, so darkening "where `d` is small" would have painted a dot in the middle of every
  cell. The distance to the nearest grid line is `abs(fract(g - 0.5) - 0.5)` with `g = uv·RES` — note the extra
  half-cell shift.
- Line width is measured **in pixels**: divide the uv-space distance by `fwidth(vUv)`. A fixed uv-space width
  shimmers violently at distance.
- A second, thicker/darker line at `uv ≈ 0` or `1` marks the **chunk boundary** — which is the thing you actually
  want to see when debugging LOD.
- **Fade both out as they get small.** Below ~3 px per cell every pixel is inside a line, and the surface turns into
  flat grey mush with moiré on top. Cell lines fade over 1.5→4 px per cell; the chunk border fades much later
  (4→12 px per chunk), since it stays useful far longer.
- `material.customProgramCacheKey = () => 'chunk-grid'` is **required**, not a nicety: without it three's program
  cache will happily hand this material the unpatched standard program compiled for some other
  `MeshStandardMaterial` in the scene, or hand that material this one.
- Toggle via a `uGrid` uniform (0/1) wired to **G**.

One material instance is shared by every chunk, so the whole planet is one program and the toggle is a single
uniform write. This is one draw call per chunk, zero extra geometry, immune to depth fighting, compatible with
logDepth (three's `logdepthbuf` chunks are injected into the standard shader, which `onBeforeCompile` preserves),
and it shows the quad grid rather than triangle diagonals — strictly more readable for LOD verification.

## Terrain source

> **Superseded by [docs/04](04-layered-terrain.md).** `NoiseTerrain` and the `MAX_ELEVATION`/`LACUNARITY`/`GAIN`
> constants are gone; the terrain is now a data-driven layer stack. The Nyquist and normalisation rules below still
> hold, applied per octave of every layer. The "voxel source drops in" claim was wrong: the interface is a
> heightfield and cannot express caves.

```ts
// src/planet/terrain/TerrainSource.ts
export interface TerrainSource {
  getAltitude(dir: Vector3, level: number): number   // metres of relief, signed
}
```

One interface, one method — so a 3D-noise/voxel source drops in later with no caller changes.

Implementations must be **deterministic and allocation-free**: face seams are watertight only because two chunks
sampling the same `dir` get bit-identical answers, and this is called once per vertex per chunk.

**One caveat on "no caller changes".** The main thread uses `config.terrain` for split-test patch centres, but the
worker cannot receive a `TerrainSource` over `postMessage` — it rebuilds one from `seed` + `radius` through a
memoised `noiseTerrain(seed, radius)` factory. Both sides go through that factory, so both agree. Swapping in a
different source therefore means wiring it into the factory too, not just into the config.

**Noise**: vendor a ~150-line public-domain 3D simplex into `src/planet/terrain/simplex3d.ts`. No new dependency,
works inside a worker with no bundler fuss, seeded by a permutation table. It will be replaced anyway; adding a
package for it isn't worth the plumbing.

**Octave count from LOD — derived from Nyquist, not hand-tuned.** Octave `i` has wavelength
`BASE_WAVELENGTH / LACUNARITY^i`. An octave finer than two quads is pure aliasing, so include octaves while
`wavelength > 2 · quadSize(level)`:

```
octaves(level) = log2(BASE_WAVELENGTH / (2 · quadSize(level))) / log2(LACUNARITY)
```

Low LODs therefore get 2–3 huge octaves (a smooth planetary silhouette), and each extra level adds detail exactly
when the mesh can represent it — the count rises linearly, `2.93` at L0 to `14.93` at L12. **Fade the last octave in
with a fractional weight** (`smoothstep` on the fractional part) so detail appears gradually instead of popping at
the level boundary — this is the mechanism that delivers "less and less influence as LOD decreases".

**The amplitude normaliser must be level-independent — this is a trap the plan originally walked straight into.**
Octave `i` has amplitude `GAIN^i`, and the sum must be divided by the **infinite** series `1/(1-GAIN)`, never by the
sum of the octaves actually in use. Normalising by the used sum rescales the *low* frequencies every time the octave
count changes, so the entire planetary silhouette would breathe in and out as you descended — a far worse artifact
than the popping the fade was added to prevent. Dividing by the fixed series means an extra octave can only ever add
fine detail on top of a shape that never moves.

Verified: sampling one fixed direction across L0→L12, the altitude settles to within a metre by L5 and the largest
level-to-level step is 188 m — which is the amplitude of the octave fading in at that level, as intended. At the
distance an L1→L2 split happens (2.7 Mm) 188 m subtends 0.004°, i.e. subpixel.

## Files — Plan 2

| file | responsibility |
|---|---|
| `src/planet/PlanetConfig.ts` | `{ radius, seed, centreAbs, terrain }` type + `planetConfig()` builder |
| `src/planet/quadsphere.ts` | face bases, `faceToSphere(face,u,v)`, spherified-cube formula, `faceArc`/`quadSize` |
| `src/planet/chunkGeometry.ts` | **pure** `buildChunk(req)` — the only place terrain maths runs |
| `src/planet/chunk.worker.ts` | worker entry; imports `chunkGeometry` |
| `src/planet/ChunkWorkerPool.ts` | pool, priority queue, cancellation, sync fallback, upload budget |
| `src/planet/sharedBuffers.ts` | the one index attribute, the one UV attribute, geometry pool |
| `src/planet/QuadTreeNode.ts` | node, state machine, split/merge tests, child management |
| `src/planet/PlanetTree.ts` | *(added)* the 6 face roots, the per-frame walk, leaf/depth counters |
| `src/planet/chunkMaterial.ts` | `MeshStandardMaterial` + `onBeforeCompile` grid patch, `setGridEnabled` |
| `src/planet/planetStats.ts` | *(added)* mutable snapshot the frame loop writes and the HUD reads |
| `src/planet/terrain/TerrainSource.ts` | the one-method interface |
| `src/planet/terrain/NoiseTerrain.ts` | *(added)* FBM, Nyquist octave count, memoised factory |
| `src/planet/terrain/simplex3d.ts` | vendored public-domain 3D simplex, seeded |
| `src/planet/Planet.tsx` | root group as a `WorldBody`; the `-10` frame loop; owns the tree's lifecycle |
| `src/debug/useDebugKeys.ts` | *(added)* edge-triggered debug binds; currently just **G** |
| `src/core/constants.ts` | **extended** with the planet/terrain/debug constants |
| `src/ui/DebugHud.tsx` | **extended**: altitude, leaves, nodes, deepest level, queue, geometry pool, grid |
| `src/App.tsx` | **modified**: marker rig out, one `<Planet>` in, airless-body lighting |

Three files beyond the original list. `PlanetTree` exists because the roots and the frame walk are a separate
responsibility from a single node, and keeping them out of React made the whole LOD system drivable from a plain
script — which is how it got verified. `planetStats` and `useDebugKeys` are there so `DebugHud` and `App` stay free
of planet internals.

`MarkerRig.tsx` is kept but no longer mounted. Plan 1 said to delete it once Plan 2 landed; it is cheap to keep and
it is still the fastest way to re-verify the floating origin independently of the planet.

## Constants — starting values

The origin/player block already lives in `src/core/constants.ts` (Plan 1). Plan 2 adds:

```ts
// --- planet ---
PLANET_RADIUS         = 1_737_000
CHUNK_RESOLUTION      = 32        // quads per edge → 33² verts
MAX_LOD_LEVEL         = 12        // → 16 for ~1.3 m quads
SPLIT_FACTOR          = 2.0
MERGE_HYSTERESIS      = 1.25
MAX_UPLOADS_PER_FRAME = 2
WORKER_COUNT          = clamp(hardwareConcurrency - 1, 1, 6)
USE_WORKERS           = true      // false = synchronous, debuggable

// --- terrain ---
MAX_ELEVATION            = 12_000   // ~0.7% of radius; moon-like relief
BASE_WAVELENGTH_FRACTION = 0.75     // of the radius, so a second planet of another size works
LACUNARITY               = 2.0
GAIN                     = 0.5
MAX_OCTAVES              = 20
SEED                     = 1337

// --- debug ---
SHOW_GRID         = true
GRID_LINE_WIDTH   = 1.1   // px
GRID_BORDER_WIDTH = 2.4   // px
```

`BASE_WAVELENGTH` became `BASE_WAVELENGTH_FRACTION` so the terrain scales with whatever radius it is handed — the
last implementation step is a second planet, and an absolute wavelength would have had to be rescaled by hand.

Plan 1's player block also moved: spawn is now `[0, 0, PLANET_RADIUS · 3]` at gear 8, looking down -Z at the planet
(39° across, inside a 50° fov with room to spare, ~20 s to the surface). The planet block sits **above** the player
block in `constants.ts` because module init is top-down and the spawn is expressed in planet radii.

With `GAIN = 0.5` and `LACUNARITY = 2.0` every octave contributes the same slope, so RMS slope grows as `√octaves`:
about 0.018 at L12. That is deliberately gentle — rolling, not spiky. `MAX_ELEVATION` is the dial to turn if the
result reads as too smooth. Measured relief over 20,000 samples: −8,679 m to +8,120 m.

## Stage 2 — deferred, scoped now

**Crack fix via skirts.** Adjacent chunks at different LOD leave visible gaps; this is accepted for now.
The fix, when picked up:

1. Generate a `(res+1)² + 4·(res+1)` vertex layout: the normal grid plus one extra ring duplicating the edge
   vertices, pushed **inward** along `-dir` by `SKIRT_DEPTH · quadSize(level)` (≈1–2 quads deep).
2. Extend the **shared** index buffer with the skirt quads — topology is still identical for every chunk, so the
   one-shared-index-buffer design is untouched. Only the constant vertex count changes.
3. The skirt is invisible from outside (it hangs down behind the surface) and plugs any gap up to its depth.
4. Visible in the debug grid as a thin apron at chunk borders — acceptable.

Scope: `chunkGeometry.ts`, `sharedBuffers.ts`, one constant. No change to the quadtree or worker protocol.
Skirts need no neighbour lookups, so the reversed-parameter cube edges noted above stay irrelevant — but they will
matter the moment anything tries to *stitch* across a cube edge instead.

**Also deferred:** dynamic near/far instead of `logarithmicDepthBuffer` (see Plan 1); horizon/backface culling of
far-side chunks; terrain and atmosphere shading; a zero-alloc worker round-trip that ships arrays *to* the worker
and back.

## Verification — Plan 2

`tsc -b`, `eslint .` and `vite build` are all clean, and the worker bundles into its own chunk.

### Proven automatically

The maths and the quadtree were driven headlessly (vite SSR build → node), against the real modules rather than
re-derived formulas. Both harnesses are throwaway and were not kept in the repo.

**Geometry and terrain**

| check | result |
|---|---|
| `right × up === forward`, all six faces | exact |
| `\|spherify(p)\| = 1` on the cube surface | worst error 2.2e-16 |
| all 12 cube edges agree between adjacent faces | **bit-identical** |
| `∂u × ∂v` points outward, 6 faces × 9 patch centres | min cos = 1.000000 |
| ring-extended radicands stay positive (worst case) | min 0.296 |
| normals unit length / outward on a real chunk | 3.8e-8 / min cos 0.999 |
| `boundingRadius` matches the furthest vertex | exact |
| shared edge via the real generator, absolute positions | 9.6 cm — one f32 ULP at a 1.6 Mm extent, i.e. storage-limited, not maths-limited |
| L12 local extent / vertex precision | 521 m / **62 µm** |
| relief envelope over 20k samples | −8,679 m … +8,120 m, inside ±`MAX_ELEVATION` |
| coarse shape stable as octaves are added | settles by L5, max step 188 m |
| generation cost | **0.43 ms** (L0) → **1.17 ms** (L12) per chunk |

**Quadtree state machine**, with a fake pool delivering results *in reverse order* and, in places, one per frame:

| check | result |
|---|---|
| six roots → closed sphere, no holes or overlaps | pass |
| descent 30R → 100 m AGL, audited after every frame **and** every arrival | 629 audits, 0 holes, 0 overlaps |
| reaches `MAX_LOD_LEVEL` under the player | L12, 540 leaves / 718 nodes |
| hovering inside the hysteresis band | node count **frozen** over 200 frames |
| …and moving 3× the band | re-LODs by 32 nodes, as it should — the test has teeth |
| fast lateral flight, 1 delivery/frame, peak backlog 69 | 1,202 audits, 0 holes, 0 overlaps |
| merges cancelling queued work | 98 cancellations, **none ever delivered a result** |
| full retreat | collapses to exactly 6 leaves / 6 nodes |
| geometry accounting after `dispose` | 750/750 returned to the pool, scene emptied |

The coverage audit is the important one: it walks the tree and asserts every direction is covered by **exactly one**
visible mesh — a miss is a hole, a double is two LODs z-fighting. Over 3,200 audits across every scenario, zero of
either. That is the parent-stays-visible rule holding under out-of-order, starved delivery.

### Still needs a browser

Nothing below can be checked headlessly — it is all appearance:

1. **Whole sphere from orbit.** A closed sphere, no visible seam at face boundaries, smooth lighting across them.
2. **Approach at gear 8 → 2.** On-screen cell density should stay roughly constant as you descend. HUD leaf count
   rises and plateaus.
3. **Grid legibility.** Cell lines crisp, not shimmering; chunk borders readable; both fading cleanly at distance.
4. **Grid off (G).** Does the surface alone read as a plausible moon?
5. **Visible gaps at LOD boundaries.** **Expected** — that is the deferred skirt work, not a regression.

Failure modes: holes → parent/child visibility rule. Stalls or never-refining distance → queue priority or
`MAX_UPLOADS_PER_FRAME` starvation. Vertex stair-stepping up close → per-chunk local origins not actually applied.
Shimmering grid lines → missing `fwidth` antialiasing. A dot in the middle of each cell → the corrected grid
formula above got un-corrected. LOD refusing to reach `MAX_LOD_LEVEL` → check altitude **above ground**, not above
the reference sphere.

## Implementation order

`quadsphere` → `chunkGeometry` + vendored simplex (synchronous) → single-chunk test → `sharedBuffers` +
`chunkMaterial` → six face roots → `QuadTreeNode` + split/merge (still synchronous) → `ChunkWorkerPool` +
cancellation + upload budget → raise `MAX_LOD_LEVEL` → second planet to re-verify the floating origin under load.

All built. The last two steps are judgement calls to make after looking at it: `MAX_LOD_LEVEL` is still 12, and
only one planet is mounted.

## Risks

- **Precision regression is silent.** If per-chunk local origins are skipped it looks fine from orbit and only
  breaks on close approach. *Measured*: 62 µm at L12, so the mechanism is in place — but it stays silent if later
  edited away, so keep the extent/ULP figures in mind.
- **`logarithmicDepthBuffer` constrains shaders.** Every material must go through `onBeforeCompile` on a built-in
  material, not a raw `ShaderMaterial`, or the depth chunks get dropped.
- **StrictMode double-mounting** would create two worker pools if the pool is constructed inside an effect. It is
  module-scope for this reason, with an `import.meta.hot.dispose` so Vite HMR does not strand workers either.
- ~~**CPU-side FBM at high octave counts** is the likely first bottleneck~~ — **retired.** Measured at 0.43 ms (L0)
  to 1.17 ms (L12) per chunk, single-threaded. With 5 workers that is thousands of chunks per second against a
  steady state of a few hundred. `MAX_OCTAVES = 20` is never reached at L12 (14.93). If anything bites first it will
  be the `MAX_UPLOADS_PER_FRAME = 2` budget, which is the *deliberate* throttle — the backlog is visible on the HUD.
- **Two planets multiply the upload budget**, since each tree pumps the shared pool once per frame. Fine at two;
  needs a single frame owner if it grows.
- **The first `MeshStandardMaterial` compile is a stall.** One-off, and unavoidable without a warm-up pass.
