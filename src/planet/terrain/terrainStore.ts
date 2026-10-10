import { useSyncExternalStore } from 'react'
import { DEFAULT_PRESET, REBUILD_TIMEOUT_MS } from '../../core/constants'
import { registerTerrainBuild } from './LayeredTerrain'
import { PLANET_PRESETS } from './presets'
import type { TerrainBuild, TerrainSpec } from './terrainSpec'

/**
 * The live terrain build (spec + far-bake settings), main thread only. A module
 * singleton like the rest of the app's state; React only sees the version number
 * and the rebuild flag, both of which change once per rebuild, never per frame.
 *
 * Every build is cloned on the way in, so whatever the caller keeps editing (the
 * panel's draft) can never reach a version that is already in use.
 */
const initial = PLANET_PRESETS[DEFAULT_PRESET]
let version = 1
let build: TerrainBuild = structuredClone({
  spec: initial.terrain,
  bake: { cavityRadius: initial.material.cavityRadius, cavityGain: initial.material.cavityGain },
})
registerTerrainBuild(version, build)

/**
 * True from a publish until the planet's new tree has everything it asked for
 * (see `updateRebuild`). The panel locks its rebuild-triggering inputs meanwhile,
 * so edits can never pile up behind a rebuild in flight. The first build counts.
 */
let rebuilding = true
let rebuildStarted = performance.now()

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function getTerrainVersion(): number {
  return version
}

export function getTerrainBuild(): TerrainBuild {
  return build
}

export function getTerrainSpec(): TerrainSpec {
  return build.spec
}

export function isTerrainRebuilding(): boolean {
  return rebuilding
}

/** Publishes a new version. The planet rebuilds from scratch on the next render. */
export function setTerrainBuild(next: TerrainBuild): void {
  build = structuredClone(next)
  version++
  registerTerrainBuild(version, build)
  rebuilding = true
  rebuildStarted = performance.now()
  notify()
}

/**
 * Called by the planet once per frame with the version its tree was built from
 * and whether the worker pool has drained. The rebuild is over when the current
 * version's tree has nothing outstanding — or after `REBUILD_TIMEOUT_MS`, since a
 * ship flying fast keeps the pool busy with new splits indefinitely.
 */
export function updateRebuild(treeVersion: number, poolIdle: boolean): void {
  if (!rebuilding) return
  const settled = treeVersion === version && poolIdle
  if (!settled && performance.now() - rebuildStarted < REBUILD_TIMEOUT_MS) return
  rebuilding = false
  notify()
}

export function subscribeTerrain(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTerrainVersion(): number {
  return useSyncExternalStore(subscribeTerrain, getTerrainVersion)
}

export function useTerrainRebuilding(): boolean {
  return useSyncExternalStore(subscribeTerrain, isTerrainRebuilding)
}
