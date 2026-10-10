import { atmosphere } from '../atmosphere/atmosphereSettings'
import type { AtmosphereSettings } from '../atmosphere/atmosphereSettings'
import { material } from '../shading/materialSettings'
import type { MaterialSettings } from '../shading/materialSettings'
import { NoiseBasis } from './terrainSpec'
import type { TerrainLayer, TerrainSpec } from './terrainSpec'

/**
 * A whole planet's look as plain data: the terrain layer stack, the surface
 * material and the atmosphere. What the planet panel's preset combo loads and its
 * JSON buttons copy and paste.
 */
export type PlanetPreset = {
  terrain: TerrainSpec
  material: MaterialSettings
  atmosphere: AtmosphereSettings
}

/** Defaults for the fields most layers leave alone. */
function layer(fields: Partial<TerrainLayer> & Pick<TerrainLayer, 'name' | 'basis' | 'wavelength' | 'amplitude'>): TerrainLayer {
  return {
    enabled: true,
    octaves: 4,
    lacunarity: 2.2,
    gain: 0.5,
    seedOffset: 0,
    masks: [],
    warp: null,
    ...fields,
  }
}

const KM = 1000

/**
 * Airless rock. A coarse "regions" mask splits the surface into flat, sunken
 * maria and ridged highlands. Craters sit on top at three scales, and fine
 * regolith noise carries detail down to the last LOD level.
 */
const ROCKY: TerrainSpec = {
  name: 'rocky',
  layers: [
    layer({ name: 'regions (mask)', basis: NoiseBasis.Simplex, wavelength: 1800 * KM, amplitude: 0, octaves: 3, lacunarity: 2.1, seedOffset: 1 }),
    layer({ name: 'maria', basis: NoiseBasis.Constant, wavelength: 1, amplitude: -2500, seedOffset: 2, masks: [{ layer: 0, lo: 0.08, hi: 0.22 }] }),
    layer({ name: 'uplands', basis: NoiseBasis.Simplex, wavelength: 600 * KM, amplitude: 3000, octaves: 4, seedOffset: 3, masks: [{ layer: 0, lo: 0.2, hi: 0.05 }] }),
    layer({
      name: 'highlands',
      basis: NoiseBasis.Ridged,
      wavelength: 250 * KM,
      amplitude: 4500,
      octaves: 7,
      lacunarity: 2.1,
      seedOffset: 4,
      masks: [{ layer: 0, lo: 0.12, hi: -0.05 }],
      warp: { wavelength: 300 * KM, strength: 60 * KM },
    }),
    layer({ name: 'big craters', basis: NoiseBasis.Crater, wavelength: 120 * KM, amplitude: 4000, octaves: 2, lacunarity: 2.6, gain: 0.45, seedOffset: 5 }),
    layer({ name: 'craters', basis: NoiseBasis.Crater, wavelength: 6 * KM, amplitude: 700, octaves: 3, lacunarity: 2.7, gain: 0.45, seedOffset: 6 }),
    layer({ name: 'small craters', basis: NoiseBasis.Crater, wavelength: 300, amplitude: 45, octaves: 4, lacunarity: 2.5, seedOffset: 7 }),
    layer({ name: 'rough', basis: NoiseBasis.Simplex, wavelength: 2 * KM, amplitude: 120, octaves: 6, seedOffset: 8 }),
    layer({ name: 'regolith', basis: NoiseBasis.Simplex, wavelength: 60, amplitude: 3, octaves: 7, gain: 0.55, seedOffset: 9 }),
  ],
}

/**
 * Continents and basins, with warped ridged ranges only where both the continent
 * and a separate "belt" mask allow. Billowy hills cover the land; two fine layers
 * carry detail down to the surface.
 */
const EARTHLIKE: TerrainSpec = {
  name: 'earthlike',
  layers: [
    layer({ name: 'continents', basis: NoiseBasis.Simplex, wavelength: 2500 * KM, amplitude: 3000, octaves: 5, lacunarity: 2.1, seedOffset: 11 }),
    layer({ name: 'belts (mask)', basis: NoiseBasis.Simplex, wavelength: 900 * KM, amplitude: 0, octaves: 2, seedOffset: 12 }),
    layer({
      name: 'mountains',
      basis: NoiseBasis.Ridged,
      wavelength: 160 * KM,
      amplitude: 7000,
      octaves: 8,
      lacunarity: 2.1,
      gain: 0.54,
      seedOffset: 13,
      masks: [
        { layer: 0, lo: 0, hi: 0.15 },
        { layer: 1, lo: 0, hi: 0.25 },
      ],
      warp: { wavelength: 200 * KM, strength: 40 * KM },
    }),
    layer({ name: 'hills', basis: NoiseBasis.Billow, wavelength: 25 * KM, amplitude: 500, octaves: 4, gain: 0.45, seedOffset: 14, masks: [{ layer: 0, lo: -0.05, hi: 0.1 }] }),
    layer({ name: 'rough', basis: NoiseBasis.Simplex, wavelength: 3 * KM, amplitude: 120, octaves: 6, seedOffset: 15 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 150, amplitude: 6, octaves: 8, gain: 0.55, seedOffset: 16 }),
  ],
}

// Mask thresholds below are set from measured distributions. A simplex mask layer
// (gain 0.5, any octave count) has quartiles at about ±0.15 and deciles at ±0.29.
// A worleyF1 layer runs 0 … 0.52, and worleyF2F1 0 … 0.48 (median 0.08). Both
// include the layer's `1 - gain` normaliser.

/**
 * Sand sea. Warped ridged noise at two scales makes sinuous dune crests and
 * ripples in the low basins. Billowy rock outcrops break through on the high
 * ground.
 */
const DESERT: TerrainSpec = {
  name: 'desert',
  layers: [
    layer({ name: 'basins (mask)', basis: NoiseBasis.Simplex, wavelength: 1200 * KM, amplitude: 0, octaves: 3, seedOffset: 21 }),
    layer({ name: 'plateaus', basis: NoiseBasis.Simplex, wavelength: 400 * KM, amplitude: 1500, octaves: 4, seedOffset: 22 }),
    layer({
      name: 'great dunes',
      basis: NoiseBasis.Ridged,
      wavelength: 3 * KM,
      amplitude: 160,
      octaves: 3,
      lacunarity: 2.3,
      gain: 0.4,
      seedOffset: 23,
      masks: [{ layer: 0, lo: -0.05, hi: 0.1 }],
      warp: { wavelength: 8 * KM, strength: 1.5 * KM },
    }),
    layer({
      name: 'ripples',
      basis: NoiseBasis.Ridged,
      wavelength: 300,
      amplitude: 8,
      octaves: 3,
      seedOffset: 24,
      masks: [{ layer: 0, lo: -0.05, hi: 0.1 }],
      warp: { wavelength: 1 * KM, strength: 150 },
    }),
    layer({ name: 'outcrops', basis: NoiseBasis.Billow, wavelength: 20 * KM, amplitude: 500, octaves: 5, seedOffset: 25, masks: [{ layer: 0, lo: 0.05, hi: -0.1 }] }),
    layer({ name: 'sand', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 0.6, octaves: 5, seedOffset: 26 }),
  ],
}

/**
 * Mesas and canyons. Four constant layers, each sharply masked at a higher
 * threshold of the same "strata" field, stack into flat terraces with cliff
 * steps. Inverted ridged noise cuts winding canyons through them.
 */
const CANYONLANDS: TerrainSpec = {
  name: 'canyonlands',
  layers: [
    layer({ name: 'strata (mask)', basis: NoiseBasis.Simplex, wavelength: 60 * KM, amplitude: 0, octaves: 4, seedOffset: 31 }),
    layer({ name: 'tier 1', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 350, masks: [{ layer: 0, lo: -0.15, hi: -0.135 }] }),
    layer({ name: 'tier 2', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 350, masks: [{ layer: 0, lo: -0.05, hi: -0.035 }] }),
    layer({ name: 'tier 3', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 350, masks: [{ layer: 0, lo: 0.05, hi: 0.065 }] }),
    layer({ name: 'tier 4', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 350, masks: [{ layer: 0, lo: 0.15, hi: 0.165 }] }),
    layer({
      name: 'canyons',
      basis: NoiseBasis.Ridged,
      wavelength: 90 * KM,
      amplitude: -1200,
      octaves: 5,
      seedOffset: 32,
      warp: { wavelength: 120 * KM, strength: 25 * KM },
    }),
    layer({ name: 'regional', basis: NoiseBasis.Simplex, wavelength: 800 * KM, amplitude: 1200, octaves: 3, seedOffset: 33 }),
    layer({ name: 'talus', basis: NoiseBasis.Billow, wavelength: 1.5 * KM, amplitude: 30, octaves: 4, seedOffset: 34 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 50, amplitude: 1.5, octaves: 6, seedOffset: 35 }),
  ],
}

/**
 * Europa-like ice shell. Almost flat, broken into plates by a worleyF2F1
 * network (grooves where cells meet), crossed by long warped ridges. Patches of
 * jumbled "chaos terrain" and a few craters.
 */
const ICY: TerrainSpec = {
  name: 'icy',
  layers: [
    layer({ name: 'shell', basis: NoiseBasis.Simplex, wavelength: 1500 * KM, amplitude: 400, octaves: 3, seedOffset: 41 }),
    layer({ name: 'plates', basis: NoiseBasis.WorleyF2F1, wavelength: 80 * KM, amplitude: 500, octaves: 2, gain: 0.4, seedOffset: 42 }),
    layer({
      name: 'ridges',
      basis: NoiseBasis.Ridged,
      wavelength: 40 * KM,
      amplitude: 180,
      octaves: 3,
      gain: 0.45,
      seedOffset: 43,
      warp: { wavelength: 60 * KM, strength: 6 * KM },
    }),
    layer({ name: 'chaos (mask)', basis: NoiseBasis.Simplex, wavelength: 500 * KM, amplitude: 0, octaves: 2, seedOffset: 44 }),
    layer({ name: 'chaos', basis: NoiseBasis.Billow, wavelength: 4 * KM, amplitude: 220, octaves: 4, seedOffset: 45, masks: [{ layer: 3, lo: 0.15, hi: 0.25 }] }),
    layer({ name: 'craters', basis: NoiseBasis.Crater, wavelength: 30 * KM, amplitude: 300, octaves: 2, seedOffset: 46 }),
    layer({ name: 'frost', basis: NoiseBasis.Simplex, wavelength: 30, amplitude: 0.4, octaves: 5, seedOffset: 47 }),
  ],
}

/**
 * Shield volcanoes over hotspots, cinder-cone fields, and flat lava plains in
 * between. Each cone is `-worleyF1` (a peak on every Worley point) lifted by a
 * constant under the same mask, so the peaks rise from the plain rather than the
 * cells sinking into it.
 */
const VOLCANIC: TerrainSpec = {
  name: 'volcanic',
  layers: [
    layer({ name: 'hotspots (mask)', basis: NoiseBasis.Simplex, wavelength: 700 * KM, amplitude: 0, octaves: 3, seedOffset: 51 }),
    layer({ name: 'shields', basis: NoiseBasis.WorleyF1, wavelength: 250 * KM, amplitude: -10000, octaves: 1, seedOffset: 52, masks: [{ layer: 0, lo: 0.1, hi: 0.25 }] }),
    layer({ name: 'shield base', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 3000, masks: [{ layer: 0, lo: 0.1, hi: 0.25 }] }),
    layer({ name: 'lava plains', basis: NoiseBasis.Constant, wavelength: 1, amplitude: -800, masks: [{ layer: 0, lo: 0, hi: -0.1 }] }),
    layer({ name: 'flows', basis: NoiseBasis.Billow, wavelength: 15 * KM, amplitude: 150, octaves: 4, seedOffset: 54, warp: { wavelength: 30 * KM, strength: 10 * KM } }),
    layer({ name: 'cinder (mask)', basis: NoiseBasis.Simplex, wavelength: 80 * KM, amplitude: 0, octaves: 2, seedOffset: 55 }),
    layer({ name: 'cinder cones', basis: NoiseBasis.WorleyF1, wavelength: 5 * KM, amplitude: -800, octaves: 1, seedOffset: 56, masks: [{ layer: 5, lo: 0.2, hi: 0.3 }] }),
    layer({ name: 'cinder base', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 300, masks: [{ layer: 5, lo: 0.2, hi: 0.3 }] }),
    layer({ name: 'basalt', basis: NoiseBasis.Simplex, wavelength: 1 * KM, amplitude: 40, octaves: 6, gain: 0.55, seedOffset: 57 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 1.5, octaves: 6, seedOffset: 58 }),
  ],
}

/**
 * Extreme ranges. Very tall ridged peaks with a high gain, so they stay jagged
 * all the way down, in bands. Ridged foothills fill the gaps, with scree and fine
 * detail on top.
 */
const ALPINE: TerrainSpec = {
  name: 'alpine',
  layers: [
    layer({ name: 'massifs', basis: NoiseBasis.Simplex, wavelength: 1000 * KM, amplitude: 2500, octaves: 3, seedOffset: 61 }),
    layer({ name: 'ranges (mask)', basis: NoiseBasis.Simplex, wavelength: 600 * KM, amplitude: 0, octaves: 2, seedOffset: 62 }),
    layer({
      name: 'peaks',
      basis: NoiseBasis.Ridged,
      wavelength: 120 * KM,
      amplitude: 12000,
      octaves: 9,
      lacunarity: 2.05,
      gain: 0.55,
      seedOffset: 63,
      masks: [{ layer: 1, lo: -0.1, hi: 0.1 }],
      warp: { wavelength: 150 * KM, strength: 30 * KM },
    }),
    layer({ name: 'foothills', basis: NoiseBasis.Ridged, wavelength: 20 * KM, amplitude: 800, octaves: 5, seedOffset: 64, masks: [{ layer: 1, lo: -0.25, hi: -0.05 }] }),
    layer({ name: 'scree', basis: NoiseBasis.Billow, wavelength: 400, amplitude: 15, octaves: 4, seedOffset: 65 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 2, octaves: 6, gain: 0.55, seedOffset: 66 }),
  ],
}

/**
 * Dry country. Warped ridged rills erode the high ground. The low basins are
 * flat playas, and up close they crack into a polygon network (worleyF2F1 at
 * 25 m, which only appears once the mesh can carry it).
 */
const BADLANDS: TerrainSpec = {
  name: 'badlands',
  layers: [
    layer({ name: 'basins (mask)', basis: NoiseBasis.Simplex, wavelength: 400 * KM, amplitude: 0, octaves: 3, seedOffset: 71 }),
    layer({ name: 'uplands', basis: NoiseBasis.Simplex, wavelength: 900 * KM, amplitude: 1500, octaves: 3, seedOffset: 72 }),
    layer({
      name: 'eroded hills',
      basis: NoiseBasis.Ridged,
      wavelength: 8 * KM,
      amplitude: 350,
      octaves: 5,
      seedOffset: 73,
      masks: [{ layer: 0, lo: 0.05, hi: -0.05 }],
      warp: { wavelength: 12 * KM, strength: 3 * KM },
    }),
    layer({ name: 'gullies', basis: NoiseBasis.Billow, wavelength: 1 * KM, amplitude: 40, octaves: 4, seedOffset: 75, masks: [{ layer: 0, lo: 0.05, hi: -0.05 }] }),
    layer({ name: 'playa', basis: NoiseBasis.Constant, wavelength: 1, amplitude: -600, masks: [{ layer: 0, lo: 0.1, hi: 0.18 }] }),
    layer({ name: 'mud cracks', basis: NoiseBasis.WorleyF2F1, wavelength: 25, amplitude: 1.2, octaves: 2, gain: 0.4, seedOffset: 74, masks: [{ layer: 0, lo: 0.12, hi: 0.2 }] }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 1, octaves: 5, seedOffset: 76 }),
  ],
}

/**
 * A broken crust. Huge worleyF2F1 cells form raised plates with deep V rifts
 * between them, tilted by broad simplex. Smaller fracture cells and warped ridges
 * sit on the plates.
 */
const SHATTERED: TerrainSpec = {
  name: 'shattered',
  layers: [
    layer({ name: 'plates', basis: NoiseBasis.WorleyF2F1, wavelength: 600 * KM, amplitude: 10000, octaves: 1, seedOffset: 81 }),
    layer({ name: 'tilt', basis: NoiseBasis.Simplex, wavelength: 300 * KM, amplitude: 2000, octaves: 3, seedOffset: 82 }),
    layer({ name: 'fractures', basis: NoiseBasis.WorleyF2F1, wavelength: 60 * KM, amplitude: 1600, octaves: 3, gain: 0.4, seedOffset: 83 }),
    layer({ name: 'ridges', basis: NoiseBasis.Ridged, wavelength: 25 * KM, amplitude: 600, octaves: 4, seedOffset: 84, warp: { wavelength: 40 * KM, strength: 8 * KM } }),
    layer({ name: 'rubble', basis: NoiseBasis.Billow, wavelength: 800, amplitude: 25, octaves: 4, seedOffset: 85 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 1.5, octaves: 6, seedOffset: 86 }),
  ],
}

/**
 * Alien foam. Positive worleyF1 makes a bowl in every cell with walls where cells
 * meet. Three octaves nest bubbles inside bubbles, with a second, smaller foam
 * on top.
 */
const FOAM: TerrainSpec = {
  name: 'foam',
  layers: [
    layer({ name: 'bubbles', basis: NoiseBasis.WorleyF1, wavelength: 150 * KM, amplitude: 8000, octaves: 3, lacunarity: 2.4, gain: 0.45, seedOffset: 91 }),
    layer({ name: 'small bubbles', basis: NoiseBasis.WorleyF1, wavelength: 3 * KM, amplitude: 400, octaves: 3, gain: 0.45, seedOffset: 92 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 30, amplitude: 0.8, octaves: 5, seedOffset: 93 }),
  ],
}

/**
 * Islands on a deep floor. There is no water yet, so for now the sea reads as wide
 * low basins. Sharply masked shelves lift the islands, and ridged volcanic peaks
 * rise from their cores.
 */
const ARCHIPELAGO: TerrainSpec = {
  name: 'archipelago',
  layers: [
    layer({ name: 'islands (mask)', basis: NoiseBasis.Simplex, wavelength: 400 * KM, amplitude: 0, octaves: 4, seedOffset: 101 }),
    layer({ name: 'seafloor', basis: NoiseBasis.Simplex, wavelength: 1500 * KM, amplitude: 1500, octaves: 3, seedOffset: 102 }),
    layer({ name: 'shelf', basis: NoiseBasis.Constant, wavelength: 1, amplitude: 2500, masks: [{ layer: 0, lo: 0.12, hi: 0.2 }] }),
    layer({ name: 'peaks', basis: NoiseBasis.Ridged, wavelength: 40 * KM, amplitude: 2500, octaves: 6, seedOffset: 103, masks: [{ layer: 0, lo: 0.18, hi: 0.32 }] }),
    layer({ name: 'hills', basis: NoiseBasis.Billow, wavelength: 5 * KM, amplitude: 150, octaves: 4, seedOffset: 104, masks: [{ layer: 0, lo: 0.12, hi: 0.2 }] }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 1.5, octaves: 6, seedOffset: 105 }),
  ],
}

/** Gentle rolling plains. Calm, and a good baseline to add one layer to and watch. */
const FLATLANDS: TerrainSpec = {
  name: 'flatlands',
  layers: [
    layer({ name: 'swells', basis: NoiseBasis.Simplex, wavelength: 800 * KM, amplitude: 600, octaves: 3, seedOffset: 111 }),
    layer({ name: 'rolling hills', basis: NoiseBasis.Simplex, wavelength: 6 * KM, amplitude: 60, octaves: 4, gain: 0.45, seedOffset: 112 }),
    layer({ name: 'detail', basis: NoiseBasis.Simplex, wavelength: 40, amplitude: 0.8, octaves: 5, seedOffset: 113 }),
  ],
}

// --- the planets: terrain + material + atmosphere ---
// `earthlike` is the default preset, so its material and atmosphere are exactly the
// constants. The others are starting points, tuned by eye only roughly; the
// texture packs are whatever `TEXTURE_PACKS` holds today.

export const PLANET_PRESETS: Readonly<Record<string, PlanetPreset>> = {
  /** Airless grey rock: a whisper of exosphere, rock on every slope. */
  rocky: {
    terrain: ROCKY,
    material: material({
      groundPack: 'rocks_ground_02',
      groundSaturation: 0.1,
      groundBrightness: 1.2,
      cliffPack: 'rocks_ground_02',
      cliffSaturation: 0,
      cliffBrightness: 0.8,
      cliffScale: 16,
      slopeStart: 0.2,
      slopeEnd: 0.45,
      cavityGain: 1.6,
      cavityDarken: 0.15,
    }),
    atmosphere: atmosphere({ height: 20_000, scaleHeight: 5_000, rayleighDensity: 0.03, mieDensity: 0.05, spaceHaze: 0.2 }),
  },
  earthlike: { terrain: EARTHLIKE, material: material({}), atmosphere: atmosphere({}) },
  /** Meadows under bare rock, steep enough that rock takes most slopes; thin, deep-blue air. */
  alpine: {
    terrain: ALPINE,
    material: material({
      groundPack: 'grass_004',
      cliffPack: 'rocks_ground_02',
      cliffSaturation: 0.5,
      slopeStart: 0.08,
      slopeEnd: 0.22,
    }),
    atmosphere: atmosphere({ rayleighDensity: 0.8, mieDensity: 0.6 }),
  },
  /** Bright sand, dusty orange-tinged sky. */
  desert: {
    terrain: DESERT,
    material: material({
      groundPack: 'rocky_trail_02',
      groundTint: '#ffe2b8',
      groundBrightness: 1.5,
      groundScale: 8,
      cliffPack: 'forest_ground_04',
      cliffTint: '#ffc48a',
      cliffBrightness: 1.2,
      slopeStart: 0.2,
      slopeEnd: 0.45,
    }),
    atmosphere: atmosphere({ rayleighDensity: 0.7, rayleighCoefficients: [8, 13.5, 25], mieDensity: 3, mieG: 0.7, spaceHaze: 0.5 }),
  },
  /** Red rock on the mesas and the cliffs between them. */
  canyonlands: {
    terrain: CANYONLANDS,
    material: material({
      groundPack: 'rocky_trail_02',
      groundBrightness: 1.15,
      cliffPack: 'rocky_trail_02',
      cliffTint: '#ff9c6b',
      cliffBrightness: 1.1,
      cliffSaturation: 1.3,
      slopeStart: 0.1,
      slopeEnd: 0.25,
    }),
    atmosphere: atmosphere({ mieDensity: 1.5 }),
  },
  /** Dry dirt over reddish rills; hazy. */
  badlands: {
    terrain: BADLANDS,
    material: material({
      groundPack: 'forest_ground_04',
      groundTint: '#e6c49c',
      groundBrightness: 1.2,
      cliffPack: 'rocky_trail_02',
      slopeStart: 0.1,
      slopeEnd: 0.28,
    }),
    atmosphere: atmosphere({ mieDensity: 2, mieG: 0.72 }),
  },
  /** Black basalt and ash under a thick, brownish-orange sky. */
  volcanic: {
    terrain: VOLCANIC,
    material: material({
      groundPack: 'rocks_ground_02',
      groundBrightness: 0.45,
      groundSaturation: 0.3,
      cliffPack: 'forest_ground_04',
      cliffBrightness: 0.35,
      cliffSaturation: 0.2,
      ridgeLighten: 1.05,
    }),
    atmosphere: atmosphere({
      rayleighCoefficients: [20, 14, 10],
      mieDensity: 5,
      mieScaleHeight: 9_000,
      mieG: 0.6,
      spaceHaze: 0.55,
    }),
  },
  /** Rock graded to ice and frost; a thin, pale sky. */
  icy: {
    terrain: ICY,
    material: material({
      groundPack: 'rocks_ground_02',
      groundTint: '#dbe9ff',
      groundSaturation: 0.05,
      groundBrightness: 2.6,
      cliffPack: 'rocks_ground_02',
      cliffTint: '#a9c8ff',
      cliffSaturation: 0.2,
      cliffBrightness: 1.5,
      slopeStart: 0.15,
      slopeEnd: 0.35,
    }),
    atmosphere: atmosphere({ height: 40_000, scaleHeight: 8_000, rayleighDensity: 0.15, mieDensity: 0.1 }),
  },
  /** Grey plates under an alien magenta sky. */
  shattered: {
    terrain: SHATTERED,
    material: material({
      groundPack: 'rocks_ground_02',
      groundSaturation: 0.4,
      cliffPack: 'forest_ground_04',
      cliffBrightness: 0.6,
      cliffSaturation: 0.5,
      slopeStart: 0.1,
      slopeEnd: 0.25,
    }),
    atmosphere: atmosphere({ rayleighDensity: 0.6, rayleighCoefficients: [20, 8, 30] }),
  },
  /** Lush green islands, humid haze. */
  archipelago: {
    terrain: ARCHIPELAGO,
    material: material({ groundPack: 'grass_007', cliffPack: 'rocks_ground_02' }),
    atmosphere: atmosphere({ rayleighDensity: 1.2, mieDensity: 2 }),
  },
  /** Teal ground, violet walls, a green sky. */
  foam: {
    terrain: FOAM,
    material: material({
      groundPack: 'grass_004',
      groundTint: '#9ff5e0',
      groundSaturation: 0.6,
      cliffPack: 'rocky_trail_02',
      cliffTint: '#d6a0ff',
      cliffSaturation: 0.4,
      cliffBrightness: 1.3,
    }),
    atmosphere: atmosphere({ rayleighCoefficients: [4, 25, 20] }),
  },
  /** Yellow-green grass to the horizon. */
  flatlands: {
    terrain: FLATLANDS,
    material: material({ groundPack: 'grass_004' }),
    atmosphere: atmosphere({}),
  },
}
