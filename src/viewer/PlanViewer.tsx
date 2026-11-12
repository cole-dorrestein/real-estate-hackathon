import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlanViewerProps } from '../types'
import { BuildingView } from './BuildingView'
import { FloorPlan } from './FloorPlan'
import { floorTitle, floorsForViewer, planBounds } from './geometry'
import './viewer.css'

export function PlanViewer({ plan, matters, focusPinId, onPinClick, onDropRequest }: PlanViewerProps): JSX.Element {
  const floors = useMemo(() => floorsForViewer(plan), [plan])
  const bounds = useMemo(() => planBounds(floors), [floors])
  const mattersRef = useRef(matters)
  mattersRef.current = matters
  const [selectedId, setSelectedId] = useState<string | null>(() => floorIdForPin(focusPinId, matters))
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(() => floorIdForPin(focusPinId, matters) === null)

  function openFloor(floorId: string) {
    setShowHint(false)
    setSelectedId(floorId)
  }

  useEffect(() => {
    if (!focusPinId) return
    const floorId = floorIdForPin(focusPinId, mattersRef.current)
    if (floorId) setSelectedId(floorId)
  }, [focusPinId])

  const selectedIndex = floors.findIndex((floor) => floor.id === selectedId)
  const selected = selectedIndex >= 0 ? floors[selectedIndex] : null
  const cameraPosition: [number, number, number] = [
    bounds.cx - bounds.width * 0.95,
    8.4,
    bounds.maxZ + 30,
  ]

  return (
    <section className={selected ? 'viewer-shell is-plan' : 'viewer-shell'} aria-label="Building viewer">
      <div className="viewer-stage" style={{ touchAction: 'none' }}>
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: cameraPosition, fov: 36, near: 0.1, far: 240 }}
          gl={{ antialias: true }}
          onCreated={({ camera, gl }) => {
            camera.lookAt(bounds.cx, 4, bounds.cz)
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.08
          }}
        >
          <BuildingView floors={floors} bounds={bounds} highlightId={selected ? null : hoveredId} onHover={setHoveredId} onSelect={openFloor} />
        </Canvas>
      </div>
      {selected && (
        <div className="plan-stage" key={selected.id}>
          <FloorPlan
            floor={selected}
            title={floorTitle(selectedIndex)}
            matters={matters}
            focusPinId={focusPinId}
            onPinClick={onPinClick}
            onDropRequest={onDropRequest}
          />
        </div>
      )}
      <div className="viewer-toolbar">
        {selected && (
          <button type="button" className="viewer-chip viewer-back" onClick={() => setSelectedId(null)}>
            Back to building
          </button>
        )}
        {floors.map((floor, index) => (
          <button
            key={floor.id}
            type="button"
            className={hoveredId === floor.id && !selected ? 'viewer-chip is-hot' : 'viewer-chip'}
            aria-pressed={selectedId === floor.id}
            onClick={() => openFloor(floor.id)}
          >
            {floorTitle(index)}
          </button>
        ))}
      </div>
      {!selected && showHint && (
        <p className="viewer-hint">Drag up and down the building to pick a floor, then release to open it</p>
      )}
    </section>
  )
}

function floorIdForPin(focusPinId: string | undefined, matters: PlanViewerProps['matters']): string | null {
  if (!focusPinId) return null
  return matters.find((matter) => matter.pin.id === focusPinId)?.pin.floorId ?? null
}
