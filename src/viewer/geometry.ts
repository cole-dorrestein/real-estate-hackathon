import * as THREE from 'three'
import type { BuildingPlan, Floor, Room, Vec2 } from '../types'

export type Bounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  width: number
  depth: number
  cx: number
  cz: number
}

export type Segment = { x1: number; z1: number; x2: number; z2: number }

const STOREY_ELEVATION = 3

export function cleanRing(points: Vec2[]): Vec2[] {
  const ring: Vec2[] = []
  for (const point of points) {
    const prev = ring[ring.length - 1]
    if (prev && Math.hypot(point[0] - prev[0], point[1] - prev[1]) < 1e-4) continue
    ring.push(point)
  }
  if (ring.length > 1) {
    const first = ring[0]
    const last = ring[ring.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-4) ring.pop()
  }
  return ring
}

export function boundsOf(points: Vec2[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 12, minZ: 0, maxZ: 12, width: 12, depth: 12, cx: 6, cz: 6 }
  }
  const width = Math.max(maxX - minX, 0.01)
  const depth = Math.max(maxZ - minZ, 0.01)
  return { minX, maxX, minZ, maxZ, width, depth, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

export function planBounds(floors: Floor[]): Bounds {
  return boundsOf(floors.flatMap((floor) => floor.rooms.flatMap((room) => room.points)))
}

export function pointInPolygon(x: number, z: number, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]
    const zi = polygon[i][1]
    const xj = polygon[j][0]
    const zj = polygon[j][1]
    const crosses = zi > z !== zj > z
    if (crosses && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function polygonCentroid(points: Vec2[]): Vec2 {
  const ring = cleanRing(points)
  let area = 0
  let cx = 0
  let cz = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]
    const [x2, z2] = ring[(i + 1) % ring.length]
    const cross = x1 * z2 - x2 * z1
    area += cross
    cx += (x1 + x2) * cross
    cz += (z1 + z2) * cross
  }
  area *= 0.5
  if (Math.abs(area) < 1e-5 || ring.length === 0) return [0, 0]
  const centroid: Vec2 = [cx / (6 * area), cz / (6 * area)]
  if (pointInPolygon(centroid[0], centroid[1], ring)) return centroid
  const average: Vec2 = [0, 0]
  for (const point of ring) {
    average[0] += point[0]
    average[1] += point[1]
  }
  average[0] /= ring.length
  average[1] /= ring.length
  return average
}

function edgeKey(a: Vec2, b: Vec2): string {
  const quant = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3)
  const left = `${quant(a[0])},${quant(a[1])}`
  const right = `${quant(b[0])},${quant(b[1])}`
  return left < right ? `${left}|${right}` : `${right}|${left}`
}

export function wallSegments(rooms: Room[], thickness = 0.24): Segment[] {
  const seen = new Set<string>()
  const segments: Segment[] = []
  const extra = thickness / 2
  for (const room of rooms) {
    const ring = cleanRing(room.points)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length = Math.hypot(dx, dz)
      if (length < 0.06) continue
      const key = edgeKey(a, b)
      if (seen.has(key)) continue
      seen.add(key)
      const ux = dx / length
      const uz = dz / length
      segments.push({
        x1: a[0] - ux * extra,
        z1: a[1] - uz * extra,
        x2: b[0] + ux * extra,
        z2: b[1] + uz * extra,
      })
    }
  }
  return segments
}

export function roomFill(name: string): string {
  const label = name.toLowerCase()
  if (label.includes('rest') || label.includes('bath') || label.includes('wc')) return '#e7eef3'
  if (label.includes('kitchen')) return '#f6f1e6'
  if (label.includes('break')) return '#f3ead7'
  if (label.includes('dock')) return '#e4ddd2'
  if (label.includes('warehouse')) return '#ece7df'
  if (label.includes('reception')) return '#f7f4ee'
  if (label.includes('bullpen')) return '#f3f0e8'
  if (label.includes('manager')) return '#efe4d4'
  if (label.includes('conference')) return '#e6eef3'
  if (label.includes('account')) return '#f7f1e4'
  if (label.includes('annex')) return '#f4efe6'
  if (label.includes('corridor') || label.includes('stair') || label.includes('elevator')) return '#e6e2da'
  if (label.includes('vacant')) return '#f4f4f2'
  if (label.includes('suite')) return '#f6f3ee'
  if (label.includes('bed') || label.includes('primary')) return '#f4f5f7'
  if (label.includes('living') || label.includes('lounge')) return '#f7f6f3'
  if (label.includes('balcony') || label.includes('porch') || label.includes('terrace')) return '#eef2ee'
  return '#f7f7f5'
}

const FLOOR_NAMES = ['Warehouse', 'Offices', 'Suites']

export function floorTitle(index: number): string {
  const name = FLOOR_NAMES[index]
  return name ? `Floor ${index + 1} · ${name}` : `Floor ${index + 1}`
}

export function warehouseRacks(rooms: Room[]): { x: number; z: number; w: number; d: number }[] {
  const room = rooms.find((entry) => entry.id === 'warehouse')
  if (!room) return []
  const box = boundsOf(room.points)
  const racks: { x: number; z: number; w: number; d: number }[] = []
  const depth = 1.05
  const length = 3.5
  for (let z = box.minZ + 1.3; z + depth < box.maxZ - 0.7; z += 2.25) {
    for (let x = box.minX + 0.8; x + length < box.maxX - 0.5; x += length + 0.75) {
      racks.push({ x, z, w: length, d: depth })
    }
  }
  return racks
}

const FLOOR_THREE_NAMES: Record<string, string> = {
  living_0: 'Lounge',
  bedroom_0: 'Primary',
  bathroom_1: 'Ensuite',
}

function mirrorRooms(rooms: Room[], cx: number): Room[] {
  return rooms.map((room) => ({
    id: room.id,
    name: FLOOR_THREE_NAMES[room.id] ?? room.name,
    points: room.points.map(([x, z]) => {
      const mirrored = Math.round((2 * cx - x) * 1000) / 1000
      return [mirrored, z] as Vec2
    }),
  }))
}

export function floorsForViewer(plan: BuildingPlan): Floor[] {
  const sorted = [...plan.floors].sort((a, b) => a.elevation - b.elevation)
  const withRooms = sorted.filter((floor) => floor.rooms.length > 0)
  const source = withRooms.length > 0 ? withRooms : sorted
  const levels = source.slice(0, 3).map((floor, index) => ({ ...floor, elevation: index * STOREY_ELEVATION }))
  if (levels.length >= 3 || !levels[0]) return levels
  const template = levels[0]
  const bounds = boundsOf(template.rooms.flatMap((room) => room.points))
  while (levels.length < 3) {
    const index = levels.length
    levels.push({
      id: `L${index + 1}`,
      elevation: index * STOREY_ELEVATION,
      walls: [],
      rooms: index === 2 ? mirrorRooms(template.rooms, bounds.cx) : template.rooms.map((room) => ({ ...room, points: room.points.map((point) => [...point] as Vec2) })),
    })
  }
  return levels
}

export function formatSpan(metres: number): string {
  return `${metres.toFixed(1)}M`
}

export type WallBox = { x: number; z: number; rotationY: number; length: number }

export function wallBoxes(rooms: Room[]): WallBox[] {
  const seen = new Set<string>()
  const boxes: WallBox[] = []
  const thickness = 0.16
  for (const room of rooms) {
    const ring = cleanRing(room.points)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length = Math.hypot(dx, dz)
      if (length < 0.08) continue
      const key = edgeKey(a, b)
      if (seen.has(key)) continue
      seen.add(key)
      boxes.push({
        x: (a[0] + b[0]) / 2,
        z: (a[1] + b[1]) / 2,
        rotationY: Math.atan2(dx, dz),
        length: length + thickness,
      })
    }
  }
  return boxes
}

export function makeRoomSlab(points: Vec2[], originX: number, originZ: number): THREE.BufferGeometry {
  const ring = cleanRing(points)
  const fallback = new THREE.BoxGeometry(0.2, 0.05, 0.2)
  if (ring.length < 3) return fallback
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const x1 = ring[i][0] - originX
    const y1 = -(ring[i][1] - originZ)
    const x2 = ring[(i + 1) % ring.length][0] - originX
    const y2 = -(ring[(i + 1) % ring.length][1] - originZ)
    area += x1 * y2 - x2 * y1
  }
  const ordered = area < 0 ? [...ring].reverse() : ring
  const shape = new THREE.Shape()
  ordered.forEach(([x, z], index) => {
    const sx = x - originX
    const sy = -(z - originZ)
    if (index === 0) shape.moveTo(sx, sy)
    else shape.lineTo(sx, sy)
  })
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  fallback.dispose()
  return geometry
}

export function nameSize(name: string, width: number, depth: number): number {
  const byWidth = (width * 0.82) / Math.max(name.length, 1) / 0.58
  const byDepth = depth * 0.2
  return Math.max(0.17, Math.min(0.42, byWidth, byDepth))
}
