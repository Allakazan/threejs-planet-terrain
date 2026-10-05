# Plan 5 — Terrain collision

**Status: implemented 2026-10-04.** `yarn build` and `yarn lint` pass. `sphereToFace` round-trips `faceToSphere`
to within 1.4e-14 over 12k samples, including face edges and corners. A headless run against real tiles (fake pool
building synchronously, real Rapier) covered four cases:

- **10 km/s vertical dive:** bounced off the finest level (18), no tunnelling.
- **50 m/s descent:** bounced.
- **2 km/s skim:** bounced.
- **Ship buried 30 m (terrain Apply):** the guard lifted it out.

**Not yet verified in a browser,** so worker latency, feel and tuning are untested.

## Context

The ship flew through the ground. We wanted collision that bumps the ship off the terrain now, and that later
carries landing and a walking character on Rapier. More planets are planned, so collision belongs to *a* planet.

### Why not colliders from the render LOD

- **Render chunks exist only where the camera caused them, and arrive frames late.** At cruise (10 km/s ≈ 166 m
  per frame) the chunk ahead often isn't built, so the ship tunnels through.
- **Levels are different surfaces.** `nyquistWeight` filters octaves per level, so stacking levels gives several
  grounds. Using one level per spot brings back the LOD cracks (docs/02), which a walker falls through.
- **The render tree churns,** and its split rule doesn't look ahead along the velocity.
- **Rapier's JS builds are f32-only.** The f64 builds are Rust crates only. The world lives in render space and is
  rebased like everything else.

## Design

A Rapier world that follows the player, filled with **collision tiles** built from the terrain function by the
existing `buildChunk`, independent of the render tree. The ship collides through a **query**; the walker will use
`KinematicCharacterController` against the same tiles.

### 1. Per planet, inside its atmosphere

`collisionPatches` keeps one `CollisionPatch` per planet whose atmosphere (`ATMOSPHERE_HEIGHT`) contains the
player, and drops its colliders when the player leaves. The hyperdrive can't run inside an atmosphere, which bounds
the speed and so how far ahead tiles must reach. Patches are keyed by `centreAbs` identity; a new terrain version
swaps the config and rebuilds the tiles. When the second planet arrives, `ATMOSPHERE_HEIGHT` moves into
`PlanetConfig`.

### 2. The ship stays plain maths

`world.castShape` is a scene query: a cuboid (`SHIP_HALF_EXTENTS`, `SHIP_COLLIDER_OFFSET`), a pose, and this
frame's displacement in; time of impact and normal out. It needs no rigid body.

- `stepShip` runs unchanged.
- `resolveShipCollision` sweeps `prevAbs → absPosition`. On a hit it clips the ship to the time of impact, then
  bounces the velocity:
  - restitution on the normal part;
  - Coulomb friction on the tangential part (the loss scales with the normal impulse, so a graze barely slows the
    ship);
  - a minimum separation speed.
- `stopAtPenetration = false`, so a ship that starts inside a tile but is moving out is let go.
- The normal is flipped toward the ship when needed. With no normal (the cast started in penetration), local up is
  used.

### 2b. Impact response (`shipImpact.ts`)

Everything is keyed on the impact **normal speed** `|v·n|`. There is no mass in the model, so this is the honest
"force". A fast graze survives; a slow head-on hit still staggers.

- **Crash:** above `CRASH_SPEED` (400 m/s), `PlayerState.respawn()` puts the ship back at `START_ABS_POSITION`
  instantly. `ShipHud` shows `HULL BREACH` for `CRASH_MESSAGE_TIME`. The origin rebases, the patch empties above
  the atmosphere and the guard returns early, all by themselves.
- **Knockback:**
  - The into-ground part of the flight velocity is removed, so the ship slides on. Coulomb friction takes some of
    the tangential part.
  - The bounce goes into `ship.knockback`, a separate vector that decays at `KNOCKBACK_DECAY`. Its speed is capped
    at `KNOCKBACK_DISTANCE · KNOCKBACK_DECAY`, so it travels at most `KNOCKBACK_DISTANCE` (3 m).
  - `applyKnockback` runs between `stepShip` and the sweep, so the push is swept too.
  - It is separate because the flight model never damps a velocity component along the nose. A bounce written into
    `velocity` would carry on for kilometres.
- **Stagger:** above `STAGGER_MIN_SPEED`, an angular kick along `I⁻¹ (r × n)` in the ship's frame.
  - `r` is the box's support point: the mean of the corners deepest against the surface. Rapier's witness point can
    be any corner of a face contact, which would spin a flat landing.
  - The size ramps to `STAGGER_MAX_RATE` at `STAGGER_FULL_SPEED` (the impulse cap), scaled by the lever.
  - `steer()` eases it back toward the reticle and auto-level pulls the roll back, so the ship wobbles and
    recovers.
  - Headless results: a 45° nose-first dive at 100 m/s pitched up at 0.6 rad/s; a wingtip strike was mostly roll; a
    flat landing produced 0.01 rad/s; a 10 m/s touch produced none.

### 3. Resolution from distance, coverage from speed

- **Region:** a capsule from `ship` to `ship + v · COLLISION_LOOKAHEAD`, radius `COLLISION_PATH_RADIUS`. It counts
  only if it comes within `radius + maxElevation + COLLISION_MARGIN` of the planet centre; above that the patch is
  empty.
- **Tile test:** a tile is wanted when its ground footprint (`groundCentre`, `reach`) is within the radius of the
  capsule's ground track. Tiles already wanted are kept until the radius is `COLLISION_KEEP_FACTOR` wider.
- **Split:** `dist(ship, tile) < arc · COLLISION_SPLIT_FACTOR`, clamped to
  `[COLLISION_MIN_LEVEL, COLLISION_MAX_LEVEL]`, with the render tree's `MERGE_HYSTERESIS`.

The ground about to be touched is at distance ≈ 0, so it is always the finest level, whatever the speed or
direction. Speed only stretches the capsule.

### 4. Tiles

A tile is a quadtree patch `(face, cu, cv, half, level)` with the same addressing as a render node. It is built by
`buildChunk` through `chunkWorkerPool` as an *urgent* job: dispatched before render chunks, delivered outside
`MAX_UPLOADS_PER_FRAME`. It becomes one trimesh collider with no body, registered at its f64 `chunkOrigin` and
re-placed on rebase. Same-level tiles share bit-identical edges.

`CollisionTile` is a separate, small tree, modelled on `QuadTreeNode`:

- **Roots** are the level-`COLLISION_MIN_LEVEL` cells under the track. The track is sampled at half a root's
  spacing, plus a sample `COLLISION_PATH_RADIUS` to each side, and each sample is mapped through `sphereToFace`.
  This handles face edges for free.
- **Children are created inactive.** Only those intersecting the capsule are requested.
- **A tile may split before it is Ready,** so a fast dive requests the whole chain of levels at once.
- **Two phases per frame:**
  - `plan()` shapes the tree and returns whether the tile's wanted ground is covered;
  - `show()` enables exactly one level per piece of ground. A parent stays enabled until every wanted child is
    covered: the render tree's hole-free handover, applied to colliders.
- **Interior tiles keep their (disabled) collider,** so a merge is instant.

Headless counts (synchronous builds): a slow descent holds about 16 enabled tiles at level 18. A 10 km/s dive peaks
at about 38, and a 2 km/s skim at about 47.

### 5. Ground guard

`groundGuard` samples the terrain function (level `COLLISION_MAX_LEVEL`) under the 8 corners of the box every
frame, and does nothing above `maxElevation`. If a corner is more than `GROUND_GUARD_DEPTH` below the surface, it
lifts the ship by that depth plus `GROUND_CLEARANCE` and removes the inward velocity.

It covers a terrain Apply that buries the ship, the frames before tiles arrive, and any step outside them. The
tolerance keeps it from fighting the tiles, whose triangles sit slightly off the function between vertices.

### Frame order (Player, priority -20, ship mode)

1. `prevAbs = absPosition`
2. `collisionPatches.update`: plan and show; enabled colliders are flushed by the next step
3. `stepShip`
4. `applyKnockback`
5. `resolveShipCollision`: `world.step()` to flush changes, then `castShape`, then `applyImpact`
6. `groundGuard`
7. `origin.update`: a rebase re-places colliders, flushed by the next frame's step

The planet (-10) then pumps the pool, which delivers tiles; they are created disabled.

## Files

| file | responsibility |
|---|---|
| `src/physics/physicsWorld.ts` | Rapier init, the world, static colliders at f64 positions, rebase |
| `src/physics/CollisionTile.ts` | one tile and its subtree: request, plan, show, deactivate |
| `src/physics/CollisionPatch.ts` | per planet: capsule, root cells, the per-frame walk |
| `src/physics/collisionPatches.ts` | which planets are active |
| `src/physics/shipCollision.ts` | `resolveShipCollision` (the sweep), `groundGuard` |
| `src/physics/shipImpact.ts` | `applyImpact` (crash, knockback, stagger), `applyKnockback` |
| `src/physics/collisionStats.ts` | HUD snapshot |
| `src/planet/quadsphere.ts` | `sphereToFace` (Newton on the gnomonic projection of `faceToSphere`) |
| `src/planet/ChunkWorkerPool.ts` | `urgent` jobs |
| `src/debug/CollisionDebug.tsx` | wireframe of enabled tiles, red (coarse) → green (finest), toggle **C** |

## To verify in a browser

- **Above the atmosphere:** HUD `collide off`.
- **Upper atmosphere:** 0 tiles until the path nears the shell.
- **Full-cruise dive:** the wireframe refines toward the ship, and the impact is on green tiles.
- **Skimming:** no jitter.
- **Taller preset Apply near the ground:** the guard count increments and the ship is lifted out.
- **More than 10 km near the ground:** colliders stay aligned after a rebase.
- **`USE_WORKERS = false`:** still works.

## Open

- **Crash threshold vs terrain slope:** the normal speed includes the slope. A 2 km/s skim at 5° hit a slope at
  ~1.2 km/s and crashed. Raise `CRASH_SPEED` if cruise over mountains feels unfair.
- **Worker load:** the skim built ~430 tiles in 2 s headless. If workers can't keep up in the browser, raise
  `COLLISION_MIN_LEVEL`, shorten `COLLISION_LOOKAHEAD`, or drop tiles whose surface is far below the capsule (this
  needs per-tile min/max altitude).
- **Prefetch:** if dives land on coarse parents too often, measure the split distance from the ship's position a
  moment ahead.
