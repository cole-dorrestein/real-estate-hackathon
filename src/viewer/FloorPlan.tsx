import { useState } from 'react'
import type { JSX } from 'react'
import type { Floor, Matter, PlanHit } from '../types'
import {
  formatSpan,
  nameSize,
  planBounds,
  polygonCentroid,
  roomFill,
  wallSegments,
  type Bounds,
} from './geometry'

const WALL = 0.24

type FloorPlanProps = {
  floor: Floor
  title: string
  matters: Matter[]
  focusPinId?: string
  onPinClick?: (pinId: string) => void
  onDropRequest?: (hit: PlanHit) => void
}

export function FloorPlan({ floor, title, matters, focusPinId, onPinClick, onDropRequest }: FloorPlanProps): JSX.Element {
  const bounds = planBounds([floor])
  const padTop = 3.5
  const padSide = 2.8
  const padBottom = 1.8
  const viewX = bounds.minX - padSide
  const viewY = bounds.minZ - padTop
  const viewW = bounds.width + padSide * 2
  const viewH = bounds.depth + padTop + padBottom
  const segments = wallSegments(floor.rooms, WALL)
  const pins = matters.filter((matter) => matter.pin.floorId === floor.id)
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null)

  function dropAt(event: React.MouseEvent<SVGPolygonElement>, roomId: string, roomName: string) {
    event.stopPropagation()
    const point = svgToPlan(event)
    onDropRequest?.({
      position: { x: point?.x ?? bounds.cx, y: floor.elevation, z: point?.z ?? bounds.cz },
      normal: { x: 0, y: 1, z: 0 },
      floorId: floor.id,
      roomId,
      roomName,
    })
  }

  return (
    <svg
      className="plan-svg"
      viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
      role="img"
      aria-label={`${title} plan`}
      data-plan={floor.id}
    >
      <rect x={viewX} y={viewY} width={viewW} height={viewH} fill="#ffffff" />
      {floor.rooms.map((room) => (
        <polygon
          key={room.id}
          points={room.points.map(([x, z]) => `${x},${z}`).join(' ')}
          fill={hoveredRoom === room.id ? '#e3edf6' : roomFill(room.name)}
          stroke="none"
          onPointerEnter={() => setHoveredRoom(room.id)}
          onPointerLeave={() => setHoveredRoom((current) => (current === room.id ? null : current))}
          onClick={(event) => dropAt(event, room.id, room.name)}
        />
      ))}
      {segments.map((segment) => (
        <line
          key={`${segment.x1},${segment.z1},${segment.x2},${segment.z2}`}
          x1={segment.x1}
          y1={segment.z1}
          x2={segment.x2}
          y2={segment.z2}
          stroke="#161616"
          strokeWidth={WALL}
          strokeLinecap="square"
        />
      ))}
      {floor.rooms.map((room) => {
        const [cx, cz] = polygonCentroid(room.points)
        const roomBounds = planBounds([{ ...floor, rooms: [room] }])
        const label = room.name.toUpperCase()
        const font = nameSize(label, roomBounds.width, roomBounds.depth)
        const size = `${formatSpan(roomBounds.width)} X ${formatSpan(roomBounds.depth)}`
        return (
          <g key={`${room.id}-label`} pointerEvents="none">
            <text x={cx} y={cz - font * 0.15} textAnchor="middle" fontSize={font} fontWeight={700} fill="#1a1a1a">
              {label}
            </text>
            <text x={cx} y={cz + font * 0.95} textAnchor="middle" fontSize={font * 0.72} fontWeight={500} fill="#3a3a3a">
              {size}
            </text>
          </g>
        )
      })}
      <Dimension bounds={bounds} />
      <text x={bounds.minX} y={bounds.maxZ + 0.85} fontSize={0.4} fontWeight={700} fill="#111" letterSpacing={0.08}>
        {title.toUpperCase()}
      </text>
      {pins.map((matter) => (
        <PinMarker
          key={matter.pin.id}
          matter={matter}
          focused={focusPinId === matter.pin.id}
          onPinClick={onPinClick}
        />
      ))}
    </svg>
  )
}

function Dimension({ bounds }: { bounds: Bounds }) {
  const y = bounds.minZ - 1.25
  const x = bounds.minX - 1.35
  return (
    <g>
      <line x1={bounds.minX} y1={bounds.minZ} x2={bounds.minX} y2={y - 0.15} stroke="#1c1c1c" strokeWidth={0.02} />
      <line x1={bounds.maxX} y1={bounds.minZ} x2={bounds.maxX} y2={y - 0.15} stroke="#1c1c1c" strokeWidth={0.02} />
      <line x1={bounds.minX} y1={bounds.minZ} x2={x - 0.15} y2={bounds.minZ} stroke="#1c1c1c" strokeWidth={0.02} />
      <line x1={bounds.minX} y1={bounds.maxZ} x2={x - 0.15} y2={bounds.maxZ} stroke="#1c1c1c" strokeWidth={0.02} />
      <DimLine x1={bounds.minX} y1={y} x2={bounds.maxX} y2={y} label={`${bounds.width.toFixed(1)} METERS`} />
      <DimLine x1={x} y1={bounds.minZ} x2={x} y2={bounds.maxZ} label={`${bounds.depth.toFixed(1)} METERS`} />
    </g>
  )
}

function DimLine({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label: string }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const vertical = Math.abs(x2 - x1) < Math.abs(y2 - y1)
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  const nx = (-dy / length) * 0.16
  const ny = (dx / length) * 0.16
  return (
    <g fill="none" stroke="#1c1c1c" strokeWidth={0.03}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - nx} y1={y1 - ny} x2={x1 + nx} y2={y1 + ny} />
      <line x1={x2 - nx} y1={y2 - ny} x2={x2 + nx} y2={y2 + ny} />
      <text
        x={mx}
        y={my - 0.16}
        fill="#1a1a1a"
        stroke="#ffffff"
        strokeWidth={0.1}
        paintOrder="stroke"
        fontSize={0.3}
        fontWeight={600}
        textAnchor="middle"
        transform={vertical ? `rotate(-90 ${mx} ${my - 0.16})` : undefined}
      >
        {label}
      </text>
    </g>
  )
}

function PinMarker({
  matter,
  focused,
  onPinClick,
}: {
  matter: Matter
  focused: boolean
  onPinClick?: (pinId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { x, z } = matter.pin.position
  const color = matter.status === 'dispatched' ? '#2f9e6b' : matter.status === 'triaged' ? '#e09a2b' : '#e23b32'
  const showLabel = hovered || focused
  const width = Math.max(1.6, matter.title.length * 0.15 + 0.45)
  return (
    <g
      transform={`translate(${x} ${z})`}
      style={{ cursor: 'pointer' }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation()
        onPinClick?.(matter.pin.id)
      }}
    >
      <circle r={0.5} fill="none" stroke={color} strokeWidth={0.045} className="pin-ring" />
      <circle r={0.28} fill={color} stroke="#ffffff" strokeWidth={0.07} />
      {showLabel && (
        <g>
          <rect x={-width / 2} y={-1.35} width={width} height={0.46} rx={0.08} fill="#161616" />
          <text x={0} y={-1.02} fill="#ffffff" fontSize={0.24} fontWeight={600} textAnchor="middle">
            {matter.title}
          </text>
        </g>
      )}
    </g>
  )
}

function svgToPlan(event: React.MouseEvent<SVGElement>): { x: number; z: number } | null {
  const svg = event.currentTarget.ownerSVGElement
  const matrix = svg?.getScreenCTM()
  if (!svg || !matrix) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return { x: local.x, z: local.y }
}
