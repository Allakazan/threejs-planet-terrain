/**
 * Mutable snapshot for the HUD, written by the collision code and read on the
 * HUD's timer — the `planetStats` pattern.
 */
export const collisionStats = {
  /** Planets whose atmosphere the player is inside. */
  activePlanets: 0,
  /** Live tiles, built tiles, and the ones whose collider is enabled. */
  tiles: 0,
  ready: 0,
  enabled: 0,
  /** Finest enabled level. */
  deepest: 0,
  /** Ship hits on the tiles, and the into-ground speed of the last one, m/s. */
  impacts: 0,
  lastImpactSpeed: 0,
  /** Times the ground guard had to lift the ship out of the terrain. */
  guardPushes: 0,
  lastGuardDepth: 0,
}
