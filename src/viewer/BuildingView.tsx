import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { Floor } from '../types'
import { floorTitle, makeRoomSlab, roomFill, wallBoxes, warehouseRacks, type Bounds } from './geometry'
import { OfficePark } from './OfficePark'
import { disposeMaterials, storeyMaterials } from './surfaces'

const STOREY_HEIGHT = 2.62
const WALL_HEIGHT = 1.05
const WINDOW = '#1a9aaa'
const TRIM = '#f4f7f8'

type BuildingViewProps = {
  floors: Floor[]
  bounds: Bounds
  highlightId: string | null
  showDressing: boolean
  onHover: (floorId: string | null) => void
  onSelect: (floorId: string) => void
}

export function BuildingView({ floors, bounds, highlightId, showDressing, onHover, onSelect }: BuildingViewProps) {
  const highlightIndex = floors.findIndex((floor) => floor.id === highlightId)
  return (
    <>
      <color attach="background" args={['#d5e3ee']} />
      <hemisphereLight args={['#f4f8fc', '#8d9a72', 0.55]} />
      <ambientLight intensity={0.38} />
      <KeyLight cx={bounds.cx} front={bounds.maxZ} />
      <directionalLight position={[bounds.cx - 12, 10, bounds.maxZ + 6]} intensity={0.28} color="#fff4e5" />
      <OfficePark bounds={bounds} showDressing={showDressing} />
      <FitCamera />
      <mesh position={[bounds.cx, 0.05, bounds.cz]} receiveShadow>
        <boxGeometry args={[bounds.width + 0.9, 0.1, bounds.depth + 0.9]} />
        <meshStandardMaterial color="#c8ced6" roughness={0.92} />
      </mesh>
      {floors.map((floor, index) => (
        <Storey
          key={floor.id}
          floor={floor}
          index={index}
          bounds={bounds}
          role={roleFor(index, highlightIndex)}
          isTop={index === floors.length - 1}
        />
      ))}
      <ContactShadows
        position={[bounds.cx, 0.001, bounds.cz]}
        opacity={0.38}
        scale={Math.max(bounds.width, bounds.depth) * 2.4}
        blur={2.4}
        far={8}
        resolution={512}
        frames={40}
        color="#66707a"
      />
      <Controls cx={bounds.cx} cz={bounds.cz} />
      <FloorPointer floors={floors} bounds={bounds} onHover={onHover} onSelect={onSelect} />
    </>
  )
}

function roleFor(index: number, highlightIndex: number): 'idle' | 'hot' | 'above' | 'below' {
  if (highlightIndex < 0) return 'idle'
  if (index === highlightIndex) return 'hot'
  return index > highlightIndex ? 'above' : 'below'
}

function KeyLight({ cx, front }: { cx: number; front: number }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((state) => state.scene)
  useLayoutEffect(() => {
    const current = light.current
    if (!current) return
    current.target.position.set(cx, 4, front - 6)
    scene.add(current.target)
    return () => {
      scene.remove(current.target)
    }
  }, [cx, front, scene])
  return (
    <directionalLight
      ref={light}
      position={[cx - 8, 18, front + 24]}
      intensity={1.65}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.0006}
      shadow-normalBias={0.04}
      shadow-camera-near={1}
      shadow-camera-far={90}
      shadow-camera-left={-28}
      shadow-camera-right={28}
      shadow-camera-top={24}
      shadow-camera-bottom={-24}
    />
  )
}

function FitCamera() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const width = useThree((state) => state.size.width)
  useLayoutEffect(() => {
    camera.fov = width < 520 ? 50 : 36
    camera.updateProjectionMatrix()
  }, [camera, width])
  return null
}

function Controls({ cx, cz }: { cx: number; cz: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  useLayoutEffect(() => {
    const current = controls.current
    if (!current) return
    current.target.set(cx, 4, cz)
    current.mouseButtons.LEFT = undefined
    current.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
    current.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
    current.touches.ONE = undefined
    current.touches.TWO = THREE.TOUCH.DOLLY_ROTATE
    current.update()
  }, [cx, cz])
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.04}
      minPolarAngle={0.2}
      minDistance={8}
      maxDistance={90}
    />
  )
}

function FloorPointer({
  floors,
  bounds,
  onHover,
  onSelect,
}: {
  floors: Floor[]
  bounds: Bounds
  onHover: (floorId: string | null) => void
  onSelect: (floorId: string) => void
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const hoverRef = useRef(onHover)
  const selectRef = useRef(onSelect)
  hoverRef.current = onHover
  selectRef.current = onSelect

  useEffect(() => {
    const element = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hitPoint = new THREE.Vector3()
    const pointers = new Set<number>()
    let scrubbing = false
    let multi = false
    let current: string | null = null

    const pick = (event: PointerEvent): string | null => {
      const rect = element.getBoundingClientRect()
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)
      let best: { id: string; dist: number } | null = null
      for (const floor of floors) {
        const box = new THREE.Box3(
          new THREE.Vector3(bounds.minX - 0.6, floor.elevation, bounds.minZ - 0.6),
          new THREE.Vector3(bounds.maxX + 0.6, floor.elevation + STOREY_HEIGHT, bounds.maxZ + 0.6),
        )
        const hit = raycaster.ray.intersectBox(box, hitPoint)
        if (!hit) continue
        const dist = hit.distanceTo(raycaster.ray.origin)
        if (!best || dist < best.dist) best = { id: floor.id, dist }
      }
      return best?.id ?? null
    }

    const nearestScreenFloor = (event: PointerEvent): string | null => {
      const rect = element.getBoundingClientRect()
      let best: { id: string; delta: number } | null = null
      for (const floor of floors) {
        const projected = new THREE.Vector3(bounds.cx, floor.elevation + STOREY_HEIGHT * 0.5, bounds.cz).project(camera)
        const screenY = (1 - projected.y) * 0.5 * rect.height + rect.top
        const delta = Math.abs(screenY - event.clientY)
        if (!best || delta < best.delta) best = { id: floor.id, delta }
      }
      return best?.id ?? null
    }

    const setHighlight = (id: string | null) => {
      current = id
      hoverRef.current(id)
      element.style.cursor = id ? 'pointer' : ''
    }

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointers.add(event.pointerId)
      if (pointers.size > 1) {
        scrubbing = false
        multi = true
        return
      }
      const hit = pick(event)
      if (!hit) return
      scrubbing = true
      element.setPointerCapture(event.pointerId)
      setHighlight(hit)
    }

    const onMove = (event: PointerEvent) => {
      if (pointers.size > 1 || multi) return
      if (scrubbing) {
        setHighlight(pick(event) ?? nearestScreenFloor(event))
        return
      }
      if (event.buttons !== 0 || event.pointerType !== 'mouse') return
      setHighlight(pick(event))
    }

    const finish = (event: PointerEvent, commit: boolean) => {
      pointers.delete(event.pointerId)
      if (scrubbing && commit && !multi && current) selectRef.current(current)
      scrubbing = false
      if (pointers.size === 0) {
        multi = false
        if (!commit) setHighlight(null)
      }
    }

    const onUp = (event: PointerEvent) => finish(event, true)
    const onCancel = (event: PointerEvent) => finish(event, false)
    const onLeave = () => {
      if (!scrubbing) setHighlight(null)
    }

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onCancel)
    element.addEventListener('pointerleave', onLeave)
    return () => {
      element.style.cursor = ''
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onCancel)
      element.removeEventListener('pointerleave', onLeave)
    }
  }, [bounds, camera, floors, gl])

  return null
}

function Storey({
  floor,
  index,
  bounds,
  role,
  isTop,
}: {
  floor: Floor
  index: number
  bounds: Bounds
  role: 'idle' | 'hot' | 'above' | 'below'
  isTop: boolean
}) {
  const shell = useRef<THREE.Group>(null)
  const interior = useRef<THREE.Group>(null)
  const roleRef = useRef(role)
  roleRef.current = role
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(bounds.width, STOREY_HEIGHT, bounds.depth)
    const geometry = new THREE.EdgesGeometry(box)
    box.dispose()
    return geometry
  }, [bounds.depth, bounds.width])
  useEffect(() => () => edges.dispose(), [edges])
  useLayoutEffect(() => {
    setTreeOpacity(interior.current, 0, true)
  }, [])

  useFrame((_, delta) => {
    const current = roleRef.current
    const shellTarget = current === 'hot' ? 0 : current === 'above' ? 0.08 : current === 'below' ? 0.7 : 1
    const interiorTarget = current === 'hot' ? 1 : 0
    fadeTree(shell.current, shellTarget, current === 'above' || current === 'hot', delta)
    fadeTree(interior.current, interiorTarget, current !== 'hot', delta)
  })

  return (
    <group position={[bounds.cx, floor.elevation, bounds.cz]}>
      <group ref={shell}>
        <StoreyShell width={bounds.width} depth={bounds.depth} ground={index === 0} hot={role === 'hot'} />
        <mesh position={[0, STOREY_HEIGHT, 0]} raycast={() => null}>
          <boxGeometry args={[bounds.width + 0.22, 0.16, bounds.depth + 0.22]} />
          <meshStandardMaterial color={TRIM} roughness={0.45} />
        </mesh>
        {isTop && <Parapet width={bounds.width} depth={bounds.depth} />}
        <lineSegments position={[0, STOREY_HEIGHT / 2, 0]} geometry={edges} raycast={() => null}>
          <lineBasicMaterial color="#8e969c" />
        </lineSegments>
        <WindowBands width={bounds.width} depth={bounds.depth} ground={index === 0} hot={role === 'hot'} />
        {index === 0 && <DockDoor floor={floor} bounds={bounds} />}
        {index === 0 && <Entrance depth={bounds.depth} />}
      </group>
      <group ref={interior}>
        <FloorInterior floor={floor} bounds={bounds} />
      </group>
      {role === 'hot' && (
        <Html position={[0, STOREY_HEIGHT + 0.45, 0]} center pointerEvents="none" zIndexRange={[8, 0]}>
          <div className="floor-tag">{floorTitle(index)}</div>
        </Html>
      )}
    </group>
  )
}

function FloorInterior({ floor, bounds }: { floor: Floor; bounds: Bounds }) {
  const slabs = useMemo(
    () =>
      floor.rooms.map((room) => ({
        id: room.id,
        color: roomFill(room.name),
        geometry: makeRoomSlab(room.points, bounds.cx, bounds.cz),
      })),
    [bounds.cx, bounds.cz, floor.rooms],
  )
  const walls = useMemo(() => wallBoxes(floor.rooms), [floor.rooms])
  const wallGeometry = useMemo(() => {
    const geometry = new THREE.BoxGeometry(0.16, WALL_HEIGHT, 1)
    geometry.translate(0, WALL_HEIGHT / 2, 0)
    return geometry
  }, [])
  useEffect(
    () => () => {
      for (const slab of slabs) slab.geometry.dispose()
      wallGeometry.dispose()
    },
    [slabs, wallGeometry],
  )
  return (
    <group position={[0, 0.08, 0]}>
      {slabs.map((slab) => (
        <mesh key={slab.id} geometry={slab.geometry} raycast={() => null}>
          <meshStandardMaterial color={slab.color} roughness={0.84} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {warehouseRacks(floor.rooms).map((rack) => (
        <mesh
          key={`rack-${rack.x}-${rack.z}`}
          position={[rack.x + rack.w / 2 - bounds.cx, 0.8, rack.z + rack.d / 2 - bounds.cz]}
          raycast={() => null}
        >
          <boxGeometry args={[rack.w, 1.6, rack.d]} />
          <meshStandardMaterial color="#8d7356" roughness={0.8} />
        </mesh>
      ))}
      {walls.map((wall) => (
        <mesh
          key={`${wall.x.toFixed(2)}:${wall.z.toFixed(2)}:${wall.rotationY.toFixed(3)}`}
          geometry={wallGeometry}
          position={[wall.x - bounds.cx, 0, wall.z - bounds.cz]}
          rotation={[0, wall.rotationY, 0]}
          scale={[1, 1, wall.length]}
          raycast={() => null}
        >
          <meshStandardMaterial color="#24282d" roughness={0.72} />
        </mesh>
      ))}
    </group>
  )
}

function Parapet({ width, depth }: { width: number; depth: number }) {
  const y = STOREY_HEIGHT + 0.32
  const t = 0.22
  return (
    <group raycast={() => null}>
      <mesh position={[0, y, depth / 2]} raycast={() => null}>
        <boxGeometry args={[width + 0.5, 0.55, t]} />
        <meshStandardMaterial color="#d5dadd" roughness={0.72} />
      </mesh>
      <mesh position={[0, y, -depth / 2]} raycast={() => null}>
        <boxGeometry args={[width + 0.5, 0.55, t]} />
        <meshStandardMaterial color="#d5dadd" roughness={0.72} />
      </mesh>
      <mesh position={[width / 2, y, 0]} raycast={() => null}>
        <boxGeometry args={[t, 0.55, depth]} />
        <meshStandardMaterial color="#d5dadd" roughness={0.72} />
      </mesh>
      <mesh position={[-width / 2, y, 0]} raycast={() => null}>
        <boxGeometry args={[t, 0.55, depth]} />
        <meshStandardMaterial color="#d5dadd" roughness={0.72} />
      </mesh>
    </group>
  )
}

function DockDoor({ floor, bounds }: { floor: Floor; bounds: Bounds }) {
  const dock = floor.rooms.find((room) => room.id === 'loading_dock')
  if (!dock) return null
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [, z] of dock.points) {
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const z = (minZ + maxZ) / 2 - bounds.cz
  return (
    <group position={[-bounds.width / 2 - 0.06, 1.25, z]} raycast={() => null}>
      <mesh raycast={() => null}>
        <boxGeometry args={[0.12, 2.5, 4.4]} />
        <meshStandardMaterial color="#4e555c" roughness={0.55} metalness={0.35} />
      </mesh>
      {Array.from({ length: 6 }, (_, index) => (
        <mesh key={index} position={[0.08, -1 + index * 0.36, 0]} raycast={() => null}>
          <boxGeometry args={[0.04, 0.08, 4.1]} />
          <meshStandardMaterial color="#2c3136" metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

function StoreyShell({ width, depth, ground, hot }: { width: number; depth: number; ground: boolean; hot: boolean }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(width, STOREY_HEIGHT, depth), [depth, width])
  const materials = useMemo(() => storeyMaterials(width, STOREY_HEIGHT, depth, ground), [depth, ground, width])
  useEffect(
    () => () => {
      geometry.dispose()
      disposeMaterials(materials)
    },
    [geometry, materials],
  )
  useEffect(() => {
    for (const material of materials) {
      material.emissive = new THREE.Color(hot ? '#d7e4ee' : '#000000')
      material.emissiveIntensity = hot ? 0.22 : 0
    }
  }, [hot, materials])
  return <mesh geometry={geometry} material={materials} position={[0, STOREY_HEIGHT / 2, 0]} castShadow receiveShadow raycast={() => null} />
}

function Entrance({ depth }: { depth: number }) {
  return (
    <group position={[0, 1.15, depth / 2 + 0.07]} raycast={() => null}>
      <mesh position={[0, 0, -0.04]} raycast={() => null}>
        <boxGeometry args={[1.85, 2.35, 0.06]} />
        <meshStandardMaterial color={TRIM} roughness={0.4} />
      </mesh>
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0, 0.02]} raycast={() => null}>
          <boxGeometry args={[0.7, 2.1, 0.04]} />
          <meshStandardMaterial color={WINDOW} metalness={0.72} roughness={0.08} />
        </mesh>
      ))}
    </group>
  )
}

function WindowBands({ width, depth, ground, hot }: { width: number; depth: number; ground: boolean; hot: boolean }) {
  const y = ground ? STOREY_HEIGHT * 0.46 : STOREY_HEIGHT * 0.4
  const color = hot ? '#b7ecec' : WINDOW
  if (ground) {
    return (
      <group raycast={() => null}>
        <FaceWindows span={width * 0.34} along="x" offset={depth / 2 + 0.05} sign={1} y={y} count={2} shift={-width * 0.28} color={color} />
        <FaceWindows span={width * 0.34} along="x" offset={depth / 2 + 0.05} sign={1} y={y} count={2} shift={width * 0.28} color={color} />
      </group>
    )
  }
  return (
    <group raycast={() => null}>
      <FaceWindows span={width} along="x" offset={depth / 2 + 0.05} sign={1} y={y} color={color} />
      <FaceWindows span={width} along="x" offset={depth / 2 + 0.05} sign={-1} y={y} color={color} />
      <FaceWindows span={depth} along="z" offset={width / 2 + 0.05} sign={1} y={y} color={color} />
      <FaceWindows span={depth} along="z" offset={width / 2 + 0.05} sign={-1} y={y} color={color} />
    </group>
  )
}

function FaceWindows({
  span,
  along,
  offset,
  sign,
  y,
  count: countProp,
  shift = 0,
  color,
}: {
  span: number
  along: 'x' | 'z'
  offset: number
  sign: 1 | -1
  y: number
  count?: number
  shift?: number
  color: string
}) {
  const count = countProp ?? (span > 16 ? 4 : 3)
  const margin = span * 0.1
  const usable = span - margin * 2
  const gap = 0.55
  const segment = (usable - gap * (count - 1)) / count
  const start = -usable / 2 + segment / 2 + shift
  const paneH = span > 10 ? 1.12 : 1.0
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        const at = start + index * (segment + gap)
        const frame: [number, number, number] = along === 'x' ? [at, y, sign * offset] : [sign * offset, y, at]
        const frameSize: [number, number, number] = along === 'x' ? [segment, paneH, 0.08] : [0.08, paneH, segment]
        const glassSize: [number, number, number] = along === 'x' ? [segment - 0.16, paneH - 0.16, 0.05] : [0.05, paneH - 0.16, segment - 0.16]
        const glassShift = sign * 0.03
        const glass: [number, number, number] =
          along === 'x' ? [frame[0], frame[1], frame[2] + glassShift] : [frame[0] + glassShift, frame[1], frame[2]]
        return (
          <group key={index} raycast={() => null}>
            <mesh position={frame} raycast={() => null}>
              <boxGeometry args={frameSize} />
              <meshStandardMaterial color={TRIM} roughness={0.35} />
            </mesh>
            <mesh position={glass} raycast={() => null}>
              <boxGeometry args={glassSize} />
              <meshStandardMaterial color={color} metalness={0.78} roughness={0.08} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

function setTreeOpacity(root: THREE.Object3D | null, opacity: number, ghost: boolean) {
  if (!root) return
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isLineSegments?: boolean }
    if (!mesh.isMesh && !mesh.isLineSegments) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const entry of materials) {
      if (!entry || !('opacity' in entry)) continue
      const material = entry as THREE.MeshStandardMaterial
      material.opacity = opacity
      material.transparent = ghost || opacity < 0.98
      material.depthWrite = !ghost && opacity > 0.45
    }
  })
}

function fadeTree(root: THREE.Object3D | null, target: number, ghost: boolean, delta: number) {
  if (!root) return
  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isLineSegments?: boolean }
    if (!mesh.isMesh && !mesh.isLineSegments) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const entry of materials) {
      if (!entry || !('opacity' in entry)) continue
      const material = entry as THREE.MeshStandardMaterial
      material.opacity = THREE.MathUtils.damp(material.opacity, target, 14, delta)
      const seeThrough = ghost || material.opacity < 0.98
      const writeDepth = !ghost && material.opacity > 0.45
      if (material.transparent !== seeThrough || material.depthWrite !== writeDepth) {
        material.transparent = seeThrough
        material.depthWrite = writeDepth
        material.needsUpdate = true
      }
    }
  })
}
