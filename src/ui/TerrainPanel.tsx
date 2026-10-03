import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { MAX_OCTAVES } from '../core/constants'
import { useTerrainPanelOpen } from '../debug/debugToggles'
import { TERRAIN_PRESETS } from '../planet/terrain/presets'
import { getTerrainSpec, setTerrainSpec, useTerrainVersion } from '../planet/terrain/terrainStore'
import { NOISE_BASES, NoiseBasis, maxElevation } from '../planet/terrain/terrainSpec'
import type { LayerMask, NoiseBasis as Basis, TerrainLayer, TerrainSpec } from '../planet/terrain/terrainSpec'

const KM = 1000

/**
 * Live editor for the terrain layer stack (T). Edits go to a local draft; Apply
 * publishes it as a new terrain version, which rebuilds the whole planet — so it
 * is an explicit button, not on every keystroke.
 *
 * The draft is React state, which is fine here: it is form state that changes on
 * clicks, not per-frame state.
 */
export function TerrainPanel() {
  const open = useTerrainPanelOpen()
  const version = useTerrainVersion()
  const [draft, setDraft] = useState<TerrainSpec>(() => structuredClone(getTerrainSpec()))
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')

  // The panel is useless under pointer lock, so opening it hands the mouse back.
  useEffect(() => {
    if (open && document.pointerLockElement !== null) document.exitPointerLock()
  }, [open])

  if (!open) return null

  const edit = (next: TerrainSpec) => {
    setDraft(next)
    setDirty(true)
  }

  const updateLayer = (index: number, patch: Partial<TerrainLayer>) => {
    edit({ ...draft, layers: draft.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)) })
  }

  const apply = () => {
    setTerrainSpec(draft)
    setDirty(false)
    setNote('')
  }

  const loadPreset = (key: string) => {
    const preset = TERRAIN_PRESETS[key]
    if (preset === undefined) return
    edit(structuredClone(preset))
  }

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(draft, null, 2)).then(
      () => setNote('copied'),
      () => setNote('clipboard blocked'),
    )
  }

  const pasteJson = () => {
    const text = window.prompt('Paste a terrain spec (JSON):')
    if (text === null) return
    try {
      const parsed = JSON.parse(text) as TerrainSpec
      if (!Array.isArray(parsed.layers)) throw new Error('no layers')
      edit(parsed)
      setNote('loaded')
    } catch {
      setNote('invalid JSON')
    }
  }

  return (
    <div style={panel}>
      <div style={row}>
        <strong>terrain</strong>
        <span style={dim}>
          v{version}
          {dirty ? ' · unapplied' : ''} · ±{(maxElevation(draft) / KM).toFixed(1)} km max
        </span>
        <span style={{ flex: 1 }} />
        <span style={dim}>T to close</span>
      </div>

      <div style={row}>
        <select style={input} value="" onChange={(e) => loadPreset(e.target.value)}>
          <option value="" disabled>
            load preset…
          </option>
          {Object.keys(TERRAIN_PRESETS).map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
        <button style={button} onClick={copyJson}>
          copy JSON
        </button>
        <button style={button} onClick={pasteJson}>
          paste JSON
        </button>
        <span style={dim}>{note}</span>
      </div>

      {draft.layers.map((layer, index) => (
        <LayerCard
          key={index}
          layer={layer}
          index={index}
          count={draft.layers.length}
          earlier={draft.layers.slice(0, index).map((l) => l.name)}
          onChange={(patch) => updateLayer(index, patch)}
          onMove={(delta) => edit(moveLayer(draft, index, delta))}
          onRemove={() => edit(removeLayer(draft, index))}
        />
      ))}

      <div style={{ ...row, position: 'sticky', bottom: 0, background: 'rgba(8, 10, 16, 0.95)', paddingTop: 8 }}>
        <button style={button} onClick={() => edit({ ...draft, layers: [...draft.layers, newLayer(draft)] })}>
          + layer
        </button>
        <button
          style={button}
          onClick={() => {
            setDraft(structuredClone(getTerrainSpec()))
            setDirty(false)
          }}
        >
          revert
        </button>
        <span style={{ flex: 1 }} />
        <button style={{ ...button, ...(dirty ? applyHot : null) }} onClick={apply}>
          apply
        </button>
      </div>
    </div>
  )
}

type LayerCardProps = {
  layer: TerrainLayer
  index: number
  count: number
  /** Names of the layers this one may mask on. */
  earlier: string[]
  onChange: (patch: Partial<TerrainLayer>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}

function LayerCard({ layer, index, count, earlier, onChange, onMove, onRemove }: LayerCardProps) {
  const constant = layer.basis === NoiseBasis.Constant
  const setMask = (m: number, patch: Partial<LayerMask>) =>
    onChange({ masks: layer.masks.map((mask, i) => (i === m ? { ...mask, ...patch } : mask)) })

  return (
    <div style={{ ...card, opacity: layer.enabled ? 1 : 0.5 }}>
      <div style={row}>
        <input type="checkbox" checked={layer.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
        <span style={dim}>{index}</span>
        <input style={{ ...input, flex: 1 }} value={layer.name} onChange={(e) => onChange({ name: e.target.value })} />
        <select style={input} value={layer.basis} onChange={(e) => onChange({ basis: e.target.value as Basis })}>
          {NOISE_BASES.map((basis) => (
            <option key={basis} value={basis}>
              {basis}
            </option>
          ))}
        </select>
        <button style={small} disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button style={small} disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓
        </button>
        <button style={small} onClick={onRemove}>
          ✕
        </button>
      </div>

      <div style={grid}>
        <Field label="amp m">
          <NumberInput value={layer.amplitude} onCommit={(amplitude) => onChange({ amplitude })} />
        </Field>
        {!constant && (
          <>
            <Field label="λ km">
              <NumberInput value={layer.wavelength / KM} min={0.001} onCommit={(v) => onChange({ wavelength: v * KM })} />
            </Field>
            <Field label="octaves">
              <NumberInput value={layer.octaves} min={1} max={MAX_OCTAVES} integer onCommit={(octaves) => onChange({ octaves })} />
            </Field>
            <Field label="lacun.">
              <NumberInput value={layer.lacunarity} min={1.05} max={4} onCommit={(lacunarity) => onChange({ lacunarity })} />
            </Field>
            <Field label="gain">
              <NumberInput value={layer.gain} min={0} max={0.95} onCommit={(gain) => onChange({ gain })} />
            </Field>
            <Field label="seed">
              <NumberInput value={layer.seedOffset} integer onCommit={(seedOffset) => onChange({ seedOffset })} />
            </Field>
          </>
        )}
      </div>

      {!constant && (
        <div style={row}>
          <label style={dim}>
            <input
              type="checkbox"
              checked={layer.warp !== null}
              onChange={(e) =>
                onChange({ warp: e.target.checked ? { wavelength: layer.wavelength * 1.5, strength: layer.wavelength * 0.25 } : null })
              }
            />{' '}
            warp
          </label>
          {layer.warp !== null && (
            <>
              <Field label="λ km">
                <NumberInput
                  value={layer.warp.wavelength / KM}
                  min={0.001}
                  onCommit={(v) => onChange({ warp: { ...layer.warp!, wavelength: v * KM } })}
                />
              </Field>
              <Field label="str km">
                <NumberInput value={layer.warp.strength / KM} onCommit={(v) => onChange({ warp: { ...layer.warp!, strength: v * KM } })} />
              </Field>
            </>
          )}
        </div>
      )}

      {layer.masks.map((mask, m) => (
        <div key={m} style={row}>
          <span style={dim}>mask</span>
          <select style={input} value={mask.layer} onChange={(e) => setMask(m, { layer: Number(e.target.value) })}>
            {earlier.map((name, i) => (
              <option key={i} value={i}>
                {i} {name}
              </option>
            ))}
          </select>
          <Field label="lo">
            <NumberInput value={mask.lo} onCommit={(lo) => setMask(m, { lo })} />
          </Field>
          <Field label="hi">
            <NumberInput value={mask.hi} onCommit={(hi) => setMask(m, { hi })} />
          </Field>
          <button style={small} onClick={() => onChange({ masks: layer.masks.filter((_, i) => i !== m) })}>
            ✕
          </button>
        </div>
      ))}
      {earlier.length > 0 && (
        <button style={{ ...small, alignSelf: 'flex-start' }} onClick={() => onChange({ masks: [...layer.masks, { layer: 0, lo: 0, hi: 0.2 }] })}>
          + mask
        </button>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={field}>
      <span style={dim}>{label}</span>
      {children}
    </label>
  )
}

type NumberInputProps = {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  integer?: boolean
}

/**
 * Text while typing, a number on blur or Enter — so intermediate states like "-"
 * or "0." don't get clamped out from under the cursor.
 */
function NumberInput({ value, onCommit, min, max, integer }: NumberInputProps) {
  const [text, setText] = useState<string | null>(null)

  const commit = () => {
    if (text === null) return
    let v = Number(text)
    setText(null)
    if (!Number.isFinite(v)) return
    if (integer) v = Math.round(v)
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (v !== value) onCommit(v)
  }

  return (
    <input
      style={{ ...input, width: 64 }}
      value={text ?? String(Number(value.toPrecision(6)))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

// --- layer list edits; mask indices are renumbered so they keep their targets ---

function newLayer(spec: TerrainSpec): TerrainLayer {
  const seedOffset = spec.layers.reduce((max, layer) => Math.max(max, layer.seedOffset), 0) + 1
  return {
    name: `layer ${spec.layers.length}`,
    enabled: true,
    basis: NoiseBasis.Simplex,
    wavelength: 10 * KM,
    amplitude: 200,
    octaves: 4,
    lacunarity: 2.2,
    gain: 0.5,
    seedOffset,
    masks: [],
    warp: null,
  }
}

function removeLayer(spec: TerrainSpec, index: number): TerrainSpec {
  return {
    ...spec,
    layers: spec.layers
      .filter((_, i) => i !== index)
      .map((layer) => ({
        ...layer,
        masks: layer.masks
          .filter((mask) => mask.layer !== index)
          .map((mask) => (mask.layer > index ? { ...mask, layer: mask.layer - 1 } : mask)),
      })),
  }
}

/** Swaps with a neighbour. A mask left pointing forward is dropped, as the terrain would ignore it anyway. */
function moveLayer(spec: TerrainSpec, index: number, delta: -1 | 1): TerrainSpec {
  const other = index + delta
  if (other < 0 || other >= spec.layers.length) return spec
  const swap = (i: number) => (i === index ? other : i === other ? index : i)
  const layers = spec.layers.map((_, i) => spec.layers[swap(i)])
  return {
    ...spec,
    layers: layers.map((layer, position) => ({
      ...layer,
      masks: layer.masks.map((mask) => ({ ...mask, layer: swap(mask.layer) })).filter((mask) => mask.layer < position),
    })),
  }
}

// --- styles, matching DebugHud ---

const font = '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace'

const panel: CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  bottom: 12,
  width: 470,
  overflowY: 'auto',
  padding: '10px 12px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  font,
  color: '#cfe3ff',
  background: 'rgba(8, 10, 16, 0.82)',
  border: '1px solid rgba(140, 170, 220, 0.18)',
  borderRadius: 6,
}

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  border: '1px solid rgba(140, 170, 220, 0.14)',
  borderRadius: 4,
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingBottom: 4 }
const grid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 }
const field: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 }
const dim: CSSProperties = { color: 'rgba(207, 227, 255, 0.6)' }

const input: CSSProperties = {
  font,
  color: '#e6f0ff',
  background: 'rgba(20, 26, 40, 0.9)',
  border: '1px solid rgba(140, 170, 220, 0.25)',
  borderRadius: 3,
  padding: '2px 4px',
}

const button: CSSProperties = { ...input, cursor: 'pointer', padding: '3px 8px' }
const small: CSSProperties = { ...input, cursor: 'pointer', padding: '1px 6px' }
const applyHot: CSSProperties = { background: '#2d5a9e', borderColor: '#6fa0ef' }
