# threejs-planet-terrain

Procedural planet (R = 2,737 km, 1 unit = 1 m) with quadtree LOD terrain, flown as a third-person ship.
Vite + React 19 + TypeScript 6 + @react-three/fiber + three. Package manager: **yarn**.

- `yarn dev` · `yarn build` (`tsc -b && vite build`) · `yarn lint`
- Design docs, with rationale and verification notes: [docs/01-floating-origin-and-player.md](docs/01-floating-origin-and-player.md), [docs/02-quadsphere-lod-terrain.md](docs/02-quadsphere-lod-terrain.md), [docs/03-ship-controller.md](docs/03-ship-controller.md), [docs/04-layered-terrain.md](docs/04-layered-terrain.md). Read them before changing core systems.

## What's built
- **Floating origin** (`src/core`): render-space origin rebases onto the player so the camera stays near 0. Absolute positions are f64 `Vector3`s; anything placed in the world registers as a `WorldBody` (`useWorldBody`).
- **Player** (`src/player`): a ship with a chase camera. **`playerState.absPosition` is the ship**; the origin and LOD follow it, and the camera is derived from it. The mouse steers with a virtual reticle (offset → turn rate). W is impulse, Shift is cruise, S brakes/reverses, A/D roll, and holding Space charges the hyperdrive. There is an atmosphere with drag, altitude speed caps, roll auto-level, and a swept hyperdrive cutoff. `stepShip` (`shipFlight.ts`) is the pure flight model. **V** toggles the old 6DOF flycam (wheel = gear).
- **Quad-sphere LOD terrain** (`src/planet`): 6 spherified-cube faces → quadtree (`QuadTreeNode`, `PlanetTree`), chunks built in a worker pool (`chunkGeometry.ts` is the pure builder), shared index/UV buffers and a geometry pool.
- **Layered terrain** (`src/planet/terrain`): `LayeredTerrain` evaluates a `TerrainSpec`, which is plain data: ordered layers with their own basis (simplex/ridged/billow/Worley F1·F2·F2-F1/crater/constant), wavelength, amplitude in metres, warp, and masks on earlier layers. Every octave is Nyquist-weighted per LOD. There are 12 presets in `presets.ts` (rocky is the default; the full list is in docs/04). `terrainStore` holds the live spec plus a version; Apply bumps the version and the planet rebuilds.
- **Debug**: in-shader grid + chunk borders (toggle **G**), terrain panel (toggle **T**), `DebugHud` overlay (including build ms/chunk). `MarkerRig` is unmounted origin test scaffolding.

## Rules that aren't obvious
- **Toolchain**: `import type` for types; no `enum`/`namespace`/parameter properties (use `as const` objects); files exporting a component must export nothing else; hooks' callers must not assign to returned values (`react-hooks/immutability`).
- **Per-frame state lives in plain classes / module singletons**, never React state (StrictMode-safe, no re-renders). HUD polls them at ~10 Hz.
- **Frame order** via negative `useFrame` priorities: Player `-20` → Planet `-10`. Positive priorities disable auto-render.
- **Chunk vertices are relative to the chunk's own origin** (f64 subtraction before narrowing to f32). Don't break this — precision loss is invisible from orbit.
- **`logarithmicDepthBuffer` is on**: `polygonOffset` doesn't work, and custom shading must patch built-in materials via `onBeforeCompile` (no raw `ShaderMaterial`). Set `customProgramCacheKey` when patching.
- A parent node stays visible until all 4 children are Ready; interior nodes keep their geometry.
- Terrain must be deterministic and allocation-free. Workers rebuild it from `seed`+`radius`+`terrainVersion` via `layeredTerrain()`. The pool posts a version's spec to each worker before the first request that names it. Never mutate a registered spec: `setTerrainSpec` clones.
- Every noise basis must be continuous. The vendored simplex uses kernel r² = 0.5 because 0.6 steps at simplex boundaries. A new basis needs zero output when "no octaves" are used, or skipped layers shift the surface (docs/04).
- `TerrainSource` is a heightfield, so caves need a density interface (voxel research in docs/04, not built).
- All tuning constants live in `src/core/constants.ts`, except the terrain layer stack, which is data in `presets.ts`. `USE_WORKERS = false` runs generation synchronously for debugging.

## Deferred / known
- Cracks between LOD levels are expected (skirt fix scoped in docs/02 Stage 2).
- `MAX_LOD_LEVEL` is 20. Plan 2 visuals, the Plan 3 ship feel, and the docs/04 presets and terrain panel have not been verified in a browser yet.
- No terrain collision or gravity: the ship can fly through the ground.
- Not done: dynamic near/far, horizon culling, atmosphere/terrain shading, second planet.
