import { createPlugin } from 'leva/plugin'
import type { OnChangeHandler } from 'leva/plugin'
import type { TerrainLayer } from '../../planet/terrain/terrainSpec'
import { LayerStack } from './LayerStack'

/**
 * A leva input whose value is the whole terrain layer array, drawn as draggable
 * cards. Kept apart from `LayerStack` because a module that exports a component
 * must export nothing else.
 *
 * Input options (`onChange`, ...) go *inside* the call — leva only reads them from
 * there for a custom input — and leva unwraps `{ value }` before `normalize`, which
 * therefore receives the array itself.
 */
export const layerStack = createPlugin<{ value: TerrainLayer[]; onChange?: OnChangeHandler }, TerrainLayer[], object>({
  component: LayerStack,
  normalize: (input) => ({ value: input as unknown as TerrainLayer[] }),
  sanitize: (value: unknown) => {
    if (!Array.isArray(value)) throw new Error('layer stack: expected an array of layers')
    return value as TerrainLayer[]
  },
})
