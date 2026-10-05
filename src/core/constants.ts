/**
 * Every tuning constant lives here, so there is exactly one place to look when
 * something feels wrong.
 *
 * The planet block comes first because the player's spawn is expressed in planet
 * radii — module initialisation is top-down, so the dependency has to be above.
 */

// --- planet ---

/** Moon-scale. 1 unit = 1 metre throughout. */
export const PLANET_RADIUS = 3_737_000

/** Quads per chunk edge → (RES+1)² verts. 33² = 1089 keeps the index Uint16. */
export const CHUNK_RESOLUTION = 32

/**
 * 12 gives ~20 m quads — plenty to prove the system while keeping chunk counts
 * and generation load low. 16 reaches ~1.3 m; see docs/02 for the table.
 */
export const MAX_LOD_LEVEL = 19

/** Split when the player is closer than `nodeArc · SPLIT_FACTOR`. */
export const SPLIT_FACTOR = 2.0
/** Merge only past `splitDistance · MERGE_HYSTERESIS`, so boundaries don't thrash. */
export const MERGE_HYSTERESIS = 1.25

/** Geometries attached per frame, so a burst of arrivals can't spike a frame. */
export const MAX_UPLOADS_PER_FRAME = 2

/** Leave a core for the main thread; more than 6 stops helping. */
export const WORKER_COUNT = Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))

/** false → generation runs synchronously, which gives breakpoints and stacks. */
export const USE_WORKERS = true

// --- terrain ---
// The layer stack itself is data, in `planet/terrain/presets.ts`, and is live-edited
// with the terrain panel (T). See docs/04.

/** Key into `TERRAIN_PRESETS`. */
export const DEFAULT_TERRAIN_PRESET = 'rocky'

/** Per-layer octave cap the terrain panel allows. The Nyquist rule rarely reaches it. */
export const MAX_OCTAVES = 20

export const SEED = 1337

// --- origin ---

/** Rebase once the player drifts this far from render-space zero. See docs/01. */
export const REBASE_THRESHOLD = 10_000

// --- player ---

export const GEAR_MIN = 0
export const GEAR_MAX = 11
/** Gear 8 ≈ 250 km/s — reaches the surface from the spawn in about 20 s. */
export const START_GEAR = 8

/** radians of rotation per pixel of mouse movement */
export const MOUSE_SENSITIVITY = 0.0022
/** rad/s of roll from Q/E */
export const ROLL_SPEED = 1.2
/** 1/s — velocity converges on the input direction at this rate */
export const MOVE_DAMPING = 12
/**
 * A backgrounded tab hands back one enormous delta on return. Clamping it costs
 * a little travel and saves the player from being flung past the solar system.
 */
export const MAX_FRAME_DELTA = 0.1

/**
 * Three radii out along +Z: the planet's angular diameter is then ~39°, which
 * frames it inside a 50° fov with room to spare.
 */
export const START_ABS_POSITION: readonly [number, number, number] = [0, 0, PLANET_RADIUS * 3]
/** Default camera forward is -Z, which already points at the planet. */
export const START_YAW = 0

// --- ship: steering (see docs/03) ---

const DEG = Math.PI / 180

/** Reticle units (a unit disc) per pixel of mouse movement. */
export const RETICLE_SENSITIVITY = 0.004
/** Reticle radius below which the ship doesn't turn. */
export const RETICLE_DEADZONE = 0.06
/** 1/s — the reticle's exponential drift back to centre. 0 = it stays put. */
export const RETICLE_RECENTER = 0.6
/** rad/s at full reticle deflection */
export const MAX_YAW_RATE = 1.1
export const MAX_PITCH_RATE = 1.4
/** rad/s of roll from A/D */
export const SHIP_ROLL_SPEED = 2.2
/** 1/s — angular velocity converges on the reticle's demand at this rate. */
export const ANGULAR_RESPONSE = 5
/** Visual-only tilt of the mesh at full yaw rate. Never touches the flight frame. */
export const MAX_BANK = 35 * DEG
export const BANK_RESPONSE = 4
/** 1/s of roll correction per radian of error, scaled by √atmo. */
export const AUTOLEVEL_RATE = 0.9
/** rad/s — cap on the auto-level roll rate. */
export const AUTOLEVEL_MAX_RATE = 0.8
/** Past this |forward·up| the ship is diving or climbing vertically and "level" is undefined. */
export const AUTOLEVEL_MAX_DOT = 0.95

// --- ship: thrust ---

/** Caps blend geometrically from `maxSpeedSpace` to `maxSpeedSurface` with the atmosphere factor. */
export type ThrustProfile = {
  readonly maxSpeedSpace: number
  readonly maxSpeedSurface: number
  /** seconds from rest to the cap; acceleration = cap / accelTime */
  readonly accelTime: number
}
/** W */
export const THRUST_IMPULSE: ThrustProfile = { maxSpeedSpace: 250, maxSpeedSurface: 150, accelTime: 4 }
/** Shift */
export const THRUST_CRUISE: ThrustProfile = { maxSpeedSpace: 30_000, maxSpeedSurface: 7_000, accelTime: 4 }
/** S, once stopped */
export const MAX_REVERSE_SPEED = 50
export const REVERSE_ACCEL_TIME = 2
/** S while moving forward: decel = max(BRAKE_DECEL_MIN, speed · BRAKE_RATE) */
export const BRAKE_RATE = 1.5
export const BRAKE_DECEL_MIN = 40
/** 1/s — sideways velocity bleeds off at this rate, so the ship goes where it points. */
export const LATERAL_DAMPING = 3
/** 1/s — engine glow follows the throttle at this rate. */
export const THROTTLE_RESPONSE = 4

// --- ship: atmosphere ---

/** Altitude where the atmosphere starts (factor 0) and the hyperdrive cuts out. */
export const ATMOSPHERE_HEIGHT = 150_000
/** e-folding height of the density profile. */
export const ATMOSPHERE_SCALE_HEIGHT = 30_000
/** Over-cap braking: decel = (LINEAR + QUAD · excess) · atmo · excess. */
export const ATMO_DRAG_LINEAR = 0.5
export const ATMO_DRAG_QUAD = 1e-4
/** 1/s at full density — an unpowered ship slows down in air. */
export const ATMO_COAST_DRAG = 0.15

// --- ship: hyperdrive ---

/**
 * "Outside orbit": above this, the drive charges whatever the heading. Below it,
 * only when the nose's line misses the planet (so you can jump *out*).
 */
export const HYPER_MIN_ALTITUDE = 400_000
/** seconds Space must be held */
export const HYPER_CHARGE_TIME = 3
export const HYPER_SPEED = 2_000_000
/** time constant of the spool-up to HYPER_SPEED */
export const HYPER_SPOOL_TIME = 0.6
/** Speed left after dropping out, by hand or at the atmosphere. */
export const HYPER_EXIT_SPEED = 20_000
/** seconds the "path blocked" warning stays up */
export const HYPER_BLOCKED_TIME = 2

// --- ship: chase camera ---

/** Camera offset in the camera's own frame: above and behind the ~12 m ship. */
export const CHASE_OFFSET: readonly [number, number, number] = [0, 4, 18]
/** 1/s — how fast the camera's orientation catches up with the ship's. */
export const CAMERA_ROT_LAG = 6

// --- collision (see docs/05) ---
// The patch is active inside a planet's atmosphere (`ATMOSPHERE_HEIGHT`), and only
// builds tiles where the ship's predicted path comes near the terrain.

/** Root tiles: ~1.4 km at Moon scale. Coarsest level the patch ever builds. */
export const COLLISION_MIN_LEVEL = 12
/** Finest tile: ~22 m, 0.7 m quads. Must not exceed `MAX_LOD_LEVEL`. */
export const COLLISION_MAX_LEVEL = 18
/** Split a tile when the ship is closer than `arc · COLLISION_SPLIT_FACTOR`. */
export const COLLISION_SPLIT_FACTOR = 2
/** Seconds of travel the patch covers ahead of the ship. Hides the worker round trip. */
export const COLLISION_LOOKAHEAD = 0.5
/**
 * Radius of the swept capsule tiles must touch, metres: the ship's reach (~9 m)
 * plus margin. Each tile adds its own reach on top, so this stays small.
 */
export const COLLISION_PATH_RADIUS = 25
/** Tiles once wanted are kept until the capsule is this much wider, so edges don't thrash. */
export const COLLISION_KEEP_FACTOR = 1.5
/** Slack above `maxElevation` before the capsule counts as near the terrain, metres. */
export const COLLISION_MARGIN = 200
/** Fraction of the into-ground speed given back on impact. */
export const COLLISION_RESTITUTION = 0.4
/** Coulomb-style: tangential speed lost per unit of normal impulse. */
export const COLLISION_FRICTION = 0.3
/** m/s — every contact leaves at least this fast, so a graze can't stick. */
export const COLLISION_MIN_BOUNCE = 3
/** Distance the swept ship stops short of the surface, metres. */
export const COLLISION_SKIN = 0.05

/** The ground guard only acts this far below the surface, so it never fights the tiles. */
export const GROUND_GUARD_DEPTH = 1
/** Where the guard puts the ship's lowest point, above the surface. */
export const GROUND_CLEARANCE = 0.5

/** Collision box of the ~12 m ship (`ShipModel`), in its local frame. */
export const SHIP_HALF_EXTENTS: readonly [number, number, number] = [5.8, 1.9, 6]
export const SHIP_COLLIDER_OFFSET: readonly [number, number, number] = [0, 0.8, -1]

// --- camera ---

export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 1e9
export const CAMERA_FOV = 50

// --- frame ordering ---

/**
 * R3F disables its automatic render as soon as any subscriber has priority > 0,
 * so ordering is done with negative priorities (they run ascending). The player
 * must run before the LOD system, which needs this frame's post-rebase origin.
 */
export const PRIORITY_PLAYER = -20
export const PRIORITY_PLANET = -10

// --- render order ---
// Terrain draws at the default 0. Debug overlays that skip the depth test draw
// next, then the ship, which still depth-tests against the terrain and so covers
// the overlays wherever it is in front.

export const RENDER_ORDER_DEBUG = 1
export const RENDER_ORDER_SHIP = 2

// --- debug ---

/** HUD sample rate; deliberately outside the render loop. */
export const HUD_INTERVAL_MS = 100

/** Wireframe-style grid drawn inside the surface shader. Toggled with G. */
export const SHOW_GRID = true
/** Half-width of a cell line, in pixels. */
export const GRID_LINE_WIDTH = 1.1
/** Half-width of the chunk-boundary line, in pixels — the LOD tell. */
export const GRID_BORDER_WIDTH = 2.4
