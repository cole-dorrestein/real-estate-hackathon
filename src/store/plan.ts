import { useSyncExternalStore } from 'react'
import demoPlan from '../data/demo-plan.json'
import type { BuildingPlan } from '../types'
import { loadUploadedPlan, saveUploadedPlan } from '../upload/planFile'

const seedPlan = demoPlan as unknown as BuildingPlan
let snapshot: BuildingPlan | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getBuildingPlan(): BuildingPlan {
  if (!snapshot) snapshot = loadUploadedPlan() ?? seedPlan
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
