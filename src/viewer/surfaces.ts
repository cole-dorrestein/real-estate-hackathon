import * as THREE from 'three'

// 1K CC0 PBR sets from Poly Haven, vendored into public/textures/.
// `size` is the real-world width of one texture tile in metres (from Poly Haven's metadata),
// so repeats are always expressed in metres and every surface keeps a true scale.
// Some albedos were tonally adjusted when vendored: concrete_wall_008 and granite_tile are
// desaturated/levelled to keep the grey tilt-up look, dirty_carpet and concrete_floor_worn_001
// are brightened so the opened floor still reads as a light plan.
export const PBR = {
  facade: { slug: 'concrete_wall_008', size: 2.71 },
  granite: { slug: 'granite_tile', size: 2.3 },
  asphalt: { slug: 'asphalt_02', size: 3 },
  wood: { slug: 'wood_floor', size: 1.7 },
  carpet: { slug: 'dirty_carpet', size: 1.2 },
  tiles: { slug: 'floor_tiles_06', size: 3 },
  concrete: { slug: 'concrete_floor_worn_001', size: 3 },
  plaster: { slug: 'painted_plaster_wall', size: 2 },
  metal: { slug: 'metal_plate', size: 1 },
} as const

export type PbrKey = keyof typeof PBR
type MapKind = 'diff' | 'nor_gl' | 'rough'

const loader = new THREE.TextureLoader()
const sources = new Map<string, THREE.Texture>()
const pending = new Map<string, Set<THREE.Texture>>()
const shared = new Map<string, THREE.Texture>()

function textureUrl(key: PbrKey, kind: MapKind): string {
  const { slug } = PBR[key]
  return `/textures/${slug}_${kind}_1k.jpg`
}

// One network load per file. Each caller gets its own Texture that shares the file's Source,
// so it can carry its own repeat; textures made before the image arrives are flagged on load.
function sourceTexture(url: string): THREE.Texture {
  const cached = sources.get(url)
  if (cached) return cached
  const waiting = new Set<THREE.Texture>()
  pending.set(url, waiting)
  const texture = loader.load(url, () => {
    for (const clone of waiting) clone.needsUpdate = true
    waiting.clear()
    pending.delete(url)
  })
  sources.set(url, texture)
  return texture
}

function configure(texture: THREE.Texture, kind: MapKind, repeatX: number, repeatY: number): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.anisotropy = 8
  // Only albedo is colour data; normal and roughness maps must stay linear.
  texture.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  return texture
}

function textureFor(key: PbrKey, kind: MapKind, repeatX: number, repeatY: number): THREE.Texture {
  const url = textureUrl(key, kind)
  const source = sourceTexture(url)
  // Not Texture.clone(): copy() bumps the version, which makes three try to upload an image
  // that has not arrived yet. Sharing the Source keeps one decode and one GPU upload per file.
  const clone = new THREE.Texture()
  clone.source = source.source
  configure(clone, kind, repeatX, repeatY)
  clone.userData.pbrOwned = true
  const waiting = pending.get(url)
  if (waiting) waiting.add(clone)
  else clone.needsUpdate = true
  return clone
}

export type PbrMaps = { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

/** Maps whose repeat is given in metres of surface (width x height of the face). Caller owns them. */
export function pbrMaps(key: PbrKey, widthMetres: number, heightMetres: number): PbrMaps {
  const size = PBR[key].size
  const rx = widthMetres / size
  const ry = heightMetres / size
  return {
    map: textureFor(key, 'diff', rx, ry),
    normalMap: textureFor(key, 'nor_gl', rx, ry),
    roughnessMap: textureFor(key, 'rough', rx, ry),
  }
}

/**
 * Maps for geometry whose UVs are already in metres (ExtrudeGeometry caps, world-UV boxes).
 * These are cached and shared app-wide, so they are never disposed by material disposal.
 */
export function worldPbrMaps(key: PbrKey): PbrMaps {
  const size = PBR[key].size
  const get = (kind: MapKind) => {
    const id = `${key}:${kind}`
    let texture = shared.get(id)
    if (!texture) {
      texture = textureFor(key, kind, 1 / size, 1 / size)
      texture.userData.pbrOwned = false
      shared.set(id, texture)
    }
    return texture
  }
  return { map: get('diff'), normalMap: get('nor_gl'), roughnessMap: get('rough') }
}

function pbrMaterial(
  key: PbrKey,
  widthMetres: number,
  heightMetres: number,
  options: { color?: THREE.ColorRepresentation; roughness?: number; normalScale?: number } = {},
): THREE.MeshStandardMaterial {
  const scale = options.normalScale ?? 1
  return new THREE.MeshStandardMaterial({
    ...pbrMaps(key, widthMetres, heightMetres),
    color: options.color ?? '#ffffff',
    roughness: options.roughness ?? 1,
    metalness: 0,
    normalScale: new THREE.Vector2(scale, scale),
  })
}

export function storeyMaterials(width: number, height: number, depth: number, ground: boolean): THREE.MeshStandardMaterial[] {
  const key: PbrKey = ground ? 'granite' : 'facade'
  const tint = ground ? '#d6d0c8' : '#eef1f3'
  const face = pbrMaterial(key, width, height, { color: tint, normalScale: 0.8 })
  const side = pbrMaterial(key, depth, height, { color: tint, normalScale: 0.8 })
  const cap = new THREE.MeshStandardMaterial({ color: ground ? '#6e6b66' : '#c5c9cc', roughness: 0.9 })
  return [side, side, cap, cap, face, face]
}

export function asphaltMaterial(width: number, depth: number): THREE.MeshStandardMaterial {
  return pbrMaterial('asphalt', width, depth, { color: '#9aa0a6', normalScale: 0.7 })
}

/** Floor finish for a room, chosen from its name. */
export function floorFinish(name: string): PbrKey {
  const label = name.toLowerCase()
  if (label.includes('warehouse') && !label.includes('office')) return 'concrete'
  if (label.includes('dock') || label.includes('stair')) return 'concrete'
  if (label.includes('rest') || label.includes('bath') || label.includes('wc') || label.includes('kitchen') || label.includes('break')) {
    return 'tiles'
  }
  if (label.includes('reception') || label.includes('manager') || label.includes('conference')) return 'wood'
  return 'carpet'
}

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'alphaMap',
] as const

export function disposeMaterials(materials: THREE.Material[]): void {
  const seen = new Set<THREE.Material>()
  for (const material of materials) {
    if (seen.has(material)) continue
    seen.add(material)
    const slots = material as unknown as Record<string, THREE.Texture | null | undefined>
    for (const slot of TEXTURE_SLOTS) {
      const texture = slots[slot]
      // Shared world-UV maps stay cached; per-material clones are released here.
      if (texture && texture.userData.pbrOwned) texture.dispose()
    }
    material.dispose()
  }
}
