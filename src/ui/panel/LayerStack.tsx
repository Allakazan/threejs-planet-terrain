import { useState } from 'react'
import type { DragEvent } from 'react'
import { styled, useInputContext } from 'leva/plugin'
import type { LevaInputProps } from 'leva/plugin'
import { MAX_OCTAVES } from '../../core/constants'
import { NOISE_BASES, NoiseBasis } from '../../planet/terrain/terrainSpec'
import type { LayerMask, NoiseBasis as Basis, TerrainLayer } from '../../planet/terrain/terrainSpec'
import { moveLayer, newLayer, removeLayer } from './layerEdits'

const KM = 1000

/**
 * The geometry folder's layer stack, as a leva plugin component (see
 * `layerStackPlugin`). One card per layer; drag a card by its handle (⠿) to reorder.
 * Every edit commits a whole new layer array through `onUpdate` — sliders on
 * release, text on blur or Enter — and the panel debounces those into a rebuild.
 *
 * While the planet rebuilds, leva disables the input, which greys this out and
 * blocks pointer events on all of it.
 */
export function LayerStack() {
  const { value: layers, onUpdate } = useInputContext<LevaInputProps<TerrainLayer[]>>()
  /** Card whose handle is held: only that card is `draggable`, so its sliders still slide. */
  const [armed, setArmed] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  /** Insertion gap, 0..n: the dragged card lands before the card at this index. */
  const [gap, setGap] = useState<number | null>(null)

  const update = (index: number, patch: Partial<TerrainLayer>) =>
    onUpdate(layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)))

  const endDrag = () => {
    setArmed(null)
    setDragFrom(null)
    setGap(null)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (dragFrom === null) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setGap(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (dragFrom !== null && gap !== null) {
      const to = gap > dragFrom ? gap - 1 : gap
      if (to !== dragFrom) onUpdate(moveLayer(layers, dragFrom, to))
    }
    endDrag()
  }

  /** A gap right next to the dragged card would put it back where it is: no marker there. */
  const showGap = (at: number) => gap === at && dragFrom !== null && at !== dragFrom && at !== dragFrom + 1

  return (
    <Stack onDrop={onDrop} onDragOver={(event) => dragFrom !== null && event.preventDefault()}>
      {layers.map((layer, index) => (
        <div key={index}>
          {showGap(index) && <Marker />}
          <LayerCard
            layer={layer}
            index={index}
            earlier={layers.slice(0, index).map((l) => l.name)}
            draggable={armed === index}
            dragging={dragFrom === index}
            onArm={(on) => setArmed(on ? index : null)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              // Firefox starts no drag without data.
              event.dataTransfer.setData('text/plain', String(index))
              setDragFrom(index)
            }}
            onDragOver={(event) => onDragOver(event, index)}
            onDragEnd={endDrag}
            onChange={(patch) => update(index, patch)}
            onRemove={() => onUpdate(removeLayer(layers, index))}
          />
        </div>
      ))}
      {showGap(layers.length) && <Marker />}
      <Row>
        <SmallButton onClick={() => onUpdate([...layers, newLayer(layers)])}>+ layer</SmallButton>
      </Row>
    </Stack>
  )
}

type LayerCardProps = {
  layer: TerrainLayer
  index: number
  /** Names of the layers this one may mask on. */
  earlier: string[]
  draggable: boolean
  dragging: boolean
  onArm: (on: boolean) => void
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onChange: (patch: Partial<TerrainLayer>) => void
  onRemove: () => void
}

function LayerCard(props: LayerCardProps) {
  const { layer, index, earlier, onChange } = props
  const constant = layer.basis === NoiseBasis.Constant
  const setMask = (m: number, patch: Partial<LayerMask>) =>
    onChange({ masks: layer.masks.map((mask, i) => (i === m ? { ...mask, ...patch } : mask)) })

  return (
    <Card
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDragEnd={props.onDragEnd}
      style={{ opacity: props.dragging ? 0.4 : layer.enabled ? 1 : 0.55 }}
    >
      <Header>
        <Handle
          title="drag to reorder"
          onPointerDown={() => props.onArm(true)}
          onPointerUp={() => props.onArm(false)}
        >
          ⠿
        </Handle>
        <input
          type="checkbox"
          title="enabled"
          checked={layer.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <Dim>{index}</Dim>
        <TextInput value={layer.name} onCommit={(name) => onChange({ name })} />
        <SelectBox value={layer.basis} onChange={(e) => onChange({ basis: e.target.value as Basis })}>
          {NOISE_BASES.map((basis) => (
            <option key={basis} value={basis}>
              {basis}
            </option>
          ))}
        </SelectBox>
        <SmallButton title="remove layer" onClick={props.onRemove}>
          ✕
        </SmallButton>
      </Header>

      <SliderField label="amp m" value={layer.amplitude} min={-15000} max={15000} step={1} onCommit={(amplitude) => onChange({ amplitude })} />
      {!constant && (
        <>
          <SliderField
            label="λ km"
            value={layer.wavelength}
            scale={KM}
            min={0.01}
            max={5000}
            log
            hardMin={0.001}
            onCommit={(wavelength) => onChange({ wavelength })}
          />
          <SliderField label="octaves" value={layer.octaves} min={1} max={MAX_OCTAVES} step={1} integer hardMin={1} hardMax={MAX_OCTAVES} onCommit={(octaves) => onChange({ octaves })} />
          <SliderField label="lacunarity" value={layer.lacunarity} min={1.05} max={4} hardMin={1.05} hardMax={4} onCommit={(lacunarity) => onChange({ lacunarity })} />
          <SliderField label="gain" value={layer.gain} min={0} max={0.95} hardMin={0} hardMax={0.95} onCommit={(gain) => onChange({ gain })} />
          <SliderField label="seed" value={layer.seedOffset} min={0} max={200} step={1} integer onCommit={(seedOffset) => onChange({ seedOffset })} />

          <Row>
            <label>
              <input
                type="checkbox"
                checked={layer.warp !== null}
                onChange={(e) =>
                  onChange({ warp: e.target.checked ? { wavelength: layer.wavelength * 1.5, strength: layer.wavelength * 0.25 } : null })
                }
              />{' '}
              <Dim>warp</Dim>
            </label>
          </Row>
          {layer.warp !== null && (
            <>
              <SliderField
                label="warp λ km"
                value={layer.warp.wavelength}
                scale={KM}
                min={0.01}
                max={5000}
                log
                hardMin={0.001}
                onCommit={(wavelength) => onChange({ warp: { ...layer.warp!, wavelength } })}
              />
              <SliderField
                label="warp km"
                value={layer.warp.strength}
                scale={KM}
                min={0.001}
                max={1000}
                log
                hardMin={0}
                onCommit={(strength) => onChange({ warp: { ...layer.warp!, strength } })}
              />
            </>
          )}
        </>
      )}

      {layer.masks.map((mask, m) => (
        <MaskBox key={m}>
          <Row>
            <Dim>mask on</Dim>
            <SelectBox value={mask.layer} onChange={(e) => setMask(m, { layer: Number(e.target.value) })}>
              {earlier.map((name, i) => (
                <option key={i} value={i}>
                  {i} {name}
                </option>
              ))}
            </SelectBox>
            <SmallButton title="remove mask" onClick={() => onChange({ masks: layer.masks.filter((_, i) => i !== m) })}>
              ✕
            </SmallButton>
          </Row>
          <SliderField label="lo" value={mask.lo} min={-1} max={1} step={0.005} onCommit={(lo) => setMask(m, { lo })} />
          <SliderField label="hi" value={mask.hi} min={-1} max={1} step={0.005} onCommit={(hi) => setMask(m, { hi })} />
        </MaskBox>
      ))}
      {earlier.length > 0 && (
        <Row>
          <SmallButton onClick={() => onChange({ masks: [...layer.masks, { layer: 0, lo: 0, hi: 0.2 }] })}>+ mask</SmallButton>
        </Row>
      )}
    </Card>
  )
}

type SliderFieldProps = {
  label: string
  /** Stored units (metres for lengths). */
  value: number
  /** Slider range and step, in display units (`value / scale`). */
  min: number
  max: number
  step?: number
  /** Display units per stored unit's inverse: shown = value / scale. */
  scale?: number
  /** Logarithmic slider; `min` must be > 0. */
  log?: boolean
  integer?: boolean
  /** Clamp for typed values, display units. Typing may go past the slider's range otherwise. */
  hardMin?: number
  hardMax?: number
  onCommit: (value: number) => void
}

/** Slider plus a number box. The slider commits on release, the box on blur or Enter. */
function SliderField({ label, value, min, max, step = 0.01, scale = 1, log = false, integer = false, hardMin, hardMax, onCommit }: SliderFieldProps) {
  const [drag, setDrag] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const shown = drag ?? value / scale

  const toSlider = (v: number) => (log ? Math.log(Math.min(Math.max(v, min), max) / min) / Math.log(max / min) : v)
  const fromSlider = (t: number) => (log ? min * (max / min) ** t : t)

  const commit = (display: number) => {
    if (!Number.isFinite(display)) return
    let v = integer ? Math.round(display) : display
    if (hardMin !== undefined) v = Math.max(hardMin, v)
    if (hardMax !== undefined) v = Math.min(hardMax, v)
    const stored = v * scale
    if (stored !== value) onCommit(stored)
  }

  const release = () => {
    if (drag === null) return
    commit(drag)
    setDrag(null)
  }

  const commitText = () => {
    if (text === null) return
    setText(null)
    commit(Number(text))
  }

  return (
    <Field>
      <Dim title={label}>{label}</Dim>
      <Range
        type="range"
        min={log ? 0 : min}
        max={log ? 1 : max}
        step={log ? 0.001 : step}
        value={toSlider(shown)}
        onChange={(e) => setDrag(fromSlider(Number(e.target.value)))}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
      />
      <NumberBox
        value={text ?? String(Number(shown.toPrecision(5)))}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitText()
        }}
      />
    </Field>
  )
}

/** Text that commits on blur or Enter, so a half-typed name never reaches the terrain. */
function TextInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    setText(null)
    if (text !== value) onCommit(text)
  }
  return (
    <NameBox
      value={text ?? value}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

// --- styles: leva's theme tokens, so the cards match the rest of the panel ---

const Stack = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$sm',
  gridColumn: '1 / -1',
})

const Card = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$xs',
  padding: '$sm',
  borderRadius: '$sm',
  border: '1px solid $elevation3',
  backgroundColor: '$elevation1',
})

const Header = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$xs',
  paddingBottom: '$xs',
})

const Row = styled('div', {
  display: 'flex',
  alignItems: 'center',
  gap: '$xs',
  color: '$highlight2',
})

const MaskBox = styled('div', {
  display: 'flex',
  flexDirection: 'column',
  gap: '$xs',
  padding: '$xs $sm',
  borderLeft: '2px solid $elevation3',
})

const Field = styled('div', {
  display: 'grid',
  gridTemplateColumns: '72px 1fr 58px',
  alignItems: 'center',
  gap: '$sm',
})

const Dim = styled('span', {
  color: '$highlight2',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const Handle = styled('span', {
  cursor: 'grab',
  color: '$highlight2',
  padding: '0 2px',
  userSelect: 'none',
  '&:hover': { color: '$highlight3' },
})

const inputStyle = {
  fontFamily: '$mono',
  fontSize: '$root',
  color: '$highlight3',
  backgroundColor: '$elevation3',
  border: 'none',
  borderRadius: '$sm',
  height: '20px',
  padding: '0 $xs',
  minWidth: 0,
  outline: 'none',
  '&:focus': { boxShadow: '0 0 0 1px $accent2' },
}

const NameBox = styled('input', { ...inputStyle, flex: 1 })
const NumberBox = styled('input', { ...inputStyle, width: '100%', textAlign: 'right' })
const SelectBox = styled('select', { ...inputStyle, cursor: 'pointer' })

const SmallButton = styled('button', {
  ...inputStyle,
  cursor: 'pointer',
  padding: '0 $sm',
  '&:hover': { backgroundColor: '$accent1' },
})

const Range = styled('input', {
  width: '100%',
  minWidth: 0,
  accentColor: 'var(--leva-colors-accent2)',
  cursor: 'pointer',
})

const Marker = styled('div', {
  height: '2px',
  borderRadius: '1px',
  backgroundColor: '$accent2',
})
