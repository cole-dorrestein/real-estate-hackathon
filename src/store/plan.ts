import { useSyncExternalStore } from 'react'
import demoPlan from '../data/demo-plan.json'
import type { BuildingPlan } from '../types'
import { loadUploadedPlan, saveUploadedPlan } from '../upload/planFile'

const seedPlan = demoPlan as unknown as BuildingPlan

const DEMO_FLOORS: { id: string; elevation: number }[] = [
  { id: 'L1', elevation: 0 },
  { id: 'L2', elevation: 3 },
  { id: 'L3', elevation: 6 },
  { id: 'L4', elevation: 9 },
]

// ResPlan is a single plate. The demo repeats L1 so the viewer can show four storeys.
function fourStoreyDemo(plan: BuildingPlan): BuildingPlan {
  const template = plan.floors.find((floor) => floor.id === 'L1') ?? plan.floors[0]
  if (!template) return plan
  return {
    ...plan,
    floors: DEMO_FLOORS.map((spec) => {
      const existing = plan.floors.find((floor) => floor.id === spec.id)
      const source = existing ?? template
      return { ...source, id: spec.id, elevation: spec.elevation }
    }),
  }
}

let snapshot: BuildingPlan | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getBuildingPlan(): BuildingPlan {
  if (!snapshot) snapshot = loadUploadedPlan() ?? fourStoreyDemo(seedPlan)
  return snapshot
}

export function setActivePlan(plan: BuildingPlan): void {
  snapshot = plan
  saveUploadedPlan(plan)
  emit()
}

export function useBuildingPlan(): BuildingPlan {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => getBuildingPlan(),
  )
}
