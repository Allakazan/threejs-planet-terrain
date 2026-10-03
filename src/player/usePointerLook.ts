import { useCallback, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { clampGear } from './speedGears'
import { ControlMode } from './PlayerState'
import type { PlayerState } from './PlayerState'

/** Mouse movement accumulated since the last frame consumed it, in pixels. */
export type LookDelta = { x: number; y: number }

/**
 * Pointer lock on canvas click, mouse deltas, and (flycam only) wheel notches
 * into `player.gear`. All listeners, no state: nothing here can trigger a render.
 *
 * Returns a `drain(out)` rather than the accumulator itself. The accumulator has
 * to be zeroed once per frame, and `react-hooks/immutability` (rightly) forbids
 * the caller mutating a hook's return value — so the reset lives in here, where
 * the ref is constructed.
 */
export function usePointerLook(player: PlayerState) {
  const canvas = useThree((s) => s.gl.domElement)
  const look = useRef<LookDelta>({ x: 0, y: 0 })

  useEffect(() => {
    const requestLock = () => {
      if (document.pointerLockElement === canvas) return
      // Rejects if called too soon after an unlock (browsers rate-limit it) and
      // can throw synchronously in older ones; neither is worth reporting.
      try {
        void Promise.resolve(canvas.requestPointerLock()).catch(() => {})
      } catch {
        /* ignored */
      }
    }

    const move = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      look.current.x += e.movementX
      look.current.y += e.movementY
    }

    const wheel = (e: WheelEvent) => {
      // Without this, ctrl+wheel zooms the page and trackpads scroll it.
      e.preventDefault()
      // Gears belong to the debug flycam; the ship has thrust modes instead.
      if (e.deltaY === 0 || player.mode !== ControlMode.Flycam) return
      player.gear = clampGear(player.gear + (e.deltaY < 0 ? 1 : -1))
    }

    // Deltas that arrived during the unlock gesture would snap the view on relock.
    const lockChange = () => {
      if (document.pointerLockElement !== canvas) {
        look.current.x = 0
        look.current.y = 0
      }
    }

    canvas.addEventListener('click', requestLock)
    document.addEventListener('mousemove', move)
    canvas.addEventListener('wheel', wheel, { passive: false })
    document.addEventListener('pointerlockchange', lockChange)
    return () => {
      canvas.removeEventListener('click', requestLock)
      document.removeEventListener('mousemove', move)
      canvas.removeEventListener('wheel', wheel)
      document.removeEventListener('pointerlockchange', lockChange)
    }
  }, [canvas, player])

  /** Moves the pending delta into `out` and resets the accumulator. */
  return useCallback((out: LookDelta) => {
    out.x = look.current.x
    out.y = look.current.y
    look.current.x = 0
    look.current.y = 0
  }, [])
}
