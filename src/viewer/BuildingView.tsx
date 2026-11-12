import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { ContactShadows, Html, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { Floor } from '../types'
import { floorTitle, makeRoomSlab, roomFill, wallBoxes, type Bounds } from './geometry'

const STOREY_HEIGHT = 2.62
const WALL_HEIGHT = 1.05
const WINDOW = '#2c343c'

type BuildingViewProps = {
  floors: Floor[]
  bounds: Bounds
  highlightId: string | null
  onHover: (floorId: string | null) => void
  onSelect: (floorId: string) => void
}

export function BuildingView({ floors, bounds, highlightId, onHover, onSelect }: BuildingViewProps) {
  const highlightIndex = floors.findIndex((floor) => floor.id === highlightId)
  return (
    <>
      <color attach="background" args={['#e7ebef']} />
      <hemisphereLight args={['#f8fafc', '#c5ccd4', 0.55]} />
      <ambientLight intensity={0.35} />
      <KeyLight cx={bounds.cx} cz={bounds.cz} />
      <directionalLight position={[bounds.cx - 10, 8, bounds.cz - 6]} intensity={0.35} color="#f4f7fb" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.cx, -0.04, bounds.cz]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#e6eaee" roughness={1} />
      </mesh>
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

function KeyLight({ cx, cz }: { cx: number; cz: number }) {
  const light = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((state) => state.scene)
  useLayoutEffect(() => {
    const current = light.current
    if (!current) return
    current.target.position.set(cx, 4, cz)
    scene.add(current.target)
    return () => {
      scene.remove(current.target)
    }
  }, [cx, cz, scene])
  return (
    <directionalLight
      ref={light}
      position={[cx + 14, 22, cz + 10]}
      intensity={1.55}
      castShadow
      shadow-mapSize={[1024, 1024]}
      shadow-bias={-0.0006}
      shadow-normalBias={0.045}
      shadow-camera-near={1}
      shadow-camera-far={70}
      shadow-camera-left={-18}
      shadow-camera-right={18}
      shadow-camera-top={18}
      shadow-camera-bottom={-18}
    />
  )
}

function Controls({ cx, cz }: { cx: number; cz: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  useLayoutEffect(() => {
    const current = controls.current
    if (!current) return
    current.target.set(cx, 3.2, cz)
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
      maxDistance={46}
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
        <mesh position={[0, STOREY_HEIGHT / 2, 0]} castShadow receiveShadow raycast={() => null}>
          <boxGeometry args={[bounds.width, STOREY_HEIGHT, bounds.depth]} />
          <meshStandardMaterial color="#f4f5f6" roughness={0.86} metalness={0} />
        </mesh>
        <mesh position={[0, STOREY_HEIGHT, 0]} raycast={() => null}>
          <boxGeometry args={[bounds.width + (isTop ? 0.42 : 0.16), 0.1, bounds.depth + (isTop ? 0.42 : 0.16)]} />
          <meshStandardMaterial color={isTop ? '#fbfbfb' : '#d5dae0'} roughness={0.74} />
        </mesh>
        <lineSegments position={[0, STOREY_HEIGHT / 2, 0]} geometry={edges} raycast={() => null}>
          <lineBasicMaterial color="#b7bec6" />
        </lineSegments>
        <WindowBands width={bounds.width} depth={bounds.depth} />
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

function WindowBands({ width, depth }: { width: number; depth: number }) {
  const y = STOREY_HEIGHT * 0.48
  return (
    <group raycast={() => null}>
      <FaceWindows span={width} along="x" offset={depth / 2 + 0.035} sign={1} y={y} />
      <FaceWindows span={width} along="x" offset={depth / 2 + 0.035} sign={-1} y={y} />
      <FaceWindows span={depth} along="z" offset={width / 2 + 0.035} sign={1} y={y} />
      <FaceWindows span={depth} along="z" offset={width / 2 + 0.035} sign={-1} y={y} />
    </group>
  )
}

function FaceWindows({
  span,
  along,
  offset,
  sign,
  y,
}: {
  span: number
  along: 'x' | 'z'
  offset: number
  sign: 1 | -1
  y: number
}) {
  const count = span > 12 ? 4 : 3
  const margin = span * 0.14
  const usable = span - margin * 2
  const gap = 0.28
  const segment = (usable - gap * (count - 1)) / count
  const start = -usable / 2 + segment / 2
  return (
    <>
      {Array.from({ length: count }, (_, index) => {
        const alongPosition = start + index * (segment + gap)
        const position: [number, number, number] =
          along === 'x' ? [alongPosition, y, sign * offset] : [sign * offset, y, alongPosition]
        const args: [number, number, number] = along === 'x' ? [segment, 0.62, 0.07] : [0.07, 0.62, segment]
        return (
          <mesh key={index} position={position} raycast={() => null}>
            <boxGeometry args={args} />
            <meshStandardMaterial color={WINDOW} roughness={0.22} metalness={0.48} />
          </mesh>
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
