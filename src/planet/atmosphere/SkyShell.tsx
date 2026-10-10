import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { SphereGeometry } from 'three'
import type { Mesh } from 'three'
import { atmosphereState } from './atmosphereSettings'
import { skyMaterial } from './skyMaterial'

type Props = {
  radius: number
}

/**
 * The atmosphere's outer shell, `radius + atmosphereState.height`. Mount it inside
 * the planet's root group: it is centred there, and rebases with it for free.
 *
 * A unit sphere scaled every frame, so the live-tunable height costs nothing. 128×64
 * segments sag at most ~1.2 km inside the true sphere — irrelevant, since the
 * shader intersects the real one.
 */
export function SkyShell({ radius }: Props) {
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => new SphereGeometry(1, 128, 64), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    mesh.current?.scale.setScalar(radius + atmosphereState.height)
  })

  return <mesh ref={mesh} geometry={geometry} material={skyMaterial} scale={radius + atmosphereState.height} />
}
