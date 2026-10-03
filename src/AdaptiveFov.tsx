import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'

const DEG = Math.PI / 180

type Props = {
  /** vertical fov you authored the scene at */
  fov?: number
  /** aspect ratio you authored it at; narrower viewports widen the fov */
  designAspect?: number
}

/**
 * Fiber already keeps `camera.aspect` in sync on resize, but three's `fov` is
 * vertical — so a portrait phone keeps the same vertical framing and crops the
 * sides off. This widens the fov below `designAspect` so the horizontal extent
 * visible at the design aspect stays visible, and leaves wider viewports alone.
 */
export function AdaptiveFov({ fov = 50, designAspect = 16 / 9 }: Props) {
  const camera = useThree((s) => s.camera)
  const { width, height } = useThree((s) => s.size)

  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return

    const aspect = width / height
    /* three's camera is an external mutable object, and writing `fov` on it is the
       entire job of this component — which `react-hooks/immutability` can't know. */
    /* eslint-disable react-hooks/immutability */
    if (aspect >= designAspect) {
      camera.fov = fov
    } else {
      const halfH = Math.tan(fov * DEG * 0.5) * designAspect
      camera.fov = (2 * Math.atan(halfH / aspect)) / DEG
    }
    /* eslint-enable react-hooks/immutability */
    camera.updateProjectionMatrix()
  }, [camera, width, height, fov, designAspect])

  return null
}
