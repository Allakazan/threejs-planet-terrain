import { useEffect } from 'react'
import { button, folder, levaStore, monitor, useControls } from 'leva'
import type { OnChangeHandler, Schema } from 'leva/plugin'
import { dequal } from 'leva/plugin'
import { DEFAULT_PRESET, PANEL_REBUILD_DEBOUNCE_MS } from '../../core/constants'
import { DEFAULT_ATMOSPHERE, atmosphere } from '../../planet/atmosphere/atmosphereSettings'
import type { AtmosphereSettings } from '../../planet/atmosphere/atmosphereSettings'
import { getAtmosphere, setAtmosphere } from '../../planet/atmosphere/atmosphereStore'
import { DEFAULT_MATERIAL, material } from '../../planet/shading/materialSettings'
import type { MaterialSettings } from '../../planet/shading/materialSettings'
import { farBakeSettings, getMaterial, setMaterial } from '../../planet/shading/materialStore'
import { TEXTURE_PACK_KEYS } from '../../planet/shading/texturePacks'
import { PLANET_PRESETS } from '../../planet/terrain/presets'
import type { PlanetPreset } from '../../planet/terrain/presets'
import { maxElevation } from '../../planet/terrain/terrainSpec'
import type { TerrainLayer, TerrainSpec } from '../../planet/terrain/terrainSpec'
import {
  getTerrainBuild,
  getTerrainVersion,
  isTerrainRebuilding,
  setTerrainBuild,
  subscribeTerrain,
} from '../../planet/terrain/terrainStore'
import { layerStack } from './layerStackPlugin'

/**
 * The planet panel's controls (leva, toggled with T): a preset combo that loads
 * everything, then three folders —
 *
 * - **geometry**: the terrain layer stack. Edits are debounced into a rebuild;
 * - **material**: the terrain shading, live (the far bake's cavity rebuilds);
 * - **atmosphere**: scattering, sun and the atmosphere's shape, live — the shape
 *   is the flight model's too.
 *
 * Leva is the UI only. Every input's `onChange` writes into the stores
 * (`materialStore`, `atmosphereStore`, the geometry draft here), never React
 * state; presets and pasted JSON go in through `levaStore.set`, so they take the
 * same path.
 *
 * Defaults are the constants: the material and atmosphere inputs start from
 * `DEFAULT_MATERIAL` / `DEFAULT_ATMOSPHERE`, which are built from `constants.ts`
 * alone, and the terrain from `DEFAULT_PRESET`'s layer stack.
 *
 * While the planet rebuilds, every input that would start another rebuild is
 * disabled, so edits can't pile up behind one in flight.
 */

const PRESET_NAMES = Object.keys(PLANET_PRESETS)
const INITIAL_TERRAIN = PLANET_PRESETS[DEFAULT_PRESET].terrain

/** Powers of two only: every tile period must divide `TEX_PERIOD`, or each rebase shows a seam. */
const pow2 = (from: number, to: number): number[] => {
  const out: number[] = []
  for (let v = from; v <= to; v *= 2) out.push(v)
  return out
}

type GetFn = (path: string) => unknown
/** One input's leva settings, without `value` and `onChange` (added by `section`). */
type Field = Record<string, unknown>
type Groups<T> = Record<string, { [K in keyof T]?: Field }>

const MATERIAL_GROUPS: Groups<MaterialSettings> = {
  textures: {
    groundPack: { label: 'ground pack', options: TEXTURE_PACK_KEYS },
    groundTint: { label: 'ground tint' },
    groundBrightness: { label: 'ground bright', min: 0, max: 4, step: 0.01 },
    groundSaturation: { label: 'ground sat', min: 0, max: 2, step: 0.01 },
    groundScale: { label: 'ground tile m', options: pow2(0.5, 32) },
    cliffPack: { label: 'cliff pack', options: TEXTURE_PACK_KEYS },
    cliffTint: { label: 'cliff tint' },
    cliffBrightness: { label: 'cliff bright', min: 0, max: 4, step: 0.01 },
    cliffSaturation: { label: 'cliff sat', min: 0, max: 2, step: 0.01 },
    cliffScale: { label: 'cliff tile m', options: pow2(0.5, 32) },
  },
  'slope blend': {
    slopeStart: { label: 'cliff start', min: 0, max: 1, step: 0.005, hint: 'slope (1 - N·up) where rock starts' },
    slopeEnd: { label: 'cliff end', min: 0, max: 1, step: 0.005, hint: 'slope where rock is total' },
    breakupScale: { label: 'breakup m/tx', options: pow2(4, 32), hint: 'metres per noise texel of the slope breakup' },
    breakupStrength: { label: 'breakup', min: 0, max: 0.5, step: 0.005 },
    breakupDetail: { label: 'breakup fine', min: 0, max: 1, step: 0.01, hint: 'weight of the finer breakup octave' },
    breakupRatio: { label: 'breakup ratio', options: [2, 4, 8], hint: 'frequency of the finer octave over the first' },
    heightBlendDepth: { label: 'height depth', min: 0.01, max: 1, step: 0.01 },
    heightBlendInfluence: { label: 'height infl.', min: 0, max: 2, step: 0.01 },
  },
  projection: {
    biplanar: { label: 'biplanar', hint: '2 projections instead of 3 (recompiles)' },
    triplanarSharpness: { label: 'tri sharp', min: 1, max: 16, step: 0.1, render: (get: GetFn) => !get('material.projection.biplanar') },
    triplanarBias: { label: 'tri bias', min: 0, max: 0.5, step: 0.01, render: (get: GetFn) => !get('material.projection.biplanar') },
    biplanarSharpness: { label: 'bi sharp', min: 0.25, max: 8, step: 0.05, render: (get: GetFn) => !!get('material.projection.biplanar') },
  },
  tiling: {
    stochastic: { label: 'stochastic', hint: "iq's two-tap repetition fix (recompiles)" },
    stochasticFadeStart: { label: 'stoch fade in', min: 0, max: 2000, step: 10, hint: 'metres' },
    stochasticFadeEnd: { label: 'stoch fade out', min: 0, max: 5000, step: 10, hint: 'metres' },
    stochasticBlend: { label: 'stoch blend', min: 0.02, max: 0.5, step: 0.01 },
    stochasticCells: { label: 'stoch cells', min: 2, max: 32, step: 1 },
    macroScale: { label: 'macro tile m', options: pow2(32, 2048) },
    macroStrength: { label: 'macro', min: 0, max: 1.5, step: 0.01 },
    macroRange: { label: 'macro range', min: 0, max: 1, step: 0.01 },
  },
  handover: {
    nearFadeStart: { label: 'near fade in', min: 0, max: 3, step: 0.05, hint: 'switch arcs' },
    nearFadeEnd: { label: 'near fade out', min: 0, max: 4, step: 0.05, hint: 'switch arcs' },
    farDetailStart: { label: 'far detail in', min: 1, max: 8, step: 0.1, hint: 'switch arcs' },
    farDetailEnd: { label: 'far detail out', min: 1, max: 10, step: 0.1, hint: 'switch arcs' },
  },
  'far bake': {
    cavityRadius: { label: 'cavity radius', min: 1, max: 8, step: 1, hint: 'texels; baked — rebuilds the planet' },
    cavityGain: { label: 'cavity gain', min: 0, max: 5, step: 0.05, hint: 'baked — rebuilds the planet' },
    cavityDarken: { label: 'cavity dark', min: 0, max: 1, step: 0.01 },
    ridgeLighten: { label: 'ridge light', min: 1, max: 2, step: 0.01 },
  },
  surface: {
    nearRoughness: { label: 'near rough', min: 0, max: 1, step: 0.01 },
    farRoughness: { label: 'far rough', min: 0, max: 1, step: 0.01 },
  },
}

const ATMOSPHERE_GROUPS: Groups<AtmosphereSettings> = {
  shape: {
    height: { label: 'height m', min: 10_000, max: 500_000, step: 1000, hint: 'also where drag starts and the hyperdrive cuts out' },
    scaleHeight: { label: 'scale height m', min: 1000, max: 100_000, step: 500, hint: 'the flight model’s density too' },
  },
  rayleigh: {
    rayleighDensity: { label: 'density', min: 0, max: 10, step: 0.01, hint: '1 = Earth’s column' },
    rayleighCoefficients: { label: 'β R G B', min: 0, max: 100, step: 0.1, hint: '1e-6/m at Earth’s 8 km scale height; the sky’s colour' },
  },
  mie: {
    mieScaleHeight: { label: 'scale height m', min: 200, max: 30_000, step: 100 },
    mieDensity: { label: 'density', min: 0, max: 20, step: 0.05, hint: '1 = Earth’s haze column' },
    mieExtinction: { label: 'extinction', min: 1, max: 3, step: 0.01, hint: 'extinction over scattering' },
    mieG: { label: 'g', min: 0, max: 0.99, step: 0.01, hint: 'how tightly the haze glows around the sun' },
  },
  sun: {
    sunAzimuth: { label: 'azimuth°', min: -180, max: 180, step: 0.1 },
    sunElevation: { label: 'elevation°', min: -90, max: 90, step: 0.1 },
    sunIntensity: { label: 'intensity', min: 0, max: 10, step: 0.05, hint: 'the directional light' },
    airSunScale: { label: 'air sun ×', min: 0, max: 10, step: 0.05, hint: 'the sun the scattering sees, × intensity' },
    ambient: { label: 'ambient', min: 0, max: 1, step: 0.01 },
  },
  haze: {
    spaceHaze: { label: 'space haze', min: 0, max: 1, step: 0.01, hint: 'haze over the disk seen from space; 1 = physical' },
    hazeGrazingPower: { label: 'limb power', min: 1, max: 16, step: 0.1, hint: 'how fast full haze returns towards the limb' },
  },
  night: {
    night: { label: 'night', min: 0, max: 1, step: 0.01 },
    nightTint: { label: 'airglow', min: 0, max: 100, step: 0.1, hint: 'linear radiance ×1e-3, R G B' },
    skyHide: { label: 'sky hide', min: 0.01, max: 2, step: 0.01, hint: 'sky luminance that fully hides what is behind it' },
  },
  quality: {
    terrainSteps: { label: 'terrain steps', min: 2, max: 32, step: 1, hint: 'recompiles' },
    terrainLightSteps: { label: 'terrain sun steps', min: 1, max: 16, step: 1, hint: 'recompiles' },
    skySteps: { label: 'sky steps', min: 4, max: 64, step: 1, hint: 'recompiles' },
    skyLightSteps: { label: 'sky sun steps', min: 1, max: 16, step: 1, hint: 'recompiles' },
  },
}

/** Leva path of every settings key, e.g. `cavityGain` → `material.far bake.cavityGain`. */
function pathsOf<T>(root: string, groups: Groups<T>): Map<keyof T, string> {
  const paths = new Map<keyof T, string>()
  for (const [group, fields] of Object.entries(groups)) {
    for (const key of Object.keys(fields)) paths.set(key as keyof T, `${root}.${group}.${key}`)
  }
  return paths
}

const MATERIAL_PATHS = pathsOf('material', MATERIAL_GROUPS)
const ATMOSPHERE_PATHS = pathsOf('atmosphere', ATMOSPHERE_GROUPS)

const PATH = {
  preset: 'preset',
  reload: 'reload preset',
  copy: 'copy JSON',
  paste: 'paste JSON',
  status: 'status',
  terrainPreset: 'geometry.terrain preset',
  layers: 'geometry.layers',
  materialPreset: 'material.material preset',
  atmospherePreset: 'atmosphere.atmosphere preset',
} as const

/** Disabled while the planet rebuilds: everything that would start another rebuild. */
const LOCKED_INPUTS: readonly string[] = [
  PATH.preset,
  PATH.terrainPreset,
  PATH.layers,
  MATERIAL_PATHS.get('cavityRadius')!,
  MATERIAL_PATHS.get('cavityGain')!,
]
const LOCKED_BUTTONS: readonly string[] = [PATH.reload, PATH.paste]

// --- geometry: the draft the layer stack edits, debounced into terrain builds ---

const draft: TerrainSpec = structuredClone(INITIAL_TERRAIN)
let rebuildTimer: number | undefined

/** Publishes the draft (and the material's bake settings) after the edits settle. A no-op if nothing changed. */
function scheduleRebuild(): void {
  window.clearTimeout(rebuildTimer)
  rebuildTimer = window.setTimeout(() => {
    const next = { spec: { name: draft.name, layers: draft.layers }, bake: farBakeSettings() }
    // Also what makes the lock safe: re-enabling an input replays its onChange.
    if (dequal(next, getTerrainBuild())) return
    setTerrainBuild(next)
  }, PANEL_REBUILD_DEBOUNCE_MS)
}

// --- presets ---

type Part = 'terrain' | 'material' | 'atmosphere'
const ALL_PARTS: readonly Part[] = ['terrain', 'material', 'atmosphere']

/**
 * The preset each select last loaded. Re-enabling a select after a rebuild replays
 * its onChange with the same name; this is what keeps that from loading it again.
 */
const loaded: Record<'all' | Part, string> = {
  all: DEFAULT_PRESET,
  terrain: DEFAULT_PRESET,
  material: DEFAULT_PRESET,
  atmosphere: DEFAULT_PRESET,
}

/** Pushes (parts of) a preset into leva; the inputs' onChange handlers apply it. */
function applyPreset(preset: PlanetPreset, parts: readonly Part[]): void {
  const values: Record<string, unknown> = {}
  if (parts.includes('terrain')) {
    draft.name = preset.terrain.name
    values[PATH.layers] = structuredClone(preset.terrain.layers)
  }
  if (parts.includes('material')) {
    for (const [key, path] of MATERIAL_PATHS) values[path] = preset.material[key]
  }
  if (parts.includes('atmosphere')) {
    for (const [key, path] of ATMOSPHERE_PATHS) values[path] = structuredClone(preset.atmosphere[key])
  }
  levaStore.set(values, false)
}

function loadNamedPreset(name: string, parts: readonly Part[]): void {
  const preset = PLANET_PRESETS[name]
  if (preset === undefined) return
  applyPreset(preset, parts)
}

function currentPreset(): PlanetPreset {
  return {
    terrain: { name: draft.name, layers: draft.layers },
    material: { ...getMaterial() },
    atmosphere: { ...getAtmosphere() },
  }
}

// --- status line ---

let note = ''
let noteUntil = 0

function flash(text: string): void {
  note = text
  noteUntil = performance.now() + 3000
}

function status(): string {
  const state = isTerrainRebuilding() ? 'rebuilding…' : 'ready'
  const elevation = `±${(maxElevation(draft) / 1000).toFixed(1)} km`
  const extra = performance.now() < noteUntil ? ` · ${note}` : ''
  return `v${getTerrainVersion()} · ${state} · ${elevation}${extra}`
}

// --- JSON ---

function copyJson(): void {
  navigator.clipboard.writeText(JSON.stringify(currentPreset(), null, 2)).then(
    () => flash('copied'),
    () => flash('clipboard blocked'),
  )
}

/**
 * Takes a whole preset, or a bare terrain spec (the old panel's format). Missing
 * material or atmosphere fields fall back to the defaults, so older JSON still loads.
 */
function pasteJson(): void {
  const text = window.prompt('Paste a planet preset (or a terrain spec) as JSON:')
  if (text === null) return
  try {
    const parsed = JSON.parse(text) as Partial<PlanetPreset> & Partial<TerrainSpec>
    const terrain = parsed.terrain ?? (Array.isArray(parsed.layers) ? (parsed as TerrainSpec) : undefined)
    if (terrain !== undefined && !Array.isArray(terrain.layers)) throw new Error('no layers')
    const parts: Part[] = []
    if (terrain !== undefined) parts.push('terrain')
    if (parsed.material !== undefined) parts.push('material')
    if (parsed.atmosphere !== undefined) parts.push('atmosphere')
    if (parts.length === 0) throw new Error('nothing to load')
    applyPreset(
      {
        terrain: terrain ?? INITIAL_TERRAIN,
        material: material(parsed.material ?? {}),
        atmosphere: atmosphere(parsed.atmosphere ?? {}),
      },
      parts,
    )
    flash('loaded')
  } catch {
    flash('invalid JSON')
  }
}

// --- schema ---

type OnChangeContext = { initial: boolean; fromPanel: boolean }

/** One folder's inputs per group, each wired to `apply(key, value)`. */
function section<T extends object>(
  groups: Groups<T>,
  defaults: Readonly<T>,
  apply: (key: keyof T, value: unknown, initialCall: boolean) => void,
): Schema {
  const schema: Schema = {}
  for (const [group, fields] of Object.entries(groups)) {
    const inputs: Schema = {}
    for (const [key, field] of Object.entries(fields as Record<string, Field>)) {
      inputs[key] = {
        value: structuredClone(defaults[key as keyof T]),
        ...field,
        onChange: (value: unknown, _path: string, context: OnChangeContext) => {
          // Disabling an input replays its onChange with `undefined`.
          if (value === undefined) return
          apply(key as keyof T, value, context.initial)
        },
      } as Schema[string]
    }
    schema[group] = folder(inputs, { collapsed: true })
  }
  return schema
}

/** A per-folder (or the top-level) preset select. Only a pick in the panel loads. */
function presetSelect(which: 'all' | Part, label: string, hint: string): Schema[string] {
  return {
    label,
    hint,
    value: DEFAULT_PRESET,
    options: PRESET_NAMES,
    onChange: (name: string | undefined, _path: string, context: OnChangeContext) => {
      if (name === undefined || context.initial || !context.fromPanel || loaded[which] === name) return
      loaded[which] = name
      if (which !== 'all') {
        loadNamedPreset(name, [which])
        return
      }
      for (const part of ALL_PARTS) loaded[part] = name
      loadNamedPreset(name, ALL_PARTS)
      levaStore.set({ [PATH.terrainPreset]: name, [PATH.materialPreset]: name, [PATH.atmospherePreset]: name }, false)
    },
  } as Schema[string]
}

/** The layer stack's changes: into the draft, then a debounced rebuild. */
function onLayers(value: TerrainLayer[] | undefined, _path: string, context: OnChangeContext): void {
  if (value === undefined || context.initial) return
  draft.layers = value
  scheduleRebuild()
}

function buildSchema(): Schema {
  return {
    [PATH.preset]: presetSelect('all', 'preset', 'loads terrain, material and atmosphere'),
    [PATH.status]: monitor(status, { interval: 200 }),
    [PATH.reload]: button(() => loadNamedPreset(loaded.all, ALL_PARTS)),
    [PATH.copy]: button(copyJson),
    [PATH.paste]: button(pasteJson),

    geometry: folder({
      'terrain preset': presetSelect('terrain', 'load terrain', 'replaces the layer stack only'),
      layers: layerStack({ value: structuredClone(INITIAL_TERRAIN.layers), onChange: onLayers as OnChangeHandler }),
    }),

    material: folder(
      {
        'material preset': presetSelect('material', 'load material', 'replaces the material only'),
        ...section<MaterialSettings>(MATERIAL_GROUPS, DEFAULT_MATERIAL, (key, value, initialCall) => {
          setMaterial({ [key]: value })
          if ((key === 'cavityRadius' || key === 'cavityGain') && !initialCall) scheduleRebuild()
        }),
      },
      { collapsed: true },
    ),

    atmosphere: folder(
      {
        'atmosphere preset': presetSelect('atmosphere', 'load atmosphere', 'replaces the atmosphere only'),
        ...section<AtmosphereSettings>(ATMOSPHERE_GROUPS, DEFAULT_ATMOSPHERE, (key, value) => {
          setAtmosphere({ [key]: value })
        }),
      },
      { collapsed: true },
    ),
  }
}

/**
 * Mounts the planet panel's controls into leva's global store. Call it once, from
 * a component that stays mounted; `PlanetPanel` only shows or hides the panel.
 */
export function usePlanetControls(): void {
  useControls(buildSchema)

  // The lock: follow the terrain store's rebuild flag. Runs after `useControls`
  // has registered its inputs, so the paths exist.
  useEffect(() => {
    const sync = () => {
      const locked = isTerrainRebuilding()
      const data = levaStore.getData() as Record<string, { disabled?: boolean; settings?: { disabled?: boolean } }>
      for (const path of LOCKED_INPUTS) {
        if (data[path] !== undefined && data[path].disabled !== locked) levaStore.disableInputAtPath(path, locked)
      }
      for (const path of LOCKED_BUTTONS) {
        if (data[path] !== undefined && data[path].settings?.disabled !== locked) levaStore.setSettingsAtPath(path, { disabled: locked })
      }
    }
    sync()
    return subscribeTerrain(sync)
  }, [])
}
