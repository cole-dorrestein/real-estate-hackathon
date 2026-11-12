import * as THREE from 'three'

const PANEL_METRES = 3.3

function canvasTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function speckledCanvas(width: number, height: number, base: [number, number, number], amount: number, speckles: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return canvas
  context.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`
  context.fillRect(0, 0, width, height)
  const image = context.getImageData(0, 0, width, height)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * amount
    data[i] = clamp(data[i] + noise)
    data[i + 1] = clamp(data[i + 1] + noise)
    data[i + 2] = clamp(data[i + 2] + noise)
  }
  for (let n = 0; n < speckles; n += 1) {
    const index = (Math.floor(Math.random() * width * height)) * 4
    const tone = 150 + Math.random() * 90
    data[index] = tone
    data[index + 1] = tone
    data[index + 2] = tone - 8
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value))
}

let panelCanvas: HTMLCanvasElement | null = null
function panelSource(): HTMLCanvasElement {
  if (panelCanvas) return panelCanvas
  panelCanvas = speckledCanvas(64, 128, [206, 210, 214], 10, 40)
  const context = panelCanvas.getContext('2d')
  if (context) {
    context.strokeStyle = '#9aa1a8'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(1, 0)
    context.lineTo(1, 128)
    context.stroke()
  }
  return panelCanvas
}

let graniteCanvas: HTMLCanvasElement | null = null
function graniteSource(): HTMLCanvasElement {
  if (!graniteCanvas) graniteCanvas = speckledCanvas(128, 128, [122, 118, 112], 28, 700)
  return graniteCanvas
}

let asphaltCanvas: HTMLCanvasElement | null = null
function asphaltSource(): HTMLCanvasElement {
  if (!asphaltCanvas) asphaltCanvas = speckledCanvas(128, 128, [74, 78, 82], 22, 500)
  return asphaltCanvas
}

function mapped(canvas: HTMLCanvasElement, repeatX: number, repeatY: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: canvasTexture(canvas, repeatX, repeatY),
    roughness,
    metalness: 0.02,
  })
}

export function storeyMaterials(width: number, height: number, depth: number, ground: boolean): THREE.MeshStandardMaterial[] {
  const face = ground
    ? mapped(graniteSource(), width / 1.6, height / 1.6, 0.92)
    : mapped(panelSource(), width / PANEL_METRES, 1, 0.84)
  const side = ground
    ? mapped(graniteSource(), depth / 1.6, height / 1.6, 0.92)
    : mapped(panelSource(), depth / PANEL_METRES, 1, 0.84)
  const cap = new THREE.MeshStandardMaterial({ color: ground ? '#6e6b66' : '#c5c9cc', roughness: 0.9 })
  return [side, side, cap, cap, face, face]
}

export function asphaltMaterial(width: number, depth: number): THREE.MeshStandardMaterial {
  return mapped(asphaltSource(), width / 3.5, depth / 3.5, 0.96)
}

export function disposeMaterials(materials: THREE.Material[]): void {
  const seen = new Set<THREE.Material>()
  for (const material of materials) {
    if (seen.has(material)) continue
    seen.add(material)
    const mappedMaterial = material as THREE.MeshStandardMaterial
    mappedMaterial.map?.dispose()
    material.dispose()
  }
}
