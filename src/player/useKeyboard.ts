import { useEffect, useRef } from 'react'
import { isEditableTarget } from '../core/keyboard'

/**
 * Held `KeyboardEvent.code`s in a ref — a listener, not state, so holding W does
 * not re-render anything. Codes (not `key`) so the bindings are layout-stable
 * and unaffected by modifiers.
 */
export function useKeyboard() {
  const held = useRef<Set<string>>(new Set())

  useEffect(() => {
    const keys = held.current

    const down = (e: KeyboardEvent) => {
      if (e.repeat || isEditableTarget(e)) return
      keys.add(e.code)
    }
    const up = (e: KeyboardEvent) => keys.delete(e.code)
    // A key released while the window is unfocused never fires keyup, which
    // would leave the player thrusting forever.
    const clear = () => keys.clear()

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      keys.clear()
    }
  }, [])

  return held
}
