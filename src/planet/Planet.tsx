import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import type { Group } from 'three'
import { PRIORITY_PLANET } from '../core/constants'
import { useOrigin } from '../core/originContext'
import { useWorldBody } from '../core/useWorldBody'
import { playerState } from '../player/PlayerState'
import { updateAtmosphereFrame } from './atmosphere/atmosphereUniforms'
import { SkyShell } from './atmosphere/SkyShell'
import { chunkMaterial } from './chunkMaterial'
import { chunkWorkerPool } from './ChunkWorkerPool'
import type { PlanetConfig } from './PlanetConfig'
import { planetStats } from './planetStats'
import { PlanetTree } from './PlanetTree'
import { farMaterialStats } from './shading/farMaterialPool'
// Side effect: puts the default material live, which starts loading its texture packs.
import './shading/materialStore'
import { updateShadingFrame } from './shading/shadingUniforms'
import { geometryPoolStats } from './sharedBuffers'
import { updateRebuild } from './terrain/terrainStore'

const cameraAbs = new Vector3()

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
  const origin = useOrigin()
  const camera = useThree((s) => s.camera)
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
    const group = ref.current
    if (current === null || group === null) return

    // The terrain materials are shared module singletons, so with a second planet
    // the last one to run wins. They need a uniform set per planet by then.
    updateShadingFrame(group.position, origin.origin, config.centreAbs, config.radius)
    // The camera was placed by the Player this frame, after its rebase.
    updateAtmosphereFrame(origin.toAbsolute(camera.position, cameraAbs), config.centreAbs, config.radius)

    const playerAbs = playerState.absPosition
    current.update(playerAbs)
    // After the pump, so a tree whose last chunk just uploaded counts as settled.
    // The tree's own version, not `config`'s: between a re-render and its effect
    // this callback can already see the new config while the old tree still runs.
    updateRebuild(current.terrainVersion, chunkWorkerPool.drained)

    const pool = geometryPoolStats()
    const far = farMaterialStats()
    planetStats.leaves = current.leaves
    planetStats.farLeaves = current.farLeaves
    planetStats.nodes = current.nodes
    planetStats.deepest = current.deepest
    planetStats.queued = chunkWorkerPool.queued
    planetStats.inFlight = chunkWorkerPool.inFlightCount
    planetStats.poolCreated = pool.created
    planetStats.poolFree = pool.free
    planetStats.buildMs = chunkWorkerPool.buildMs
    planetStats.bakeMs = chunkWorkerPool.bakeMs
    planetStats.farCreated = far.created
    planetStats.farFree = far.free
    planetStats.altitude = playerAbs.distanceTo(config.centreAbs) - config.radius
  }, PRIORITY_PLANET)

  return (
    <group ref={ref}>
      <SkyShell radius={config.radius} />
    </group>
  )
}
