/**
 * Mutable snapshot written by `Planet`'s frame loop and read by the HUD on its own
 * timer — the same pattern as `playerState`, and for the same reason: a HUD that
 * re-rendered with the render loop would be the most expensive thing on screen.
 *
 * One object for the whole app. With two planets the second one wins, which is
 * acceptable for a debug readout.
 */
export const planetStats = {
  /** Visible leaf chunks. */
  leaves: 0,
  /** Every node alive, interior included. */
  nodes: 0,
  deepest: 0,
  queued: 0,
  inFlight: 0,
  /** Geometries ever allocated, and how many are parked in the pool. */
  poolCreated: 0,
  poolFree: 0,
  /** Moving average of one chunk's build time, ms. */
  buildMs: 0,
  /** Player height above the reference sphere, metres. Negative means underground. */
  altitude: 0,
}
