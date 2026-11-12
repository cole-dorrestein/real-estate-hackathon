import * as THREE from 'three'
import type { Room, Vec2 } from '../types'

export const WALL_THICKNESS = 0.15
export const WALL_HEIGHT = 2.7
const EXPLODE = 1.6
const STACK_GAP = 2.2

export const SLAB_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0]

export const EXTRUDE: THREE.ExtrudeGeometryOptions = {
  depth: 0.08,
  bevelEnabled: true,
  bevelThickness: 0.012,
  bevelSize: 0.01,
  bevelSegments: 1,
  curveSegments: 1,
}

export type Bounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  cx: number
  cz: number
  spanX: number
  spanZ: number
}

export type WallEdge = { x: number; z: number; length: number; rotation: number }

export type Frame = {
  key: string
  position: [number, number, number]
  target: [number, number, number]
}

// elevation * 1.6, plus a gap per floor index, so L1–L4 stay separated.
export function visualY(elevation: number, index: number): number {
  return elevation * EXPLODE + index * STACK_GAP
}

export function roomColor(name: string): string {
  const label = name.toLowerCase()
  if (label.includes('kitchen')) return '#f0c9a0'
  if (label.includes('bed')) return '#c9d7ee'
  if (label.includes('living') || label.includes('lounge')) return '#ead9bf'
  if (label.includes('bath') || label.includes('wc') || label.includes('toilet')) return '#c5e3dc'
  if (label.includes('balcon') || label.includes('terrace') || label.includes('patio')) return '#d5e3c4'
  if (label.includes('dining')) return '#f3d2c3'
  if (label.includes('hall') || label.includes('corridor') || label.includes('entry')) return '#e7e1d6'
  if (label.includes('office') || label.includes('study')) return '#d4d0e6'
  if (label.includes('closet') || label.includes('storage') || label.includes('utility')) return '#ddd6cc'
  return '#e4ddd2'
}

export function cleanRing(points: Vec2[]): Vec2[] {
  const deduped: Vec2[] = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.04) continue
    deduped.push(point)
  }
  if (deduped.length > 1) {
    const first = deduped[0]
    const last = deduped[deduped.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.04) deduped.pop()
  }
  const simplified: Vec2[] = []
  const count = deduped.length
  for (let index = 0; index < count; index += 1) {
    const prev = deduped[(index - 1 + count) % count]
    const current = deduped[index]
    const next = deduped[(index + 1) % count]
    const ax = current[0] - prev[0]
    const az = current[1] - prev[1]
    const bx = next[0] - current[0]
    const bz = next[1] - current[1]
    const denom = Math.hypot(ax, az) * Math.hypot(bx, bz)
    const cross = Math.abs(ax * bz - az * bx)
    if (denom > 1e-6 && cross / denom < 0.03) continue
    simplified.push(current)
  }
  if (simplified.length >= 3) return simplified
  if (deduped.length >= 3) return deduped
  return points
}

// Shape is built in XY and rotated flat. Negating z keeps plan +z as world +z.
export function roomShape(points: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape()
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z)
    else shape.lineTo(x, -z)
  })
  shape.closePath()
  return shape
}

export function polygonCentroid(points: Vec2[]): [number, number] {
  let twice = 0
  let cx = 0
  let cz = 0
  for (let index = 0; index < points.length; index += 1) {
    const [x0, z0] = points[index]
    const [x1, z1] = points[(index + 1) % points.length]
    const cross = x0 * z1 - x1 * z0
    twice += cross
    cx += (x0 + x1) * cross
    cz += (z0 + z1) * cross
  }
  if (Math.abs(twice) < 1e-6) {
    const count = points.length || 1
    const sum = points.reduce<[number, number]>((total, point) => [total[0] + point[0], total[1] + point[1]], [0, 0])
    return [sum[0] / count, sum[1] / count]
  }
  return [cx / (3 * twice), cz / (3 * twice)]
}

export function boundsOf(points: Vec2[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minX)) {
    return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, cx: 0, cz: 0, spanX: 10, spanZ: 10 }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    spanX: Math.max(maxX - minX, 0.1),
    spanZ: Math.max(maxZ - minZ, 0.1),
  }
}

export function wallEdges(rooms: Room[]): WallEdge[] {
  const seen = new Set<string>()
  const edges: WallEdge[] = []
  const token = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`
  for (const room of rooms) {
    const points = room.points
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]
      const end = points[(index + 1) % points.length]
      const dx = end[0] - start[0]
      const dz = end[1] - start[1]
      const length = Math.hypot(dx, dz)
      if (length < 0.08) continue
      const a = token(start[0], start[1])
      const b = token(end[0], end[1])
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) continue
      seen.add(key)
      const span = length > WALL_THICKNESS * 1.4 ? length - WALL_THICKNESS : length
      edges.push({
        x: (start[0] + end[0]) / 2,
        z: (start[1] + end[1]) / 2,
        length: span,
        rotation: Math.atan2(dx, dz),
      })
    }
  }
  return edges
}

export function isometric(target: [number, number, number], radius: number, key: string, lift: number): Frame {
  const fov = (42 * Math.PI) / 180
  const dist = (Math.max(radius, 1.5) / Math.tan(fov / 2)) * 1.28
  const offset = new THREE.Vector3(1, lift, 1).normalize().multiplyScalar(dist)
  return {
    key,
    target,
    position: [target[0] + offset.x, target[1] + offset.y, target[2] + offset.z],
  }
}
