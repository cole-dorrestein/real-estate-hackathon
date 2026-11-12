import type { JSX } from 'react'
import demoPlan from '../data/demo-plan.json'
import type { BuildingPlan } from '../types'

export function PlanUploader({
  onPlanReady,
}: {
  onPlanReady: (plan: BuildingPlan) => void
}): JSX.Element {
  return (
    <section className="card">
      <h1>Upload plan</h1>
      <p>F5 replaces this stub. The button below loads the seed plan.</p>
      <button type="button" onClick={() => onPlanReady(demoPlan as unknown as BuildingPlan)}>
        Use seed plan
      </button>
    </section>
  )
}
