import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Ref } from 'react'
import { MeshStandardMaterial } from 'three'
import type { Group } from 'three'
import { ControlMode, playerState } from './PlayerState'

// Module scope: one set of materials however often the ship remounts.
const hull = new MeshStandardMaterial({ color: '#b9c0cc', metalness: 0.45, roughness: 0.5, flatShading: true })
const accent = new MeshStandardMaterial({ color: '#d9772b', metalness: 0.2, roughness: 0.6, flatShading: true })
const dark = new MeshStandardMaterial({ color: '#2a2f3a', metalness: 0.6, roughness: 0.4, flatShading: true })
const glass = new MeshStandardMaterial({
  color: '#0d1a2e',
  emissive: '#3a78c8',
  emissiveIntensity: 0.25,
  metalness: 0.9,
  roughness: 0.15,
})
const glow = new MeshStandardMaterial({ color: '#000000', emissive: '#69b8ff', emissiveIntensity: 1 })

const HALF_PI = Math.PI / 2

type Props = {
  /** The Player writes this group's render-space transform every frame. */
  ref?: Ref<Group>
}

/**
 * A ~12 m ship from primitives, nose down -Z to match the flight frame.
 *
 * The outer group is the flight frame (owned by the Player); the inner pivot
 * carries the visual-only bank, so the ship tilts into turns without the camera
 * or the physics knowing.
 */
export function ShipModel({ ref }: Props) {
  const pivot = useRef<Group>(null)

  // Cosmetic, so default priority: after the Player has stepped the state.
  useFrame(() => {
    const p = pivot.current
    if (p === null) return
    p.visible = playerState.mode === ControlMode.Ship
    p.rotation.set(0, 0, playerState.bank)
    glow.emissiveIntensity = 0.6 + playerState.throttle * 5
  })

  return (
    <group ref={ref}>
      <group ref={pivot}>
        {/* fuselage + nose */}
        <mesh material={hull} rotation-x={HALF_PI}>
          <cylinderGeometry args={[0.9, 1.1, 8, 12]} />
        </mesh>
        <mesh material={hull} position-z={-5.5} rotation-x={-HALF_PI}>
          <coneGeometry args={[0.9, 3, 12]} />
        </mesh>
        <mesh material={glass} position={[0, 0.75, -2.4]} scale={[0.75, 0.55, 1.6]}>
          <sphereGeometry args={[1, 16, 10]} />
        </mesh>

        {/* wings, with a little dihedral */}
        <mesh material={accent} position={[3.2, 0, 0.8]} rotation-z={0.08}>
          <boxGeometry args={[5, 0.2, 2.6]} />
        </mesh>
        <mesh material={accent} position={[-3.2, 0, 0.8]} rotation-z={-0.08}>
          <boxGeometry args={[5, 0.2, 2.6]} />
        </mesh>
        <mesh material={dark} position={[5.7, 0.6, 1.1]}>
          <boxGeometry args={[0.15, 1.2, 1.8]} />
        </mesh>
        <mesh material={dark} position={[-5.7, 0.6, 1.1]}>
          <boxGeometry args={[0.15, 1.2, 1.8]} />
        </mesh>

        {/* tail fin */}
        <mesh material={accent} position={[0, 1.6, 3]}>
          <boxGeometry args={[0.15, 2.2, 2]} />
        </mesh>

        {/* engines and their glow */}
        <mesh material={dark} position={[1.4, -0.2, 3.5]} rotation-x={HALF_PI}>
          <cylinderGeometry args={[0.5, 0.6, 3, 10]} />
        </mesh>
        <mesh material={dark} position={[-1.4, -0.2, 3.5]} rotation-x={HALF_PI}>
          <cylinderGeometry args={[0.5, 0.6, 3, 10]} />
        </mesh>
        <mesh material={glow} position={[1.4, -0.2, 5.02]}>
          <circleGeometry args={[0.5, 16]} />
        </mesh>
        <mesh material={glow} position={[-1.4, -0.2, 5.02]}>
          <circleGeometry args={[0.5, 16]} />
        </mesh>
      </group>
    </group>
  )
}
