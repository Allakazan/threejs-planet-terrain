import { useSyncExternalStore } from 'react'

/**
 * Debug UI visibility that a keybind flips and a component reads. A tiny external
 * store, so `useDebugKeys` can stay the single place keys are bound.
 */
let terrainPanelOpen = false
const listeners = new Set<() => void>()

export function toggleTerrainPanel(): void {
  terrainPanelOpen = !terrainPanelOpen
  for (const listener of listeners) listener()
}

/** Collision tile wireframe. Read per frame by `CollisionDebug`, so no React store. */
let collisionWire = false

export function toggleCollisionWire(): void {
  collisionWire = !collisionWire
}

export function isCollisionWireEnabled(): boolean {
  return collisionWire
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTerrainPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, () => terrainPanelOpen)
}
