/**
 * The terrain texture packs the material can use, by key. Any folder under
 * `public/textures/terrain/` with an albedo, a **GL** (not DX) normal map and a
 * height map works; add a line here and it shows up in the planet panel. Maps are
 * resized to the albedo's size on load.
 */
const ROOT = `${import.meta.env.BASE_URL}textures/terrain/`

export type TexturePack = { readonly albedo: string; readonly normal: string; readonly height: string }

function pack(folder: string, albedo: string, normal: string, height: string): TexturePack {
  return { albedo: `${ROOT}${folder}/${albedo}`, normal: `${ROOT}${folder}/${normal}`, height: `${ROOT}${folder}/${height}` }
}

export const TEXTURE_PACKS: Readonly<Record<string, TexturePack>> = {
  grass_001: pack('Grass001_1K-PNG', 'Grass001_1K-PNG_Color.png', 'Grass001_1K-PNG_NormalGL.png', 'Grass001_1K-PNG_Displacement.png'),
  grass_004: pack('Grass004_1K-PNG', 'Grass004_1K-PNG_Color.png', 'Grass004_1K-PNG_NormalGL.png', 'Grass004_1K-PNG_Displacement.png'),
  grass_007: pack('Grass007_1K-PNG', 'Grass007_1K-PNG_Color.png', 'Grass007_1K-PNG_NormalGL.png', 'Grass007_1K-PNG_Displacement.png'),
  forest_ground_04: pack('forest_ground_04_1k', 'forest_ground_04_diff_1k.png', 'forest_ground_04_nor_gl_1k.png', 'forest_ground_04_disp_1k.png'),
  rocks_ground_02: pack('rocks_ground_02_1k', 'rocks_ground_02_col_1k.png', 'rocks_ground_02_nor_gl_1k.png', 'rocks_ground_02_height_1k.png'),
  rocky_trail_02: pack('rocky_trail_02_1k', 'rocky_trail_02_diff_1k.png', 'rocky_trail_02_nor_gl_1k.png', 'rocky_trail_02_disp_1k.png'),
}

export const TEXTURE_PACK_KEYS: readonly string[] = Object.keys(TEXTURE_PACKS)
