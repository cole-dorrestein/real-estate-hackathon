import { OrbitControls, Html } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import * as THREE from 'three'
import type { Floor, Matter, Pin, PlanViewerProps, Room, Vec2, Vec3, Wall } from '../types'

const SLAB = 0.12
const DRAG_PX = 5

function centroid(points: Vec2[]): Vec2 {
  const total = points.reduce<[number, number]>((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
  const count = points.length || 1
  return [total[0] / count, total[1] / count]
}

function pointInRoom(x: number, z: number, points: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]
    const [xj, zj] = points[j]
    const crosses = zi > z !== zj > z
    if (crosses && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function wallKey(wall: Wall): string {
  const a = `${wall.from[0]},${wall.from[1]}`
  const b = `${wall.to[0]},${wall.to[1]}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function uniqueWalls(walls: Wall[]): Wall[] {
  const seen = new Set<string>()
  const unique: Wall[] = []
  for (const wall of walls) {
    const key = wallKey(wall)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(wall)
  }
  return unique
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function roomOnEdge(floor: Floor, wall: Wall, roomName: string): boolean {
  const room = floor.rooms.find((item) => item.name === roomName)
  if (!room) return false
  const points = room.points
  for (let i = 0; i < points.length; i++) {
    const start = points[i]
    const end = points[(i + 1) % points.length]
    if (
      (samePoint(start, wall.from) && samePoint(end, wall.to)) ||
      (samePoint(start, wall.to) && samePoint(end, wall.from))
    ) {
      return true
    }
  }
  return false
}

function roomColor(floorId: string, roomName: string): string {
  if (floorId === 'L2' && roomName === 'Kitchen') return '#f4a261'
  if (roomName === 'Kitchen') return '#f3ddb0'
  if (floorId === 'L2') return '#d5e2ea'
  return '#f4ecdf'
}

function segmentColor(floor: Floor, wall: Wall): string {
  if (floor.id === 'L2' && roomOnEdge(floor, wall, 'Kitchen')) return '#e08a3c'
  return floor.id === 'L2' ? '#93a9b6' : '#c3b49f'
}

function faceNormal(event: ThreeEvent<PointerEvent>): Vec3 | undefined {
  if (!event.face) return undefined
  const normal = event.face.normal.clone().transformDirection(event.object.matrixWorld).normalize()
  return { x: normal.x, y: normal.y, z: normal.z }
}

function roomBeside(rooms: Room[], x: number, z: number, normal?: Vec3): Room | undefined {
  const direct = rooms.find((room) => pointInRoom(x, z, room.points))
  if (direct) return direct
  if (!normal) return undefined
  for (const step of [0.25, 0.5]) {
    const facing = rooms.find((room) => pointInRoom(x + normal.x * step, z + normal.z * step, room.points))
    if (facing) return facing
    const other = rooms.find((room) => pointInRoom(x - normal.x * step, z - normal.z * step, room.points))
    if (other) return other
  }
  return undefined
}

function useStationaryPointer(onClick: (event: ThreeEvent<PointerEvent>) => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onPointerDown(event: ThreeEvent<PointerEvent>) {
      start.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
    },
    onPointerUp(event: ThreeEvent<PointerEvent>) {
      const origin = start.current
      start.current = null
      if (!origin) return
      const dx = event.nativeEvent.clientX - origin.x
      const dy = event.nativeEvent.clientY - origin.y
      if (dx * dx + dy * dy > DRAG_PX * DRAG_PX) return
      event.stopPropagation()
      onClick(event)
    },
    onPointerOver(event: ThreeEvent<PointerEvent>) {
      event.stopPropagation()
      document.body.style.cursor = 'pointer'
    },
    onPointerOut() {
      document.body.style.cursor = ''
    },
  }
}

function useSlabGeometry(points: Vec2[]) {
  return useMemo(() => {
    if (points.length < 3) return new THREE.BufferGeometry()
    const shape = new THREE.Shape()
    points.forEach(([x, y], index) => {
      // Plan [x, y] -> shape (x, -y). rotateX(-PI/2) maps that to world (x, up, y).
      const sy = -y
      if (index === 0) shape.moveTo(x, sy)
      else shape.lineTo(x, sy)
    })
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: SLAB, bevelEnabled: false })
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, -SLAB, 0)
    return geometry
  }, [points])
}

function RoomSlab({
  floor,
  room,
  onDropRequest,
}: {
  floor: Floor
  room: Room
  onDropRequest?: PlanViewerProps['onDropRequest']
}) {
  const geometry = useSlabGeometry(room.points)
  const pointer = useStationaryPointer((event) => {
    onDropRequest?.({
      position: { x: event.point.x, y: event.point.y, z: event.point.z },
      normal: faceNormal(event),
      floorId: floor.id,
      roomId: room.id,
      roomName: room.name,
    })
  })
  if (room.points.length < 3) return null
  return (
    <mesh geometry={geometry} position={[0, floor.elevation, 0]} {...pointer}>
      <meshStandardMaterial color={roomColor(floor.id, room.name)} side={THREE.DoubleSide} flatShading />
    </mesh>
  )
}

function WallSegment({
  floor,
  wall,
  onDropRequest,
}: {
  floor: Floor
  wall: Wall
  onDropRequest?: PlanViewerProps['onDropRequest']
}) {
  const dx = wall.to[0] - wall.from[0]
  const dz = wall.to[1] - wall.from[1]
  const length = Math.hypot(dx, dz)
  const pointer = useStationaryPointer((event) => {
    const normal = faceNormal(event)
    const room = roomBeside(floor.rooms, event.point.x, event.point.z, normal)
    onDropRequest?.({
      position: { x: event.point.x, y: event.point.y, z: event.point.z },
      normal,
      floorId: floor.id,
      roomId: room?.id,
      roomName: room?.name,
    })
  })
  if (length < 1e-4) return null
  const yaw = Math.atan2(-dz, dx)
  return (
    <mesh
      position={[(wall.from[0] + wall.to[0]) / 2, floor.elevation + wall.height / 2 + 0.001, (wall.from[1] + wall.to[1]) / 2]}
      rotation={[0, yaw, 0]}
      {...pointer}
    >
      <boxGeometry args={[length, wall.height, wall.thickness]} />
      <meshStandardMaterial color={segmentColor(floor, wall)} flatShading />
    </mesh>
  )
}

function RoomLabel({ floor, room }: { floor: Floor; room: Room }) {
  const [x, z] = centroid(room.points)
  const kitchen = floor.id === 'L2' && room.name === 'Kitchen'
  return (
    <Html position={[x, floor.elevation + 0.08, z]} center distanceFactor={9} pointerEvents="none" zIndexRange={[2, 0]}>
      <div
        style={{
          font: kitchen ? '700 13px system-ui, sans-serif' : '600 12px system-ui, sans-serif',
          color: kitchen ? '#3a2200' : '#1c1915',
          background: kitchen ? '#ffb703' : 'rgba(255,252,247,0.88)',
          border: kitchen ? '2px solid #e76f51' : '0',
          borderRadius: 999,
          padding: '2px 7px',
          whiteSpace: 'nowrap',
        }}
      >
        {kitchen ? 'L2 Kitchen' : room.name}
      </div>
    </Html>
  )
}

function FloorModel({
  floor,
  showLabels,
  onDropRequest,
}: {
  floor: Floor
  showLabels: boolean
  onDropRequest?: PlanViewerProps['onDropRequest']
}) {
  const walls = useMemo(() => uniqueWalls(floor.walls), [floor.walls])
  return (
    <group>
      {floor.rooms.map((room) => (
        <RoomSlab key={room.id} floor={floor} room={room} onDropRequest={onDropRequest} />
      ))}
      {walls.map((wall) => (
        <WallSegment key={wallKey(wall)} floor={floor} wall={wall} onDropRequest={onDropRequest} />
      ))}
      {showLabels
        ? floor.rooms.map((room) => <RoomLabel key={`${room.id}-label`} floor={floor} room={room} />)
        : null}
    </group>
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
  const { position } = matter.pin
  const pointer = useStationaryPointer((event) => {
    event.stopPropagation()
    onPinClick?.(matter.pin.id)
  })
  const color = focused ? '#ffe14a' : '#e63946'
  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh position={[0, 1.15, 0]} {...pointer}>
        <sphereGeometry args={[focused ? 0.46 : 0.36, 18, 18]} />
        <meshStandardMaterial color={color} emissive={focused ? '#ffbf00' : '#9d1020'} emissiveIntensity={focused ? 0.85 : 0.35} />
      </mesh>
      <mesh position={[0, 0.52, 0]} {...pointer}>
        <cylinderGeometry args={[0.07, 0.09, 1.05, 10]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} {...pointer}>
        <ringGeometry args={[focused ? 0.5 : 0.34, focused ? 0.7 : 0.5, 24]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {focused ? (
        <Html position={[0, 1.85, 0]} center distanceFactor={9} pointerEvents="none" zIndexRange={[2, 0]}>
          <div
            style={{
              font: '700 12px system-ui, sans-serif',
              color: '#3a2200',
              background: '#ffe14a',
              borderRadius: 999,
              padding: '2px 7px',
              whiteSpace: 'nowrap',
            }}
          >
            {matter.title}
          </div>
        </Html>
      ) : null}
    </group>
  )
}

function FlyToPin({ pin }: { pin?: Pin }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const startedFor = useRef<string | undefined>(undefined)
  const anim = useRef<{
    from: THREE.Vector3
    to: THREE.Vector3
    fromTarget: THREE.Vector3
    toTarget: THREE.Vector3
    t: number
  } | null>(null)

  useFrame((_, delta) => {
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null
    if (!pin) {
      startedFor.current = undefined
      return
    }
    if (orbit && startedFor.current !== pin.id) {
      startedFor.current = pin.id
      anim.current = {
        from: camera.position.clone(),
        to: new THREE.Vector3(pin.position.x + 0.4, pin.position.y + 8, pin.position.z + 2.4),
        fromTarget: orbit.target.clone(),
        toTarget: new THREE.Vector3(pin.position.x, pin.position.y + 0.2, pin.position.z),
        t: 0,
      }
    }
    const flight = anim.current
    if (!flight || !orbit) return
    flight.t = Math.min(1, flight.t + delta / 0.75)
    const k = 1 - (1 - flight.t) ** 3
    camera.position.lerpVectors(flight.from, flight.to, k)
    orbit.target.lerpVectors(flight.fromTarget, flight.toTarget, k)
    orbit.update()
    if (flight.t >= 1) anim.current = null
  })

  return null
}

function Scene({
  plan,
  matters,
  focusPinId,
  floorMode,
  onPinClick,
  onDropRequest,
}: PlanViewerProps & { floorMode: string }) {
  const focus = matters.find((matter) => matter.pin.id === focusPinId)?.pin
  const floors = plan.floors.filter((floor) => floorMode === 'all' || floor.id === floorMode)
  const visible = new Set(floors.map((floor) => floor.id))
  return (
    <>
      <color attach="background" args={['#e6e0d4']} />
      <ambientLight intensity={0.82} />
      <directionalLight position={[10, 18, 8]} intensity={1.2} />
      {floors.map((floor) => {
        const covered = floors.some((other) => other.elevation > floor.elevation + 0.2)
        return (
          <FloorModel key={floor.id} floor={floor} showLabels={!covered} onDropRequest={onDropRequest} />
        )
      })}
      {matters
        .filter((matter) => visible.has(matter.pin.floorId))
        .map((matter) => (
          <PinMarker
            key={matter.pin.id}
            matter={matter}
            focused={matter.pin.id === focusPinId}
            onPinClick={onPinClick}
          />
        ))}
      <FlyToPin pin={focus} />
      <OrbitControls
        makeDefault
        enableDamping={false}
        maxPolarAngle={Math.PI / 2.08}
        minDistance={2}
        maxDistance={45}
        target={[6.55, 1.5, 6.9]}
      />
    </>
  )
}

export function PlanViewer(props: PlanViewerProps): JSX.Element {
  const [floorMode, setFloorMode] = useState('all')
  const focusFloorId = props.matters.find((matter) => matter.pin.id === props.focusPinId)?.pin.floorId

  useEffect(() => {
    if (focusFloorId) setFloorMode(focusFloorId)
  }, [props.focusPinId, focusFloorId])

  const modes = ['all', ...props.plan.floors.map((floor) => floor.id)]
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {modes.map((mode) => {
          const active = floorMode === mode
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              onClick={() => setFloorMode(mode)}
              style={active ? undefined : { background: '#e7e0d4', color: '#1c1915' }}
            >
              {mode === 'all' ? 'Both floors' : mode}
            </button>
          )
        })}
        <span className="meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#f4a261', display: 'inline-block' }} />
          L2 kitchen
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          zIndex: 0,
          height: 'min(62dvh, 640px)',
          minHeight: 280,
          overflow: 'hidden',
          borderRadius: 16,
          touchAction: 'none',
          background: '#e6e0d4',
        }}
      >
        <Canvas camera={{ position: [18, 15, 18], fov: 42, near: 0.1, far: 200 }} style={{ width: '100%', height: '100%' }}>
          <Scene
            plan={props.plan}
            matters={props.matters}
            focusPinId={props.focusPinId}
            onPinClick={props.onPinClick}
            onDropRequest={props.onDropRequest}
            floorMode={floorMode}
          />
        </Canvas>
      </div>
    </section>
  )
}
