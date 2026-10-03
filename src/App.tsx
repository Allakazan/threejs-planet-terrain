import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { Vector3 } from 'three'
import { AdaptiveFov } from './AdaptiveFov'
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR } from './core/constants'
import { OriginContext, floatingOrigin } from './core/originContext'
import { useDebugKeys } from './debug/useDebugKeys'
import { Planet } from './planet/Planet'
import { planetConfig } from './planet/PlanetConfig'
import { useTerrainVersion } from './planet/terrain/terrainStore'
import { Player } from './player/Player'
import { DebugHud } from './ui/DebugHud'
import { ShipHud } from './ui/ShipHud'
import { TerrainPanel } from './ui/TerrainPanel'

/**
 * Module scope: the floating origin holds the planet centre by identity, so it
 * must outlive every config rebuilt for a new terrain version.
 */
const MOON_CENTRE = new Vector3(0, 0, 0)

function App() {
  useDebugKeys()

  // `Planet` keys its quadtree on the config's identity, so a new terrain version
  // tears the tree down and rebuilds it — and nothing else does.
  const terrainVersion = useTerrainVersion()
  const moon = useMemo(() => planetConfig({ centreAbs: MOON_CENTRE, terrainVersion }), [terrainVersion])

  return (
    // One provider outside the Canvas: R3F bridges context into the scene tree,
    // so the Player and the HUD share the same origin store.
    <OriginContext value={floatingOrigin}>
      <Canvas
        // near/far span 10⁹, far beyond a 24-bit depth buffer. logarithmicDepthBuffer
        // trades some fill rate (and polygonOffset, see docs/02) for no z-fighting.
        gl={{ logarithmicDepthBuffer: true }}
        camera={{ fov: CAMERA_FOV, near: CAMERA_NEAR, far: CAMERA_FAR }}
        dpr={[1, 2]}
      >
        <AdaptiveFov fov={CAMERA_FOV} />
        {/* Airless body: almost no fill light, one hard sun. A directional light's
            direction comes from its position, which is origin-independent, so this
            stays fixed however far the player rebases. */}
        <ambientLight intensity={0.12} />
        <directionalLight position={[0.55, 0.4, 1]} intensity={2.6} />
        <Player planet={moon} />
        <Planet config={moon} />
      </Canvas>
      <ShipHud />
      <DebugHud />
      <TerrainPanel />
    </OriginContext>
  )
}

export default App
