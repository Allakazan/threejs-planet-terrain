import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { HYPER_CHARGE_TIME } from '../core/constants'
import { ControlMode, HyperState, playerState } from '../player/PlayerState'

/**
 * Reticle, hyperdrive countdown and warnings.
 *
 * A cursor polled at 10 Hz would stutter, so this runs its own
 * `requestAnimationFrame` loop and writes the DOM through refs — still no React
 * state, so it never re-renders. Text is only written when it changes.
 */
export function ShipHud() {
  const root = useRef<HTMLDivElement>(null)
  const reticle = useRef<HTMLDivElement>(null)
  const status = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    let lastText = ''
    let lastDisplay = ''

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const els = { root: root.current, reticle: reticle.current, status: status.current, bar: bar.current }
      if (!els.root || !els.reticle || !els.status || !els.bar) return

      const display = playerState.mode === ControlMode.Ship ? 'block' : 'none'
      if (display !== lastDisplay) {
        els.root.style.display = display
        lastDisplay = display
      }
      if (display === 'none') return

      const radius = Math.min(window.innerWidth, window.innerHeight) * 0.22
      const { x, y } = playerState.reticle
      els.reticle.style.transform = `translate(${x * radius}px, ${y * radius}px)`

      const hyper = playerState.hyper
      let text = ''
      let progress = 0
      if (hyper.state === HyperState.Charging) {
        const left = Math.max(0, HYPER_CHARGE_TIME - hyper.charge)
        text = `HYPERDRIVE  ${Math.ceil(left)}`
        progress = hyper.charge / HYPER_CHARGE_TIME
      } else if (hyper.state === HyperState.Engaged) {
        text = 'HYPERDRIVE ENGAGED — space to drop out'
        progress = 1
      } else if (playerState.crashTimer > 0) {
        text = `HULL BREACH — ${Math.round(playerState.crashSpeed)} m/s impact — respawned`
      } else if (hyper.blocked > 0) {
        text = 'HYPERDRIVE UNAVAILABLE — path blocked by planet'
      }
      if (text !== lastText) {
        els.status.textContent = text
        lastText = text
      }
      els.bar.style.transform = `scaleX(${progress})`
    }
    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={root} style={layer}>
      <div style={centre} />
      <div style={reticleAnchor}>
        <div ref={reticle} style={reticleRing} />
      </div>
      <div style={statusBox}>
        <div ref={status} />
        <div style={barTrack}>
          <div ref={bar} style={barFill} />
        </div>
      </div>
    </div>
  )
}

const layer: CSSProperties = {
  position: 'fixed',
  inset: 0,
  pointerEvents: 'none',
  userSelect: 'none',
}

const centre: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  width: 4,
  height: 4,
  margin: '-2px 0 0 -2px',
  borderRadius: '50%',
  background: 'rgba(207, 227, 255, 0.7)',
}

const reticleAnchor: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
}

const reticleRing: CSSProperties = {
  width: 22,
  height: 22,
  margin: '-11px 0 0 -11px',
  borderRadius: '50%',
  border: '2px solid rgba(120, 200, 255, 0.85)',
  willChange: 'transform',
}

const statusBox: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: '62%',
  textAlign: 'center',
  font: '14px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace',
  letterSpacing: '0.12em',
  color: 'rgba(160, 215, 255, 0.95)',
}

const barTrack: CSSProperties = {
  width: 220,
  height: 3,
  margin: '6px auto 0',
  overflow: 'hidden',
}

const barFill: CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'rgba(120, 200, 255, 0.9)',
  transform: 'scaleX(0)',
  transformOrigin: 'left',
}
