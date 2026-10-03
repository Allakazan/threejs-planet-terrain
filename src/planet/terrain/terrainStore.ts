import { useSyncExternalStore } from 'react'
import { DEFAULT_TERRAIN_PRESET } from '../../core/constants'
import { registerTerrainSpec } from './LayeredTerrain'
import { TERRAIN_PRESETS } from './presets'
import type { TerrainSpec } from './terrainSpec'

/**
 * The live terrain spec, main thread only. A module singleton like the rest of the
 * app's state; React only sees the version number, and only through
 * `useTerrainVersion`, because it changes once per Apply, never per frame.
 *
 * Every spec is cloned on the way in, so whatever the caller keeps editing (the
 * panel's draft) can never reach a version that is already in use.
 */
let version = 1
let spec: TerrainSpec = structuredClone(TERRAIN_PRESETS[DEFAULT_TERRAIN_PRESET])
registerTerrainSpec(version, spec)

const listeners = new Set<() => void>()

export function getTerrainVersion(): number {
  return version
}

export function getTerrainSpec(): TerrainSpec {
  return spec
}

/** Publishes a new version. The planet rebuilds from scratch on the next render. */
export function setTerrainSpec(next: TerrainSpec): void {
  spec = structuredClone(next)
  version++
  registerTerrainSpec(version, spec)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTerrainVersion(): number {
  return useSyncExternalStore(subscribe, getTerrainVersion)
}
