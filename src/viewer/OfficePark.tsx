import { Suspense, useMemo } from 'react'
import { Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Bounds } from './geometry'

const CARS = ['/models/sedan.glb', '/models/taxi.glb', '/models/suv.glb', '/models/hatchback-sports.glb'] as const
const FONT = '/fonts/Tinos-Bold.ttf'

for (const url of CARS) useGLTF.preload(url)

export function OfficePark({ bounds }: { bounds: Bounds }) {
  return (
    <Suspense fallback={null}>
      <Park bounds={bounds} />
    </Suspense>
  )
}

function Park({ bounds }: { bounds: Bounds }) {
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.cx, 0.03, (near + far) / 2]} raycast={() => null}>
        <planeGeometry args={[lotWidth, far - near]} />
        <meshStandardMaterial color="#5e646c" roughness={0.96} />
      </mesh>
      <BayLines near={near} />
      {spots.map((spot) => (
        <Car key={`${spot.url}-${spot.x}-${spot.z}`} url={spot.url} position={[spot.x, 0.32, spot.z]} />
      ))}
      <DockApron />
      <Canopy cx={bounds.cx} front={front} />
      <Sign cx={bounds.cx} front={front} />
      <Tree position={[-1.2, 0, front + 0.2]} scale={1.25} />
      <Tree position={[23.2, 0, front + 0.2]} scale={1.15} />
      <Tree position={[-1.6, 0, near + 6]} scale={0.9} />
      <Tree position={[23.4, 0, near + 6.5]} />
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

function Canopy({ cx, front }: { cx: number; front: number }) {
  return (
    <group position={[cx, 0, front]} raycast={() => null}>
      <mesh position={[-1.6, 1.15, 1.05]} raycast={() => null}>
        <boxGeometry args={[0.08, 2.3, 0.08]} />
        <meshStandardMaterial color="#d5d8dc" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[1.6, 1.15, 1.05]} raycast={() => null}>
        <boxGeometry args={[0.08, 2.3, 0.08]} />
        <meshStandardMaterial color="#d5d8dc" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 2.35, 1.15]} raycast={() => null}>
        <boxGeometry args={[4.4, 0.08, 2.4]} />
        <meshStandardMaterial color="#b7dbe6" transparent opacity={0.45} roughness={0.05} metalness={0.15} depthWrite={false} />
      </mesh>
    </group>
  )
}

function Sign({ cx, front }: { cx: number; front: number }) {
  return (
    <group position={[cx, 4.85, front + 0.16]} raycast={() => null}>
      <mesh raycast={() => null}>
        <boxGeometry args={[8.4, 1.85, 0.1]} />
        <meshStandardMaterial color="#1c3d5a" roughness={0.55} />
      </mesh>
      <Text
        font={FONT}
        position={[0, 0.32, 0.08]}
        fontSize={0.52}
        color="#f6f1e6"
        anchorX="center"
        anchorY="middle"
        raycast={() => null}
      >
        Dunder Mifflin
      </Text>
      <Text
        font={FONT}
        position={[0, -0.38, 0.08]}
        fontSize={0.22}
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
