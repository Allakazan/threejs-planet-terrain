# Plan 1 — Floating Origin + Player

**Status: implemented and verified 2026-10-01.** All four verification steps below pass — including a sustained
gear-11 run past 10⁸ with the markers rock-steady through a rebase on nearly every frame.

*Since then, Plan 2 changed two things here:* the spawn moved to `[0, 0, PLANET_RADIUS · 3]` at gear 8 so the
session starts looking at the planet, and `MarkerRig` is no longer mounted in `App.tsx`. The file is kept — it is
still the quickest way to re-verify the origin without the planet in the way. To use it, mount `<MarkerRig />` and
set `START_ABS_POSITION` back to `[0, 0, 0]` with `START_YAW = -Math.PI / 2`.

## Context

`planetsndstuff` is building a procedural planet with planetary-scale LOD terrain. Two foundations must exist
before terrain is meaningful:

1. **A floating-origin coordinate system + a Player** that can cross interplanetary distances at hyperdrive speed
   without float32 precision collapsing. ← *this document*
2. **A quad-sphere with a self-subdividing quadtree**, generated off-thread, with a replaceable terrain source.
   See [02-quadsphere-lod-terrain.md](02-quadsphere-lod-terrain.md).

### Decisions already locked

- Planet radius **1,737,000** units, 1 unit = 1 metre (moon-scale).
- Altitude detail driven by **octave count derived from LOD level**, not a flat amplitude multiplier.
- **LOD cracks are ignored for now.** The skirt fix is specified as a Stage 2 task to pick up later.
- Player is a **6DOF pointer-lock flycam**; `OrbitControls` is removed.

### Constraints from the existing toolchain

- `verbatimModuleSyntax: true` → type-only imports **must** use `import type`.
- `erasableSyntaxOnly: true` → **no `enum`, no `namespace`, no parameter properties.** Use
  `const X = {...} as const` + `type X = typeof X[keyof typeof X]`.
- `noUnusedLocals`/`noUnusedParameters` are on. `strict` is not set in `tsconfig.app.json`, but **TypeScript 6
  defaults it on** — so `strictNullChecks` applies: `useState<T>(null)` needs `useState<T | null>(null)`.
- eslint `reactRefresh.configs.vite` → a file exporting a component must not also export non-components. Keep
  classes, hooks and constants in their own files.
- eslint-plugin-react-hooks **v7** adds `react-hooks/immutability`: the caller of a hook may not *assign* to the
  value it returned (method calls like `camera.position.copy()` are fine; `camera.fov = x` is not). Any hook that
  hands out a mutable accumulator must also own the mutation — `usePointerLook` returns a `drain(out)` for this
  reason. `AdaptiveFov` carries a scoped `eslint-disable` because writing `camera.fov` *is* its job.
- React 19 + `StrictMode` double-fires effects in dev. The worker pool and the origin store are **plain classes
  created outside React**, so double-mounting cannot duplicate them.

## Why a floating origin

float32 has a 24-bit mantissa. The ULP at distance `d` is `d · 2⁻²³`:

| distance from render origin | vertex precision |
|---|---|
| 10 km | 1.2 mm |
| 100 km | 1.2 cm |
| 1,737 km (planet radius) | **21 cm** — visibly chunky |
| 10⁷ | 1.2 m — unusable |

So: the renderer must always see small numbers. Two separate rules achieve that, and **both are required** —
getting only the first is the classic mistake.

**Rule A — keep the camera near render-space zero.** `Object3D.position`, `Matrix4` elements and
`camera.matrixWorldInverse` are all plain JS numbers (f64) on the CPU. three computes
`modelViewMatrix = cameraMatrixWorldInverse · objectMatrixWorld` in f64 and only *then* uploads float32. So as long
as the *result* is small (object near camera), precision survives — regardless of how large the intermediate
positions were. The floating origin's job is to keep that result small.

**Rule B — keep vertex attribute data small.** Buffer attributes *are* float32 in memory and on the GPU; no f64
math saves them. Therefore **every chunk's vertices are authored relative to that chunk's own centre**, and the
chunk mesh's `position` carries the offset (in f64) from the planet root. A 33×33 chunk at LOD 0 then has vertex
coords within ±1.4 Mm… which is still too big, so note the practical consequence: *low-LOD chunks are inherently
coarse and that is fine* (their quads are 85 km; 21 cm of precision is invisible). High-LOD chunks, where precision
matters, have tiny local extents and are exact. This is why per-chunk local origins are non-negotiable.

## Origin-shift algorithm

`origin` = the absolute world coordinate that render-space `(0,0,0)` currently represents.

```
renderPos = absPos - origin
```

Each frame, in the Player's `useFrame`, **after** integrating movement and **before** writing the camera:

```
if (playerAbs.distanceTo(origin) > REBASE_THRESHOLD) {
  origin.copy(playerAbs)
  for (const body of bodies) body.object3d.position.copy(body.absPosition).sub(origin)
  emit('rebase')                       // for systems caching render-space data
  rebaseCount++                        // HUD
}
camera.position.copy(playerAbs).sub(origin)
camera.quaternion.copy(playerQuat)     // rebase must never touch orientation
```

Properties worth noting:

- Rebase is **O(number of registered bodies)**, which is a handful — planets register *one* root group each; the
  hundreds of chunks are children of it and are never touched.
- At top gear the player travels further than the threshold in a single frame. That is harmless: rebase snaps
  `origin` exactly onto `playerAbs`, so the camera lands at exactly `(0,0,0)` that frame. There is no accumulating
  error, only a rebase on most frames — which is cheap.
- Because `origin.copy(playerAbs)` is exact, nothing moves on screen. Any visible pop at a rebase is a bug (a body
  that didn't register, or cached render-space state that didn't refresh).

## Registration API

```ts
// src/core/FloatingOrigin.ts   (plain class, no React)
export interface WorldBody {
  absPosition: Vector3        // f64, authoritative
  object3d: Object3D          // render-space; position is derived
}

export class FloatingOrigin {
  readonly origin = new Vector3()
  rebaseCount = 0
  register(body: WorldBody): () => void      // returns unregister
  onRebase(cb: () => void): () => void
  toRender(abs: Vector3, out: Vector3): Vector3
  toAbsolute(render: Vector3, out: Vector3): Vector3
  update(playerAbs: Vector3): boolean        // the algorithm above; true if shifted
}
```

`register` immediately syncs the body's render-space position, so a body that mounts after a rebase lands in the
right place without waiting for the next shift.

A module-level singleton is created in `src/core/originContext.tsx` and handed down via React context, with a
`useOrigin()` hook and a `useWorldBody(absPosition)` hook that registers an `Object3D` ref and returns it. That
file exports no component — the consumer renders `<OriginContext value={floatingOrigin}>` directly — which keeps
the `react-refresh/only-export-components` rule satisfied.

## Player

- **State** lives in a plain `PlayerState` class instance (`absPosition: Vector3`, `quaternion: Quaternion`,
  `velocity: Vector3`, `gear: number`) — **never React state**, so no re-render per frame. It is a module-level
  singleton (`playerState`) for the same reason the origin store is: StrictMode cannot duplicate it, and the HUD
  can read it without prop-drilling a ref out of the Canvas.
- **Orientation is a quaternion**, not Euler angles: mouse dx/dy rotate about the *local* Y/X axes, Q/E roll about
  local Z. Rotations are applied by **post**-multiplication (`q.multiply(delta)`), which is what makes the axes
  local. This gives full 6DOF with no gimbal lock, which is what you want in space.
- **Input**: `usePointerLook` requests pointer lock on canvas click, accumulates `movementX/Y` into a ref, reads
  `wheel` for gear changes, and returns a `drain(out)` that hands the frame loop the pending delta and zeroes the
  accumulator in one step. `useKeyboard` maintains a `Set<string>` of held `event.code`s in a ref and clears it on
  `blur`, since a key released while unfocused never fires `keyup`. Both are listeners, not state.
- **Movement**: build a local-space direction from WASD + Space/Ctrl, transform by the quaternion, scale by
  `gearSpeed`, and damp the velocity toward it exponentially (`MOVE_DAMPING`) so stops aren't instant. `dt` is
  clamped so a backgrounded tab doesn't teleport the player.

### Speed gears

An integer gear, ±1 per wheel notch, clamped, indexed into a table. Roughly ×5 per notch so the range spans walking
to interplanetary:

| gear | m/s | feel |
|---|---|---|
| 0 | 1.4 | walking |
| 1 | 5.5 | sprint |
| 2 | 20 | vehicle |
| 3 | 100 | aircraft |
| 4 | 500 | jet |
| 5 | 2,000 | suborbital |
| 6 | 10,000 | orbital |
| 7 | 50,000 | escape |
| 8 | 250,000 | cruise |
| 9 | 1,000,000 | fast cruise |
| 10 | 5,000,000 | interplanetary |
| 11 | 25,000,000 | hyperdrive |

## Depth buffer at planetary scale

A single `near=0.1 / far=1e9` camera is a 10⁹ depth range — hopelessly beyond a 24-bit buffer, and this will look
like catastrophic z-fighting the moment the planet exists. **Start with `logarithmicDepthBuffer: true`** on the
Canvas `gl` prop. It's one line and eliminates the whole problem class while the LOD system is being built.

Caveats to record, because they constrain Plan 2:

- It writes `gl_FragDepth`, which **makes `polygonOffset` a no-op**. This is exactly why Plan 2 does *not* use a
  second wireframe mesh with polygon offset.
- It disables early-Z rejection, so there's a fill-rate cost.
- Custom shaders must keep three's `logdepthbuf_*` shader chunks. Patching `MeshStandardMaterial` via
  `onBeforeCompile` preserves them automatically; writing a raw `ShaderMaterial` would not.
- **Stage 2 alternative** (drop logDepth, regain perf): recompute `near`/`far` each frame from altitude —
  `near = clamp(altitude · 0.001, 0.1, …)`, `far = horizonDistance + planetRadius · 2`. That keeps the ratio near
  10⁵, which 24-bit depth handles, and restores `polygonOffset`.

## Per-frame ordering — an R3F gotcha

In R3F, `useFrame(cb, priority)` with **any `priority > 0` disables the automatic render**, forcing you to call
`gl.render` yourself. To order systems while keeping automatic rendering, use **negative** priorities (subscribers
run ascending):

| priority | system |
|---|---|
| `-20` | Player: input → integrate → `origin.update()` → write camera |
| `-10` | Planet: quadtree update, enqueue/cancel, geometry uploads (Plan 2) |
| `0` | nothing (default) |
| — | HUD reads the singletons on a ~10 Hz `setInterval`, outside the render loop |

The Player must run first so the LOD system sees this frame's position and the post-rebase origin.

## Files — Plan 1

| file | responsibility |
|---|---|
| `src/core/constants.ts` | every tuning constant, one place |
| `src/core/FloatingOrigin.ts` | origin store, rebase, body registry (plain class) |
| `src/core/originContext.tsx` | singleton + React context + `useOrigin()` |
| `src/core/useWorldBody.ts` | register an `Object3D` ref at an absolute position |
| `src/player/PlayerState.ts` | absPosition, quaternion, velocity, gear (+ singleton) |
| `src/player/speedGears.ts` | `SPEED_TABLE`, `gearToSpeed`, clamping |
| `src/player/useKeyboard.ts` | held-keys ref |
| `src/player/usePointerLook.ts` | pointer lock, mouse deltas, wheel → gear |
| `src/player/Player.tsx` | the `-20` frame loop; owns the camera |
| `src/debug/MarkerRig.tsx` | throwaway decade markers for verifying the origin |
| `src/ui/DebugHud.tsx` | abs position, gear, speed, origin, rebase count, fps |
| `src/App.tsx` | **modified**: remove `OrbitControls` + orange cube, add `gl={{ logarithmicDepthBuffer: true }}`, `near`/`far`, provider, `<Player/>`, `<DebugHud/>`, a temporary marker rig |

The **marker rig** is throwaway test scaffolding: 8 emissive spheres registered as world bodies at
`10¹ … 10⁸` units along +X, each sized proportionally to its distance so they stay visible. It's how Plan 1 gets
verified before any planet exists.

`|camera.position|` on the HUD is computed as `playerAbs.distanceTo(origin)` — mathematically the same number, and
it keeps the HUD outside the Canvas where it doesn't cost a render.

## Verification — Plan 1

1. Click to lock pointer; WASD/mouse/Q/E/Space/Ctrl all respond. Wheel steps the gear readout 0↔11.
2. At gear 2, fly slowly past the 10 km marker and watch it while the rebase counter ticks. **Nothing on screen may
   move at the tick.** A visible pop = an unregistered body or stale cached render-space data.
3. Hold gear 11 toward +X for a few seconds. HUD absolute X passes 10⁸. Markers remain rock-steady, not jittering.
4. HUD `|camera.position|` must stay ≤ `REBASE_THRESHOLD` while moving slowly, and ≈0 at high gear.

Failure modes: objects vibrating → rebase not applied to all bodies. Camera distance growing without bound →
threshold check never firing. View direction snapping at a rebase → something is writing `camera.quaternion` during
rebase.

## Implementation order

`constants` → `FloatingOrigin` → input hooks → `PlayerState` + `speedGears` → `Player.tsx` → `DebugHud` → strip
`App.tsx` and add the marker rig → verify.
