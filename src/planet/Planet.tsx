import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { PRIORITY_PLANET } from '../core/constants'
import { useWorldBody } from '../core/useWorldBody'
import { playerState } from '../player/PlayerState'
import { chunkMaterial } from './chunkMaterial'
import { chunkWorkerPool } from './ChunkWorkerPool'
import type { PlanetConfig } from './PlanetConfig'
import { planetStats } from './planetStats'
import { PlanetTree } from './PlanetTree'
import { geometryPoolStats } from './sharedBuffers'

type Props = {
  /** Must be referentially stable — see `planetConfig`. */
  config: PlanetConfig
}

/**
 * A planet: one render-space root registered with the floating origin, and the
 * quadtree hanging off it.
 *
 * The root is the *only* registered `WorldBody`. Chunks are its children and are
 * never touched by a rebase, which is what keeps the rebase O(bodies) instead of
 * O(chunks).
 *
 * Runs at priority -10, after the Player at -20, so the split test sees this
 * frame's position and this frame's post-rebase origin.
 */
export function Planet({ config }: Props) {
  const ref = useWorldBody<Group>(config.centreAbs)
  const tree = useRef<PlanetTree | null>(null)

  useEffect(() => {
    const group = ref.current
    if (group === null) return

    const built = new PlanetTree(config, group, chunkWorkerPool, chunkMaterial)
    tree.current = built
    return () => {
      // StrictMode runs this immediately in dev. Everything the tree took —
      // in-flight requests, pooled geometries, scene children — comes back here.
      built.dispose()
      tree.current = null
    }
  }, [config, ref])

  useFrame(() => {
    const current = tree.current
    if (current === null) return

    const playerAbs = playerState.absPosition
    current.update(playerAbs)

    const pool = geometryPoolStats()
    planetStats.leaves = current.leaves
    planetStats.nodes = current.nodes
    planetStats.deepest = current.deepest
    planetStats.queued = chunkWorkerPool.queued
    planetStats.inFlight = chunkWorkerPool.inFlightCount
    planetStats.poolCreated = pool.created
    planetStats.poolFree = pool.free
    planetStats.buildMs = chunkWorkerPool.buildMs
    planetStats.altitude = playerAbs.distanceTo(config.centreAbs) - config.radius
  }, PRIORITY_PLANET)

  return <group ref={ref} />
}
