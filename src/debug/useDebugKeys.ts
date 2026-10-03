import { useEffect } from 'react'
import { isEditableTarget } from '../core/keyboard'
import { isGridEnabled, setGridEnabled } from '../planet/chunkMaterial'
import { toggleTerrainPanel } from './debugToggles'

/**
 * Debug keybinds, in one place. Call it once, from `App` — the grid uniform is
 * global, so a second listener would just toggle it twice.
 *
 * Edge-triggered, which is why this isn't `useKeyboard` (that tracks held keys).
 */
export function useDebugKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event)) return
      if (event.code === 'KeyG') setGridEnabled(!isGridEnabled())
      if (event.code === 'KeyT') toggleTerrainPanel()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
