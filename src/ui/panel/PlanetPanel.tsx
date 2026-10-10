import { useEffect } from 'react'
import { Leva } from 'leva'
import { useTerrainPanelOpen } from '../../debug/debugToggles'
import { usePlanetControls } from './usePlanetControls'

/**
 * The planet panel (T): leva, with the controls from `usePlanetControls`. Always
 * mounted, so the controls and their stores stay registered while it's hidden.
 */
export function PlanetPanel() {
  const open = useTerrainPanelOpen()
  usePlanetControls()

  // The panel is useless under pointer lock, so opening it hands the mouse back.
  useEffect(() => {
    if (open && document.pointerLockElement !== null) document.exitPointerLock()
  }, [open])

  return (
    <Leva
      hidden={!open}
      titleBar={{ title: 'planet · T to close', filter: false }}
      theme={{ sizes: { rootWidth: '440px', controlWidth: '250px' } }}
    />
  )
}
