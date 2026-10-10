import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { AmbientLight, DirectionalLight } from 'three'
import { sunLight } from './atmosphereStore'

/**
 * The fill light and the one hard sun, driven by the atmosphere settings. A
 * directional light's direction comes from its position, which is
 * origin-independent, so this stays right however far the player rebases. The
 * scattering reads the same direction.
 */
export function SunLights() {
  const sun = useRef<DirectionalLight>(null)
  const fill = useRef<AmbientLight>(null)

  useFrame(() => {
    if (sun.current !== null) {
      sun.current.position.copy(sunLight.direction)
      sun.current.intensity = sunLight.intensity
    }
    if (fill.current !== null) fill.current.intensity = sunLight.ambient
  })

  return (
    <>
      <ambientLight ref={fill} intensity={sunLight.ambient} />
      <directionalLight ref={sun} position={sunLight.direction} intensity={sunLight.intensity} />
    </>
  )
}
