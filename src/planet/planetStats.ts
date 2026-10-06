/**
 * Mutable snapshot written by `Planet`'s frame loop and read by the HUD on its own
 * timer — the same pattern as `playerState`, and for the same reason: a HUD that
 * re-rendered with the render loop would be the most expensive thing on screen.
 *
 * One object for the whole app. With two planets the second one wins, which is
 * acceptable for a debug readout.
 */
export const planetStats = {
  /** Visible leaf chunks, and how many of them draw with the far material. */
  leaves: 0,
  farLeaves: 0,
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
  /** Same for the far-material bake alone, over the chunks that had one. */
  bakeMs: 0,
  /** Far materials (each with its texture) ever made, and how many are parked. */
  farCreated: 0,
  farFree: 0,
  /** Player height above the reference sphere, metres. Negative means underground. */
  altitude: 0,
}
