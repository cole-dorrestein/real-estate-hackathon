import { Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Text, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Bounds } from './geometry'
import { asphaltMaterial } from './surfaces'

const CARS = ['/models/sedan.glb', '/models/taxi.glb', '/models/suv.glb', '/models/hatchback-sports.glb'] as const
const FONT = '/fonts/Tinos-Bold.ttf'

for (const url of CARS) useGLTF.preload(url)

export function OfficePark({ bounds, showDressing }: { bounds: Bounds; showDressing: boolean }) {
  return (
    <Suspense fallback={null}>
      <Park bounds={bounds} showDressing={showDressing} />
    </Suspense>
  )
}

function Park({ bounds, showDressing }: { bounds: Bounds; showDressing: boolean }) {
  const front = bounds.maxZ
  const near = front + 2.5
  const far = near + 12
  const lotWidth = bounds.width + 10
  const spots: { url: string; x: number; z: number }[] = []
  const columns = [2.2, 5.6, 16.4, 19.8]
  const rows = [near + 3, near + 8.2]
  let car = 0
  for (const z of rows) {
    for (const x of columns) {
      spots.push({ url: CARS[car % CARS.length], x, z })
      car += 1
    }
  }
  return (
    <group raycast={() => null}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.cx, -0.03, bounds.cz]} receiveShadow raycast={() => null}>
        <planeGeometry args={[90, 90]} />
        <meshStandardMaterial color="#8d9a72" roughness={1} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[bounds.cx, 0.02, front + 1.15]}
        raycast={() => null}
      >
        <planeGeometry args={[bounds.width + 1.2, 2.2]} />
        <meshStandardMaterial color="#d9d3c7" roughness={0.95} />
      </mesh>
      <mesh position={[bounds.cx, 0.08, front + 2.28]} raycast={() => null}>
        <boxGeometry args={[lotWidth, 0.12, 0.28]} />
        <meshStandardMaterial color="#9a958c" roughness={0.9} />
      </mesh>
      <Asphalt width={lotWidth} depth={far - near} position={[bounds.cx, 0.03, (near + far) / 2]} />
      <BayLines near={near} />
      {spots.map((spot) => (
        <Car key={`${spot.url}-${spot.x}-${spot.z}`} url={spot.url} position={[spot.x, 0.32, spot.z]} />
      ))}
      <DockApron />
      <Hedge cx={bounds.cx} front={front} width={bounds.width} />
      <Dressing show={showDressing}>
        <Canopy cx={bounds.cx} front={front} />
        <Sign cx={bounds.cx} front={front} />
      </Dressing>
      <Tree position={[-1.2, 0, front + 0.4]} scale={1.35} />
      <Tree position={[23.4, 0, front + 1.2]} scale={1.7} />
    </group>
  )
}

function BayLines({ near }: { near: number }) {
  const lines = [0.6, 3.9, 7.2, 14.8, 18.1, 21.4]
  return (
    <group raycast={() => null}>
      {lines.map((x) => (
        <mesh key={x} position={[x, 0.045, near + 5.6]} raycast={() => null}>
          <boxGeometry args={[0.08, 0.02, 8.6]} />
          <meshStandardMaterial color="#f4f1ea" roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function Car({ url, position }: { url: string; position: [number, number, number] }) {
  const { scene } = useGLTF(url)
  const object = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) mesh.raycast = () => null
    })
    return clone
  }, [scene])
  return <primitive object={object} position={position} rotation={[0, Math.PI, 0]} />
}

function DockApron() {
  return (
    <mesh position={[-2.2, 0.04, 6.5]} raycast={() => null}>
      <boxGeometry args={[4.2, 0.08, 7.4]} />
      <meshStandardMaterial color="#8b8f94" roughness={0.92} />
    </mesh>
  )
}

function Asphalt({ width, depth, position }: { width: number; depth: number; position: [number, number, number] }) {
  const material = useMemo(() => asphaltMaterial(width, depth), [depth, width])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} raycast={() => null} material={material}>
      <planeGeometry args={[width, depth]} />
    </mesh>
  )
}

function Hedge({ cx, front, width }: { cx: number; front: number; width: number }) {
  const span = Math.max(3, width / 2 - 2.4)
  return (
    <group raycast={() => null}>
      <mesh position={[cx - width / 4 - 0.4, 0.42, front + 0.55]} raycast={() => null}>
        <boxGeometry args={[span, 0.85, 0.42]} />
        <meshStandardMaterial color="#2c6a3c" roughness={0.9} />
      </mesh>
      <mesh position={[cx + width / 4 + 0.4, 0.42, front + 0.55]} raycast={() => null}>
        <boxGeometry args={[span, 0.85, 0.42]} />
        <meshStandardMaterial color="#2c6a3c" roughness={0.9} />
      </mesh>
    </group>
  )
}

function Dressing({ show, children }: { show: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const shown = useRef(show)
  shown.current = show
  useEffect(() => {
    const root = group.current
    if (!root || show) return
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const entry of materials) {
        if (!entry || !('opacity' in entry)) continue
        const material = entry as THREE.MeshStandardMaterial
        material.opacity = 0
        material.transparent = true
        material.depthWrite = false
      }
    })
  }, [show])
  useFrame((_, delta) => {
    const root = group.current
    if (!root || !shown.current) return
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const entry of materials) {
        if (!entry || !('opacity' in entry)) continue
        const material = entry as THREE.MeshStandardMaterial
        material.opacity = THREE.MathUtils.damp(material.opacity, 1, 12, delta)
        material.transparent = material.opacity < 0.98
        material.depthWrite = material.opacity > 0.5
      }
    })
  })
  return (
    <group ref={group} visible={show} raycast={() => null}>
      {children}
    </group>
  )
}

function Canopy({ cx, front }: { cx: number; front: number }) {
  return (
    <mesh position={[cx, 2.45, front + 0.85]} raycast={() => null}>
      <boxGeometry args={[3.6, 0.1, 1.5]} />
      <meshStandardMaterial color="#e7ebed" roughness={0.45} />
    </mesh>
  )
}

function Sign({ cx, front }: { cx: number; front: number }) {
  return (
    <group position={[cx, 8.05, front + 0.18]} raycast={() => null}>
      <mesh raycast={() => null}>
        <boxGeometry args={[8.2, 1.15, 0.08]} />
        <meshStandardMaterial color="#1c3d5a" roughness={0.5} />
      </mesh>
      <Text
        font={FONT}
        position={[0, 0.32, 0.08]}
        fontSize={0.38}
        color="#f6f1e6"
        anchorX="center"
        anchorY="middle"
        raycast={() => null}
      >
        Dunder Mifflin
      </Text>
      <Text
        font={FONT}
        position={[0, -0.28, 0.08]}
        fontSize={0.16}
        color="#f3e6c8"
        anchorX="center"
        anchorY="middle"
        raycast={() => null}
      >
        Paper Company, Inc.
      </Text>
    </group>
  )
}

function Tree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale} raycast={() => null}>
      <mesh position={[0, 0.7, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.12, 0.16, 1.4, 6]} />
        <meshStandardMaterial color="#6b4a32" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.9, 0]} raycast={() => null}>
        <sphereGeometry args={[0.85, 8, 7]} />
        <meshStandardMaterial color="#3f6b45" roughness={0.85} />
      </mesh>
    </group>
  )
}
