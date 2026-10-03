import { useMemo } from 'react'
import { Vector3 } from 'three'
import type { Mesh } from 'three'
import { useWorldBody } from '../core/useWorldBody'

/** 10¹ … 10⁸ metres along +X — a decade ladder to fly down. */
const DECADES = [1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8]

/** Each marker subtends the same angle (~2.3°) however far out it sits. */
const ANGULAR_SIZE = 0.02

function Marker({ distance, hue }: { distance: number; hue: number }) {
  const absPosition = useMemo(() => new Vector3(distance, 0, 0), [distance])
  const ref = useWorldBody<Mesh>(absPosition)
  const color = `hsl(${hue}, 85%, 60%)`

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[distance * ANGULAR_SIZE, 24, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} toneMapped={false} />
    </mesh>
  )
}

/**
 * Throwaway scaffolding for verifying the floating origin before a planet
 * exists. Every marker is a registered `WorldBody`, so a rebase must leave all
 * of them visually frozen — any pop is a bug. Delete once Plan 2 lands.
 */
export function MarkerRig() {
  return (
    <>
      {DECADES.map((distance, i) => (
        <Marker key={distance} distance={distance} hue={(i * 360) / DECADES.length} />
      ))}
    </>
  )
}
