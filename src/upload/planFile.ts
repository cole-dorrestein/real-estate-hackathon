import type { BuildingPlan } from '../types'

export const UPLOADED_PLAN_STORAGE_KEY = 'pm.plan.v1'

function isBuildingPlan(value: unknown): value is BuildingPlan {
  return typeof value === 'object' && value !== null && Array.isArray((value as BuildingPlan).floors)
}

export function loadUploadedPlan(): BuildingPlan | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(UPLOADED_PLAN_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isBuildingPlan(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveUploadedPlan(plan: BuildingPlan): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(UPLOADED_PLAN_STORAGE_KEY, JSON.stringify(plan))
}
