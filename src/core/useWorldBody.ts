import { useEffect, useRef } from 'react'
import type { Object3D, Vector3 } from 'three'
import { useOrigin } from './originContext'

/**
 * Registers an `Object3D` at an absolute world position and returns the ref to
 * attach to it. The object's render-space position is owned by the origin store
 * from then on — do not write `position` on it yourself.
 *
 * `absPosition` is kept by identity, so pass a stable `Vector3` (`useMemo`, or a
 * module constant). Mutating it in place is fine; it is re-read on every rebase.
 */
export function useWorldBody<T extends Object3D = Object3D>(absPosition: Vector3) {
  const origin = useOrigin()
  const ref = useRef<T>(null)

  useEffect(() => {
    const object3d = ref.current
    if (!object3d) return
    return origin.register({ absPosition, object3d })
  }, [origin, absPosition])

  return ref
}
