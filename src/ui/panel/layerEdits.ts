import { NoiseBasis } from '../../planet/terrain/terrainSpec'
import type { TerrainLayer } from '../../planet/terrain/terrainSpec'

const KM = 1000

/**
 * Layer-list edits for the planet panel. Masks name their source layer by index,
 * so every edit renumbers them to keep their targets; a mask left pointing at
 * itself or a later layer is dropped, as the terrain would ignore it anyway.
 */

export function newLayer(layers: readonly TerrainLayer[]): TerrainLayer {
  const seedOffset = layers.reduce((max, layer) => Math.max(max, layer.seedOffset), 0) + 1
  return {
    name: `layer ${layers.length}`,
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

export function removeLayer(layers: readonly TerrainLayer[], index: number): TerrainLayer[] {
  return layers
    .filter((_, i) => i !== index)
    .map((layer) => ({
      ...layer,
      masks: layer.masks
        .filter((mask) => mask.layer !== index)
        .map((mask) => (mask.layer > index ? { ...mask, layer: mask.layer - 1 } : mask)),
    }))
}

/** Takes the layer at `from` out and reinserts it so it ends up at index `to`. */
export function moveLayer(layers: readonly TerrainLayer[], from: number, to: number): TerrainLayer[] {
  if (from === to || from < 0 || from >= layers.length) return [...layers]
  const target = Math.max(0, Math.min(layers.length - 1, to))

  const order = layers.map((_, i) => i)
  order.splice(from, 1)
  order.splice(target, 0, from)
  // `order[newIndex] = oldIndex`; masks need the inverse.
  const newIndexOf = new Array<number>(layers.length)
  order.forEach((oldIndex, newIndex) => {
    newIndexOf[oldIndex] = newIndex
  })

  return order.map((oldIndex, position) => {
    const layer = layers[oldIndex]
    return {
      ...layer,
      masks: layer.masks
        .map((mask) => ({ ...mask, layer: newIndexOf[mask.layer] }))
        .filter((mask) => mask.layer !== undefined && mask.layer < position),
    }
  })
}
