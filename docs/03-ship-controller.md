# Plan 3 — Third-person ship controller

**Status: implemented 2026-10-02.** `yarn build` and `yarn lint` pass, and the auto-level sign was checked
numerically: it converges from ±0.5 and 2.5 rad of roll. Feel and tuning are **not yet verified in a browser**.

## Context

With the Plan 1 flycam, the eye *was* the player. With nothing at a known scale in view, there was no way to judge
how detailed the terrain under you was. The player is now a **~12 m ship** with an NMS-style chase camera, and the
gears are replaced by flight modes: impulse, cruise and hyperdrive, with an atmosphere that brakes the ship and
levels it. The old flycam is kept behind **V**.

### The invariant

**The ship is the player.** `playerState.absPosition` is the ship's position. The floating origin
(`origin.update`) and the LOD split test (`Planet`) both follow it, unchanged. The camera is *derived* from the
ship and sits ~20 m away in render space, so it never decides where the origin goes. The HUD row `|player|` is
the ship's distance from render zero.

## Controls

| input | ship mode | flycam (V) |
|---|---|---|
| mouse | moves the reticle; offset → turn rate | look |
| W | impulse | forward |
| Shift | cruise | — |
| S | brake, then slow reverse | back |
| A / D | roll | strafe |
| Space | hold to charge hyperdrive; new press drops out | up |
| wheel | — | gear |

## Files

| file | responsibility |
|---|---|
| `src/player/PlayerState.ts` | adds `mode`, `angularVelocity`, `reticle`, `bank`, `throttle`, `thrust`, `speedCap`, `atmo`, `hyper`, `cameraQuat`; `enterFlycam()` / `enterShip()` |
| `src/player/shipFlight.ts` | `stepShip`: hyperdrive state machine, steering, thrust, drag, swept cutoff. Pure and allocation-free |
| `src/player/atmosphere.ts` | `atmosphereFactor`, `blendCap`, `segmentSphereEntry` |
| `src/player/chaseCamera.ts` | `updateChaseCamera` |
| `src/player/flycam.ts` | the Plan 1 controller, unchanged in behaviour |
| `src/player/ShipModel.tsx` | primitive mesh; an inner pivot carries the visual bank and the engine glow |
| `src/player/Player.tsx` | orchestrator at priority -20: input → mode toggle → step → origin → ship transform → camera |
| `src/ui/ShipHud.tsx` | reticle, hyperdrive countdown and warnings; its own rAF loop writing the DOM through refs |

The Player takes the planet as a prop (`<Player planet={MOON} />`). A second planet will need a registry the ship
can query for the nearest atmosphere.

## Flight model

**Atmosphere factor.** `atmo ∈ [0, 1]` is an exponential density profile (scale height 30 km), rescaled so it is
exactly 0 at `ATMOSPHERE_HEIGHT` (150 km) and 1 at the reference sphere. There's no step at the edge. Everything
atmospheric scales with it.

**Steering — virtual reticle.** Mouse pixels move a reticle inside a unit disc. The reticle drifts back to
centre (`RETICLE_RECENTER`), and past a dead zone its offset sets a target pitch/yaw *rate*. The local-frame
`angularVelocity` eases toward that target and is applied by post-multiplication, so the axes are local, as in
Plan 1. A steady curve needs no constant mouse motion.

**Roll and auto-level.** A/D drive the roll rate. In the atmosphere, with A/D released, a correcting roll rate
turns the ship's up toward the horizon's up. That horizon up is the local radial projected onto the plane
perpendicular to forward. The correction is scaled by `√atmo`, so it is already felt in thin air, and it is
clamped. **Pitch is never touched.** It is disabled past `|forward·up| > 0.95`, where "level" is undefined.

**Visual bank.** The mesh pivot tilts toward `yawRate / MAX_YAW_RATE · MAX_BANK`. The tilt is mesh-only: the
camera and the physics never see it.

**Thrust.** Each mode has a space cap and a surface cap. The cap at the current altitude is the *geometric*
blend `space · (surface/space)^atmo`, which falls evenly across orders of magnitude: cruise goes from 30 km/s
to about 5.8 km/s at 20 km, then 1.2 km/s at the surface. Below the cap, acceleration is `cap / accelTime`.
Above it, an active mode settles down onto the cap exponentially, so letting go of Shift and holding W returns
to impulse speed in seconds. With nothing held in space, the ship coasts. S brakes and then reverses. Sideways
velocity is damped (`LATERAL_DAMPING`), so the ship mostly goes where it points.

**Drag.** Only speed *above the cruise cap* (the fastest the air allows at this altitude) is braked, at
`(LINEAR + QUAD · excess) · atmo · excess`. Drag therefore never fights thrust that is within the cap, and a hot
entry is braked hard once the air thickens. An unpowered ship also loses speed slowly in air (`ATMO_COAST_DRAG`).

### Hyperdrive

`Idle → Charging → Engaged`:

- **Starting a charge** takes a **rising edge** of Space and a **clear path**. The path is clear above
  `HYPER_MIN_ALTITUDE` (400 km) whatever the heading. Below that, at any altitude, it is clear when the nose's
  line misses the sphere `radius + MAX_ELEVATION` (`rayHitsSphere`). Below the peaks, only a climbing ship is
  clear. This is how you jump *out* of the atmosphere: aim at open space. When the path is blocked, a warning
  shows for 2 s. The rising edge matters: Space can still be held after a drop-out, and it must not re-arm the
  drive.
- **Charging** lasts `HYPER_CHARGE_TIME` (3 s). Releasing Space cancels it. So does steering into the planet
  mid-charge, which is checked every frame.
- **Leaving from inside the atmosphere is safe.** The swept cutoff only fires on *entry* (`segmentSphereEntry`
  returns -1 from inside), and a straight line that has left a sphere never re-enters it.
- **Engaging** locks `hyper.dir` to the forward vector at that moment. While engaged, orientation is frozen,
  the reticle is parked, and speed spools up to `HYPER_SPEED` (2,000 km/s).
- **Dropping out** happens on a new Space press, or automatically at the atmosphere. Either way the velocity
  becomes `dir · HYPER_EXIT_SPEED` (20 km/s), and drag takes over from there.

**The cutoff is swept, not a point test.** At 2,000 km/s a 60 Hz frame covers 33 km, and a long frame covers
200 km (`MAX_FRAME_DELTA`). That is more than the atmosphere is deep. Before integrating, the segment
`pos → pos + v·dt` is intersected with the sphere `radius + ATMOSPHERE_HEIGHT`. On a hit, the position is placed
exactly on it.

## Chase camera

`cameraQuat` slerps toward the ship's quaternion; the position is **not** smoothed. It is computed rigidly as
`(shipAbs − origin) + cameraQuat · CHASE_OFFSET`. Lerping the position in world space would leave the camera
kilometres behind at cruise and hyperdrive speed. Deriving the position from the lagged orientation gives the
same swing in a turn at any speed. The rule "rebase never touches orientation" still holds.

## Mode switching

`enterFlycam()` moves the player to the chase camera's exact pose. `enterShip()` puts the ship one chase-offset
ahead of the flycam. In both directions the view doesn't jump.

## Verification

1. `yarn build`, `yarn lint`. ✔
2. The ship is visible at spawn. The reticle steers it, the ship banks into turns, and A/D roll it.
   W, Shift and S match the HUD caps.
3. `|player|` stays ≤ `REBASE_THRESHOLD` and the ship doesn't pop at rebases at cruise speed.
4. Hold Space at spawn: the countdown runs, and releasing early cancels it. After engaging, the ship flies
   straight; a fresh press stops it.
5. Engage toward the planet: the drive cuts off at **150 km** altitude, and the speed then bleeds toward the cap.
6. Below 400 km, the hyperdrive is refused while aimed at the planet, and the warning shows. Aimed at open sky
   it charges, even from inside the atmosphere, and the ship leaves without being cut off.
7. In air, roll 60° and release: the wings level slowly and pitch is unchanged.
8. Fly low at impulse to judge chunk density against a ship of known size. V toggles without a jump.

## Deferred

- No collision with the terrain or the surface yet, and no gravity.
- No entry heat or camera shake.
- A single planet is passed as a prop; there is no registry yet.
- All numbers are first guesses; tune them in `constants.ts`.
