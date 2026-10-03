import { GEAR_MAX, GEAR_MIN } from '../core/constants'

/** Roughly ×5 per notch, so 12 gears span walking to interplanetary. m/s. */
export const SPEED_TABLE = [
  1.4, // walking
  5.5, // sprint
  20, // vehicle
  100, // aircraft
  500, // jet
  2_000, // suborbital
  10_000, // orbital
  50_000, // escape
  250_000, // cruise
  1_000_000, // fast cruise
  5_000_000, // interplanetary
  25_000_000, // hyperdrive
] as const

export const GEAR_LABELS = [
  'walking',
  'sprint',
  'vehicle',
  'aircraft',
  'jet',
  'suborbital',
  'orbital',
  'escape',
  'cruise',
  'fast cruise',
  'interplanetary',
  'hyperdrive',
] as const

export function clampGear(gear: number): number {
  return Math.min(GEAR_MAX, Math.max(GEAR_MIN, Math.round(gear)))
}

export function gearToSpeed(gear: number): number {
  return SPEED_TABLE[clampGear(gear)]
}

export function gearToLabel(gear: number): string {
  return GEAR_LABELS[clampGear(gear)]
}
