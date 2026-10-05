import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial } from 'three'
import type { Group, Vector3 } from 'three'
import { COLLISION_MAX_LEVEL, COLLISION_MIN_LEVEL, RENDER_ORDER_DEBUG } from '../core/constants'
import { useWorldBody } from '../core/useWorldBody'
import { collisionPatches } from '../physics/collisionPatches'
import type { CollisionTile } from '../physics/CollisionTile'
import type { PlanetConfig } from '../planet/PlanetConfig'
import { chunkIndexAttribute } from '../planet/sharedBuffers'
import { isCollisionWireEnabled } from './debugToggles'

/**
 * Wireframes for one planet's enabled collision tiles, coloured by level from red
 * (coarse) to green (finest). Debug-only, so it builds geometry freely instead of
 * pooling it.
 */
class TileWireframes {
  private readonly group: Group
  private readonly materials: MeshBasicMaterial[] = []
  /**
   * Its own attribute over the shared array: disposing a geometry drops the GL
   * buffer of every attribute it holds, and the render chunks' index must survive.
   */
  private readonly index = new BufferAttribute(chunkIndexAttribute().array, 1)
  private readonly meshes = new Map<CollisionTile, Mesh>()
  private readonly seen = new Set<CollisionTile>()

  constructor(group: Group) {
    this.group = group
    const span = Math.max(1, COLLISION_MAX_LEVEL - COLLISION_MIN_LEVEL)
    for (let level = 0; level <= COLLISION_MAX_LEVEL; level++) {
      const t = Math.min(1, Math.max(0, (level - COLLISION_MIN_LEVEL) / span))
      const color = new Color().setHSL(t / 3, 1, 0.55)
      // Over the terrain (no depth test, so coarse tiles below the visible ground
      // still show) but under the ship: no depth write, and drawn before it. See
      // `RENDER_ORDER_SHIP`. A depth-tested wire would z-fight the terrain it
      // traces, and polygonOffset is unavailable with the log depth buffer.
      this.materials.push(new MeshBasicMaterial({ color, wireframe: true, depthTest: false, depthWrite: false }))
    }
  }

  sync(centreAbs: Vector3, on: boolean): void {
    this.group.visible = on
    this.seen.clear()
    if (on) collisionPatches.forEachEnabled(centreAbs, this.add)

    for (const [tile, mesh] of this.meshes) {
      if (this.seen.has(tile)) continue
      this.group.remove(mesh)
      mesh.geometry.dispose()
      this.meshes.delete(tile)
    }
  }

  private readonly add = (tile: CollisionTile) => {
    this.seen.add(tile)
    if (this.meshes.has(tile) || tile.positions === null) return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(tile.positions, 3))
    geometry.setIndex(this.index)
    const mesh = new Mesh(geometry, this.materials[tile.level])
    mesh.position.copy(tile.chunkOrigin)
    mesh.frustumCulled = false
    mesh.renderOrder = RENDER_ORDER_DEBUG
    this.meshes.set(tile, mesh)
    this.group.add(mesh)
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.meshes.clear()
    for (const material of this.materials) material.dispose()
  }
}

type Props = {
  planet: PlanetConfig
}

/**
 * The collision tiles as wireframe, toggled with C. Its group sits at the planet
 * centre and is registered with the floating origin, like the planet's own root,
 * so tile meshes go at their planet-relative origin.
 */
export function CollisionDebug({ planet }: Props) {
  const ref = useWorldBody<Group>(planet.centreAbs)
  const wire = useRef<TileWireframes | null>(null)

  useEffect(() => {
    const group = ref.current
    if (group === null) return
    const built = new TileWireframes(group)
    wire.current = built
    return () => {
      built.dispose()
      wire.current = null
    }
  }, [ref])

  useFrame(() => {
    wire.current?.sync(planet.centreAbs, isCollisionWireEnabled())
  })

  // Group order is what three sorts on first; the mesh renderOrder alone isn't enough.
  return <group ref={ref} renderOrder={RENDER_ORDER_DEBUG} />
}
