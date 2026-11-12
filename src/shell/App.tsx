import { useState } from 'react'
import { CapturePanel } from '../capture/CapturePanel'
import { Dashboard } from '../dashboard/Dashboard'
import { MatterDetail } from '../dashboard/MatterDetail'
import { getMattersStore, useMatters } from '../store/matters'
import { setActivePlan, useBuildingPlan } from '../store/plan'
import type { Matter, PlanHit } from '../types'
import { PlanUploader } from '../upload/PlanUploader'
import { PlanViewer } from '../viewer/PlanViewer'
import { navigate, useRoute } from './router'

export function App() {
  const route = useRoute()
  const plan = useBuildingPlan()
  const matters = useMatters()
  const [pendingHit, setPendingHit] = useState<PlanHit | null>(null)
  const onDashboard = route.name === 'dashboard' || route.name === 'matter'

  function onSave(input: {
    title: string
    description: string
    sources: Matter['sources']
    pin: Matter['pin']
  }) {
    const now = new Date().toISOString()
    const matter: Matter = {
      id: `matter-${crypto.randomUUID()}`,
      title: input.title,
      description: input.description,
      pin: input.pin,
      sources: input.sources,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }
    getMattersStore().upsert(matter)
    setPendingHit(null)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">PM Copilot</div>
        <nav>
          <a
            href="/"
            aria-current={route.name === 'capture' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigate('/')
            }}
          >
            Plan
          </a>
          <a
            href="/dashboard"
            aria-current={onDashboard ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigate('/dashboard')
            }}
          >
            Dashboard
          </a>
          <a
            href="/upload"
            aria-current={route.name === 'upload' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigate('/upload')
            }}
          >
            Upload
          </a>
        </nav>
      </aside>
      <div className="workspace">
        <main>
        {route.name === 'matter' ? (
          <MatterDetail matterId={route.matterId} />
        ) : route.name === 'dashboard' ? (
          <Dashboard />
        ) : route.name === 'upload' ? (
          <PlanUploader
            onPlanReady={(next) => {
              setActivePlan(next)
              navigate('/')
            }}
          />
        ) : (
          <div className="capture-layout">
            <PlanViewer
              plan={plan}
              matters={matters}
              focusPinId={route.pinId}
              onPinClick={(pinId) => navigate(`/?pin=${encodeURIComponent(pinId)}`)}
              onDropRequest={setPendingHit}
            />
            <CapturePanel
              pendingHit={pendingHit}
              onCancel={() => setPendingHit(null)}
              onSave={onSave}
            />
          </div>
        )}
        </main>
      </div>
    </div>
  )
}
