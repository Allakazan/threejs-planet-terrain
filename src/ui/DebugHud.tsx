import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { HUD_INTERVAL_MS, MAX_LOD_LEVEL, REBASE_THRESHOLD } from '../core/constants'
import { useOrigin } from '../core/originContext'
import { isGridEnabled } from '../planet/chunkMaterial'
import { planetStats } from '../planet/planetStats'
import { ControlMode, HyperState, playerState } from '../player/PlayerState'
import { gearToLabel, gearToSpeed } from '../player/speedGears'

type Snapshot = {
  abs: [number, number, number]
  origin: [number, number, number]
  camDistance: number
  speed: number
  gear: number
  rebases: number
  bodies: number
  fps: number
  locked: boolean
  altitude: number
  leaves: number
  nodes: number
  deepest: number
  queued: number
  inFlight: number
  poolCreated: number
  poolFree: number
  buildMs: number
  grid: boolean
  mode: ControlMode
  thrust: string
  cap: number
  atmo: number
  hyper: string
  hyperCharge: number
}

function metres(v: number): string {
  const a = Math.abs(v)
  if (a < 1_000) return `${v.toFixed(1)} m`
  if (a < 1e6) return `${(v / 1e3).toFixed(2)} km`
  if (a < 1e9) return `${(v / 1e6).toFixed(3)} Mm`
  return `${(v / 1e9).toFixed(3)} Gm`
}

function vec(v: [number, number, number]): string {
  return v.map((n) => n.toExponential(3).padStart(11)).join(' ')
}

/**
 * Reads the singletons on a timer rather than per frame — a HUD that re-rendered
 * with the render loop would be the most expensive thing on screen.
 *
 * `|camera.position|` is derived as `distance(playerAbs, origin)`, which is the
 * same number the camera gets, and lets the HUD live outside the Canvas.
 */
export function DebugHud() {
  const origin = useOrigin()
  const [snap, setSnap] = useState<Snapshot | null>(null)

  useEffect(() => {
    let frames = 0
    let raf = requestAnimationFrame(function tick() {
      frames++
      raf = requestAnimationFrame(tick)
    })

    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const fps = (frames * 1000) / Math.max(1, now - last)
      frames = 0
      last = now

      const { absPosition: p, velocity, gear } = playerState
      setSnap({
        abs: [p.x, p.y, p.z],
        origin: [origin.origin.x, origin.origin.y, origin.origin.z],
        camDistance: p.distanceTo(origin.origin),
        speed: velocity.length(),
        gear,
        rebases: origin.rebaseCount,
        bodies: origin.bodyCount,
        fps,
        locked: document.pointerLockElement !== null,
        altitude: planetStats.altitude,
        leaves: planetStats.leaves,
        nodes: planetStats.nodes,
        deepest: planetStats.deepest,
        queued: planetStats.queued,
        inFlight: planetStats.inFlight,
        poolCreated: planetStats.poolCreated,
        poolFree: planetStats.poolFree,
        buildMs: planetStats.buildMs,
        grid: isGridEnabled(),
        mode: playerState.mode,
        thrust: playerState.thrust,
        cap: playerState.speedCap,
        atmo: playerState.atmo,
        hyper: playerState.hyper.state,
        hyperCharge: playerState.hyper.charge,
      })
    }, HUD_INTERVAL_MS)

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [origin])

  if (!snap) return null

  const overBudget = snap.camDistance > REBASE_THRESHOLD * 1.01
  const ship = snap.mode === ControlMode.Ship
  const controls = ship
    ? `${snap.thrust.padEnd(10)} cap ${metres(snap.cap)}/s
atmo     ${snap.atmo.toFixed(3)}
hyper    ${snap.hyper}${snap.hyper === HyperState.Charging ? `  ${snap.hyperCharge.toFixed(1)} s` : ''}`
    : `${snap.gear}  ${gearToLabel(snap.gear)}  (${metres(gearToSpeed(snap.gear))}/s)`

  return (
    <>
      <pre style={panel}>
        {`abs      ${vec(snap.abs)}
origin   ${vec(snap.origin)}
|player| ${metres(snap.camDistance)}${overBudget ? '   ⚠ over threshold' : ''}
mode     ${snap.mode}  (V)
${ship ? 'thrust' : 'gear  '}   ${controls}
speed    ${metres(snap.speed)}/s
alt      ${metres(snap.altitude)}
rebases  ${snap.rebases}   bodies ${snap.bodies}
fps      ${snap.fps.toFixed(0)}

leaves   ${snap.leaves}   nodes ${snap.nodes}
lod      ${snap.deepest} / ${MAX_LOD_LEVEL}
queue    ${snap.queued} waiting   ${snap.inFlight} building
build    ${snap.buildMs.toFixed(1)} ms/chunk
geom     ${snap.poolCreated} made   ${snap.poolFree} free
grid     ${snap.grid ? 'on' : 'off'}  (G)   terrain panel (T)`}
      </pre>
      {!snap.locked && (
        <div style={hint}>
          {ship
            ? 'click to fly — mouse steer · W impulse · Shift cruise · S brake · A/D roll · hold Space: hyperdrive · V flycam · G grid · T terrain'
            : 'click to fly — WASD · Space/Ctrl · mouse look · Q/E roll · wheel: gear · V ship · G grid'}
        </div>
      )}
    </>
  )
}

const panel: CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  margin: 0,
  padding: '10px 14px',
  font: '12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
  color: '#cfe3ff',
  background: 'rgba(8, 10, 16, 0.6)',
  border: '1px solid rgba(140, 170, 220, 0.18)',
  borderRadius: 6,
  whiteSpace: 'pre',
  pointerEvents: 'none',
  userSelect: 'none',
}

const hint: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: 0,
  right: 0,
  textAlign: 'center',
  font: '13px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
  color: 'rgba(207, 227, 255, 0.75)',
  pointerEvents: 'none',
  userSelect: 'none',
}
