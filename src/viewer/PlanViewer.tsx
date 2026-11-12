import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import * as THREE from 'three'
import type { BuildingPlan, Floor, Matter, PlanViewerProps, Room } from '../types'
import {
  EXTRUDE,
  SLAB_ROTATION,
  WALL_HEIGHT,
  WALL_THICKNESS,
  boundsOf,
  cleanRing,
  isometric,
  polygonCentroid,
  roomColor,
  roomShape,
  visualY,
  wallEdges,
  type Bounds,
  type Frame,
  type WallEdge,
} from './geometry'

type OrbitRig = {
  target: THREE.Vector3
  update: () => void
  enabled: boolean
}

const ignoreRaycast: THREE.Mesh['raycast'] = () => {}

function CameraRig({ frame }: { frame: Frame }) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as unknown as OrbitRig | null
  const frameRef = useRef(frame)
  const mode = useRef<'snap' | 'glide' | 'idle'>('snap')
  const seenKey = useRef<string | null>(null)
  const goalPos = useRef(new THREE.Vector3())
  const goalTarget = useRef(new THREE.Vector3())
  frameRef.current = frame

  useEffect(() => {
    if (seenKey.current === null) {
      seenKey.current = frame.key
      mode.current = 'snap'
      return
    }
    if (seenKey.current !== frame.key) {
      seenKey.current = frame.key
      mode.current = 'glide'
    }
  }, [frame.key])

  useFrame(() => {
    if (!controls) return
    const next = frameRef.current
    goalPos.current.set(next.position[0], next.position[1], next.position[2])
    goalTarget.current.set(next.target[0], next.target[1], next.target[2])
    if (mode.current === 'idle') return
    const gliding = mode.current === 'glide'
    if (gliding) controls.enabled = false
    camera.position.lerp(goalPos.current, gliding ? 0.14 : 1)
    controls.target.lerp(goalTarget.current, gliding ? 0.18 : 1)
    controls.update()
    if (!gliding || camera.position.distanceTo(goalPos.current) < 0.08) {
      camera.position.copy(goalPos.current)
      controls.target.copy(goalTarget.current)
      controls.update()
      controls.enabled = true
      mode.current = 'idle'
    }
  })

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2.08}
      minPolarAngle={0.2}
      minDistance={2.2}
      maxDistance={90}
      onStart={() => {
        mode.current = 'idle'
        if (controls) controls.enabled = true
      }}
    />
  )
}

function RoomSlab({
  room,
  ghost,
  onDrop,
}: {
  room: Room
  ghost: boolean
  onDrop?: (point: THREE.Vector3) => void
}) {
  const shape = useMemo(() => roomShape(room.points), [room.points])
  const [hot, setHot] = useState(false)
  const color = roomColor(room.name)
  const [labelX, labelZ] = useMemo(() => polygonCentroid(room.points), [room.points])

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  return (
    <group>
      <mesh
        rotation={SLAB_ROTATION}
        raycast={ghost ? ignoreRaycast : THREE.Mesh.prototype.raycast}
        onClick={
          ghost
            ? undefined
            : (event) => {
                event.stopPropagation()
                onDrop?.(event.point)
              }
        }
        onPointerOver={
          ghost
            ? undefined
            : (event) => {
                event.stopPropagation()
                setHot(true)
                document.body.style.cursor = 'pointer'
              }
        }
        onPointerOut={
          ghost
            ? undefined
            : () => {
                setHot(false)
                document.body.style.cursor = ''
              }
        }
      >
        <extrudeGeometry args={[shape, EXTRUDE]} />
        <meshStandardMaterial
          color={color}
          roughness={0.78}
          metalness={0}
          side={THREE.DoubleSide}
          emissive={hot ? color : '#000000'}
          emissiveIntensity={hot ? 0.16 : 0}
          transparent={ghost}
          opacity={ghost ? 0.08 : 1}
          depthWrite={!ghost}
        />
      </mesh>
      {ghost ? null : (
        <Html position={[labelX, 0.2, labelZ]} center style={{ pointerEvents: 'none' }} distanceFactor={22}>
          <span className="room-label">{room.name}</span>
        </Html>
      )}
    </group>
  )
}

function WallSegment({ edge, ghost }: { edge: WallEdge; ghost: boolean }) {
  return (
    <mesh
      position={[edge.x, WALL_HEIGHT / 2, edge.z]}
      rotation={[0, edge.rotation, 0]}
      raycast={ignoreRaycast}
    >
      <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, edge.length]} />
      <meshStandardMaterial
        color="#f7f4ee"
        roughness={0.9}
        metalness={0}
        transparent={ghost}
        opacity={ghost ? 0.07 : 1}
        depthWrite={!ghost}
      />
    </mesh>
  )
}

function FloorModel({
  floor,
  index,
  ghost,
  onDropRequest,
}: {
  floor: Floor
  index: number
  ghost: boolean
  onDropRequest?: PlanViewerProps['onDropRequest']
}) {
  const rooms = useMemo(
    () => floor.rooms.map((room) => ({ ...room, points: cleanRing(room.points) })).filter((room) => room.points.length >= 3),
    [floor],
  )
  const edges = useMemo(() => wallEdges(rooms), [rooms])
  const bounds = useMemo(() => boundsOf(rooms.flatMap((room) => room.points)), [rooms])

  return (
    <group position={[0, visualY(floor.elevation, index), 0]}>
      {rooms.map((room) => (
        <RoomSlab
          key={room.id}
          room={room}
          ghost={ghost}
          onDrop={
            onDropRequest
              ? (point) => {
                  onDropRequest({
                    position: { x: point.x, y: floor.elevation, z: point.z },
                    floorId: floor.id,
                    roomId: room.id,
                    roomName: room.name,
                  })
                }
              : undefined
          }
        />
      ))}
      {edges.map((edge) => (
        <WallSegment key={`${edge.x.toFixed(2)}:${edge.z.toFixed(2)}:${edge.rotation.toFixed(3)}`} edge={edge} ghost={ghost} />
      ))}
      {ghost ? null : (
        <Html position={[bounds.maxX + 0.4, WALL_HEIGHT * 0.55, bounds.cz]} center style={{ pointerEvents: 'none' }}>
          <span className="floor-chip">{floor.id}</span>
        </Html>
      )}
    </group>
  )
}

function MatterPin({
  matter,
  plan,
  highlighted,
  ghost,
  onPinClick,
}: {
  matter: Matter
  plan: BuildingPlan
  highlighted: boolean
  ghost: boolean
  onPinClick?: (pinId: string) => void
}) {
  const ring = useRef<THREE.Mesh>(null)
  const [hot, setHot] = useState(false)
  const color = highlighted ? '#ff3b1f' : '#ef5a2a'
  const faded = ghost && !highlighted
  const opacity = faded ? 0.35 : 1
  const floorIndex = plan.floors.findIndex((floor) => floor.id === matter.pin.floorId)
  const y =
    floorIndex >= 0 ? visualY(plan.floors[floorIndex].elevation, floorIndex) + 0.1 : matter.pin.position.y + 0.1

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  useFrame(({ clock }) => {
    const mesh = ring.current
    if (!mesh) return
    const wave = (Math.sin(clock.elapsedTime * 2.6) + 1) / 2
    mesh.scale.setScalar(highlighted ? 1.12 + wave * 0.5 : 1 + wave * 0.22)
    const material = mesh.material
    if (!Array.isArray(material) && material instanceof THREE.MeshBasicMaterial) {
      material.opacity = faded ? 0.12 : (highlighted ? 0.3 : 0.2) + wave * 0.25
    }
  })

  return (
    <group position={[matter.pin.position.x, y, matter.pin.position.z]}>
      <mesh
        raycast={faded ? ignoreRaycast : THREE.Mesh.prototype.raycast}
        onClick={(event) => {
          event.stopPropagation()
          onPinClick?.(matter.pin.id)
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHot(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHot(false)
          document.body.style.cursor = ''
        }}
      >
        <sphereGeometry args={[0.42, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.26, 0]} raycast={ignoreRaycast}>
        <cylinderGeometry args={[0.028, 0.045, 0.52, 12]} />
        <meshStandardMaterial color={color} roughness={0.4} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, 0.58, 0]} scale={highlighted ? 1.22 : 1} raycast={ignoreRaycast}>
        <sphereGeometry args={[0.13, 28, 28]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={highlighted ? 0.7 : 0.32}
          roughness={0.32}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
      <mesh ref={ring} rotation={SLAB_ROTATION} position={[0, 0.03, 0]} raycast={ignoreRaycast}>
        <ringGeometry args={[0.18, 0.3, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {hot || highlighted ? (
        <Html position={[0, 0.92, 0]} center style={{ pointerEvents: 'none' }} distanceFactor={16}>
          <span className="pin-label">{matter.title}</span>
        </Html>
      ) : null}
    </group>
  )
}

function Scene({
  plan,
  matters,
  focusPinId,
  soloFloorId,
  frame,
  bounds,
  onPinClick,
  onDropRequest,
}: {
  plan: BuildingPlan
  matters: Matter[]
  focusPinId?: string
  soloFloorId: string | null
  frame: Frame
  bounds: Bounds
  onPinClick?: PlanViewerProps['onPinClick']
  onDropRequest?: PlanViewerProps['onDropRequest']
}) {
  const top = Math.max(...plan.floors.map((floor, index) => visualY(floor.elevation, index) + WALL_HEIGHT), 4)
  const footprint = Math.max(bounds.spanX, bounds.spanZ, 8)

  return (
    <>
      <color attach="background" args={['#f4f0e8']} />
      <hemisphereLight args={['#fff7ee', '#d5cec2', 0.92]} />
      <ambientLight intensity={0.28} />
      <directionalLight position={[bounds.cx + 12, top + 14, bounds.cz + 8]} intensity={1.4} />
      <directionalLight position={[bounds.cx - 10, top + 6, bounds.cz - 8]} intensity={0.32} color="#e7eef8" />
      {plan.floors.map((floor, index) => (
        <FloorModel
          key={floor.id}
          floor={floor}
          index={index}
          ghost={soloFloorId !== null && soloFloorId !== floor.id}
          onDropRequest={onDropRequest}
        />
      ))}
      {matters.map((matter) => (
        <MatterPin
          key={matter.id}
          matter={matter}
          plan={plan}
          highlighted={matter.pin.id === focusPinId}
          ghost={soloFloorId !== null && soloFloorId !== matter.pin.floorId}
          onPinClick={onPinClick}
        />
      ))}
      <mesh rotation={SLAB_ROTATION} position={[bounds.cx, -0.08, bounds.cz]} raycast={ignoreRaycast}>
        <circleGeometry args={[footprint * 0.95, 64]} />
        <meshStandardMaterial color="#e8e1d4" roughness={1} />
      </mesh>
      <ContactShadows
        position={[bounds.cx, -0.02, bounds.cz]}
        opacity={0.42}
        scale={footprint * 2.6}
        blur={2.4}
        far={top + 4}
        resolution={512}
        frames={1}
        color="#5c5348"
      />
      <CameraRig frame={frame} />
    </>
  )
}

class PlanErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <p className="meta">The 3D plan could not start in this browser.</p>
    }
    return this.props.children
  }
}

function frameFor(
  plan: BuildingPlan,
  matters: Matter[],
  bounds: Bounds,
  soloFloorId: string | null,
  focusPinId: string | undefined,
  cameraIntent: 'all' | 'floor' | 'pin',
): Frame {
  if (cameraIntent === 'pin' && focusPinId) {
    const matter = matters.find((item) => item.pin.id === focusPinId)
    if (matter) {
      const index = plan.floors.findIndex((floor) => floor.id === matter.pin.floorId)
      const y = index >= 0 ? visualY(plan.floors[index].elevation, index) + 0.5 : matter.pin.position.y
      return isometric(
        [matter.pin.position.x, y, matter.pin.position.z],
        5.4,
        `pin:${focusPinId}`,
        1.15,
      )
    }
  }
  if (cameraIntent === 'floor' && soloFloorId) {
    const index = plan.floors.findIndex((floor) => floor.id === soloFloorId)
    const floor = plan.floors[index]
    if (floor) {
      const floorBounds = boundsOf(floor.rooms.flatMap((room) => room.points))
      const y = visualY(floor.elevation, index) + 1.15
      const radius = Math.hypot(floorBounds.spanX / 2, floorBounds.spanZ / 2, WALL_HEIGHT * 0.35)
      return isometric([floorBounds.cx, y, floorBounds.cz], radius, `floor:${soloFloorId}`, 1.55)
    }
  }
  const top = Math.max(...plan.floors.map((floor, index) => visualY(floor.elevation, index) + WALL_HEIGHT), WALL_HEIGHT)
  const radius = Math.hypot(bounds.spanX / 2, bounds.spanZ / 2, top / 2)
  return isometric(
    [bounds.cx, top * 0.5, bounds.cz],
    radius,
    `all:${bounds.cx.toFixed(1)}:${bounds.cz.toFixed(1)}:${radius.toFixed(1)}`,
    1.05,
  )
}

export function PlanViewer({ plan, matters, focusPinId, onPinClick, onDropRequest }: PlanViewerProps): JSX.Element {
  const [soloFloorId, setSoloFloorId] = useState<string | null>(null)
  const [cameraIntent, setCameraIntent] = useState<'all' | 'floor' | 'pin'>(focusPinId ? 'pin' : 'all')
  const bounds = useMemo(() => boundsOf(plan.floors.flatMap((floor) => floor.rooms.flatMap((room) => room.points))), [plan])
  const frame = useMemo(
    () => frameFor(plan, matters, bounds, soloFloorId, focusPinId, cameraIntent),
    [plan, matters, bounds, soloFloorId, focusPinId, cameraIntent],
  )

  useEffect(() => {
    if (!focusPinId) return
    setCameraIntent('pin')
    const matter = matters.find((item) => item.pin.id === focusPinId)
    if (!matter) return
    setSoloFloorId((current) => (current && current !== matter.pin.floorId ? null : current))
  }, [focusPinId, matters])

  function showFloor(id: string | null) {
    setSoloFloorId(id)
    setCameraIntent(id ? 'floor' : 'all')
  }

  return (
    <section className="plan-stage" aria-label="Floor plan">
      <div className="floor-toggle" role="group" aria-label="Floors">
        <button type="button" aria-pressed={soloFloorId === null} onClick={() => showFloor(null)}>
          All
        </button>
        {plan.floors.map((floor) => (
          <button
            key={floor.id}
            type="button"
            aria-pressed={soloFloorId === floor.id}
            onClick={() => showFloor(floor.id)}
          >
            {floor.id}
          </button>
        ))}
      </div>
      <p className="plan-hint">Select a floor, then click a room to drop a pin.</p>
      <PlanErrorBoundary>
        <Canvas
          style={{ position: 'absolute', inset: 0, zIndex: 0 }}
          dpr={[1, 1.75]}
          shadows
          camera={{ position: frame.position, fov: 42, near: 0.1, far: 400 }}
          gl={{
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
          }}
          onCreated={({ camera }) => {
            camera.lookAt(frame.target[0], frame.target[1], frame.target[2])
          }}
        >
          <Scene
            plan={plan}
            matters={matters}
            focusPinId={focusPinId}
            soloFloorId={soloFloorId}
            frame={frame}
            bounds={bounds}
            onPinClick={onPinClick}
            onDropRequest={onDropRequest}
          />
        </Canvas>
      </PlanErrorBoundary>
    </section>
  )
}
