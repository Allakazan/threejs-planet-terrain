import { useEffect, useMemo } from 'react'
import { SphereGeometry } from 'three'
import { ATMOSPHERE_HEIGHT } from '../../core/constants'
import { skyMaterial } from './skyMaterial'

type Props = {
  radius: number
}

/**
 * The atmosphere's outer shell, `radius + ATMOSPHERE_HEIGHT`. Mount it inside the
 * planet's root group: it is centred there, and rebases with it for free.
 *
 * 128×64 segments sag at most ~1.2 km inside the true sphere — irrelevant, since
 * the shader intersects the real one.
 */
export function SkyShell({ radius }: Props) {
  const geometry = useMemo(() => new SphereGeometry(radius + ATMOSPHERE_HEIGHT, 128, 64), [radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} material={skyMaterial} />
}
