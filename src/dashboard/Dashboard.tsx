import { useEffect, useRef, useState, type JSX } from 'react'
import { getDispatchJob } from '../agent/dispatch'
import { triageMatter } from '../agent/triage'
import type { DispatchJob } from '../agent/types'
import { navigate } from '../shell/router'
import { getMattersStore, useMatters } from '../store/matters'
import type { Matter } from '../types'
import { formatWhen, isTerminalJob, takeTriageResult } from './agent'
import './dashboard.css'

function priorityRank(matter: Matter): number {
  if (!matter.triage) return 4
  if (matter.triage.priority === 'P1') return 0
  if (matter.triage.priority === 'P2') return 1
  if (matter.triage.priority === 'P3') return 2
  return 3
}

function rankMatters(matters: Matter[]): Matter[] {
  return [...matters].sort((a, b) => {
    const byPriority = priorityRank(a) - priorityRank(b)
    if (byPriority !== 0) return byPriority
    return b.createdAt.localeCompare(a.createdAt)
  })
}

function place(matter: Matter): string {
  const room = matter.pin.roomName || matter.pin.roomId
  return room ? `${matter.pin.floorId} ${room}` : matter.pin.floorId
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

export function Dashboard(): JSX.Element {
  const matters = useMatters()
  const ranked = rankMatters(matters)
  const [jobs, setJobs] = useState<Record<string, DispatchJob | null>>({})
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const openCount = matters.filter((matter) => !matter.triage).length
  const pollKey = matters
    .filter((matter) => matter.status === 'dispatched')
    .map((matter) => matter.id)
    .sort()
    .join('|')

  useEffect(() => {
    if (!pollKey) return
    let cancelled = false
    let timer = 0
    let running = false

    const tick = async () => {
      if (running) return
      running = true
      try {
        const ids = pollKey.split('|').filter((id) => !isTerminalJob(jobsRef.current[id]))
        if (ids.length === 0) {
          window.clearInterval(timer)
          return
        }
        const updates: Record<string, DispatchJob | null> = {}
        for (const id of ids) {
          try {
            updates[id] = await getDispatchJob(id)
          } catch (err) {
            if (!cancelled) setNote(errorText(err))
          }
        }
        if (!cancelled) {
          setJobs((current) => ({ ...current, ...updates }))
        }
      } finally {
        running = false
      }
    }

    void tick()
    timer = window.setInterval(() => void tick(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollKey])

  async function triageAll() {
    setBusy(true)
    setNote(null)
    try {
      const ids = getMattersStore()
        .list()
        .filter((matter) => !matter.triage)
        .map((matter) => matter.id)
      for (const id of ids) {
        const current = getMattersStore().get(id)
        if (!current || current.triage) continue
        const picked = takeTriageResult(await triageMatter(current))
        const updatedAt = new Date().toISOString()
        getMattersStore().upsert({
          ...current,
          id: current.id,
          title: current.title,
          description: current.description,
          pin: current.pin,
          sources: current.sources,
          createdAt: current.createdAt,
          status: 'triaged',
          triage: picked.triage,
          brief: picked.brief,
          updatedAt,
        })
      }
    } catch (err) {
      setNote(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    { id: 'new', title: 'New issues', description: 'Ready for review' },
    { id: 'ready', title: 'Ready to call', description: 'Triaged and ready' },
    { id: 'calling', title: 'Call requested', description: 'Awaiting an update' },
    { id: 'contacted', title: 'Contacted', description: 'Call connected' },
    { id: 'booked', title: 'Visit booked', description: 'Next steps agreed' },
    { id: 'attention', title: 'Needs attention', description: 'Call needs review' },
  ] as const
  function stage(matter: Matter): string {
    const job = jobs[matter.id]
    if (matter.callError || job?.status === 'failed') return 'attention'
    if (job?.status === 'visit_agreed') return 'booked'
    if (job?.status === 'contacted') return 'contacted'
    if (matter.status === 'dispatched') return 'calling'
    return matter.triage ? 'ready' : 'new'
  }

  return (
    <section className="dashboard">
      <div className="dash-bar">
        <div><p className="board-eyebrow">PROPERTY OPERATIONS</p><h1>Matters pipeline</h1><p className="meta">Track issues from report to resolution.</p></div>
        <button type="button" onClick={() => void triageAll()} disabled={busy || openCount === 0}>
          {busy ? 'Triaging…' : 'Triage all new issues'}
        </button>
      </div>
      {note ? <p className="note-error" role="status">{note}</p> : null}
      <div className="matter-board" aria-label="Matter pipeline">
        {columns.map((column) => {
          const items = ranked.filter((matter) => stage(matter) === column.id)
          return <section className={`board-column board-${column.id}`} key={column.id} aria-label={column.title}>
            <div className="board-column-heading"><span className="board-dot" /><h2>{column.title}</h2><span className="board-count">{items.length}</span></div>
            <p className="board-description">{column.description}</p>
            <div className="board-cards">
              {items.map((matter) => {
                const to = `/dashboard/matters/${encodeURIComponent(matter.id)}`
                const job = jobs[matter.id]
                return <a className="board-card" key={matter.id} href={to} onClick={(event) => { event.preventDefault(); navigate(to) }}>
                  <div className="board-card-top"><span className="board-trade">{matter.triage?.trade ?? matter.issueType ?? 'General'}</span><span className={`chip chip-${matter.triage?.priority ?? 'none'}`}>{matter.triage?.priority ?? 'New'}</span></div>
                  <strong>{matter.title}</strong>
                  <p>{matter.description}</p>
                  <div className="board-card-footer"><span>{place(matter)}</span>{matter.sources.some((source) => source.kind === 'photo') ? <span>Photo attached</span> : null}</div>
                  {job?.visitAt ? <span className="board-call-detail">Visit: {formatWhen(job.visitAt)}</span> : null}
                  {matter.callError || job?.error ? <span className="note-error">{matter.callError || job?.error}</span> : null}
                </a>
              })}
              {items.length === 0 ? <p className="board-empty">No matters here</p> : null}
            </div>
          </section>
        })}
      </div>
    </section>
  )
}
