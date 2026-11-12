import { useEffect, useRef, useState, type JSX } from 'react'
import { getDispatchJob } from '../agent/dispatch'
import { triageMatter } from '../agent/triage'
import type { DispatchJob } from '../agent/types'
import { navigate } from '../shell/router'
import { getMattersStore, useMatters } from '../store/matters'
import type { Matter } from '../types'
import { dispatchLabel, formatWhen, isTerminalJob, takeTriageResult } from './agent'
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
  const [chip, setChip] = useState('all')
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

  const shown = ranked.filter((matter) => chip === 'all' || (chip === 'open' ? matter.status !== 'dispatched' : chip === 'visit' ? jobs[matter.id]?.status === 'visit_agreed' : chip === 'failed' ? jobs[matter.id]?.status === 'failed' : matter.status === 'dispatched' && jobs[matter.id]?.status !== 'visit_agreed' && jobs[matter.id]?.status !== 'failed'))

  return (
    <section className="card dashboard">
      <div className="dash-bar">
        <h1>Matters</h1>
        <div className="actions">
          <button type="button" onClick={() => void triageAll()} disabled={busy || openCount === 0}>
            {busy ? 'Triaging…' : 'Triage all'}
          </button>
        </div>
      </div>
      {note ? (
        <p className="note-error" role="status">
          {note}
        </p>
      ) : null}
      <div className="filters" role="group" aria-label="Filter matters">
        {(
          [
            ['all', 'All'],
            ['open', 'Open'],
            ['dispatched', 'Dispatched'],
            ['visit', 'Visit booked'],
            ['failed', 'Failed'],
          ] as const
        ).map(([id, text]) => (
          <button key={id} type="button" className="filter-chip" aria-pressed={chip === id} onClick={() => setChip(id)}>
            {text}
          </button>
        ))}
      </div>
      {ranked.length === 0 ? (
        <p>No matters yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="matter-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Title</th>
                <th>Location</th>
                <th>Trade</th>
                <th>Contractor</th>
                <th>Status</th>
                <th>Visit</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((matter) => {
                const to = `/dashboard/matters/${encodeURIComponent(matter.id)}`
                const job = matter.status === 'dispatched' ? (jobs[matter.id] ?? null) : null
                const label = job
                  ? dispatchLabel(job)
                  : matter.status === 'dispatched'
                    ? { text: 'Dispatched', error: undefined }
                    : null
                const contractor = job?.contractorName ?? matter.dispatch?.contractorName ?? matter.brief?.contractorName
                return (
                  <tr key={matter.id} className="matter-row">
                    <td>
                      <span className={`chip chip-${matter.triage?.priority ?? 'none'}`}>{matter.triage?.priority ?? '—'}</span>
                    </td>
                    <td>
                      <a
                        className="matter-link"
                        href={to}
                        onClick={(event) => {
                          event.preventDefault()
                          navigate(to)
                        }}
                      >
                        <span className="title">{matter.title}</span>
                      </a>
                    </td>
                    <td>{place(matter)}</td>
                    <td>{matter.triage?.trade ?? '—'}</td>
                    <td>{contractor ?? '—'}</td>
                    <td>
                      {label ? (
                        <span className="dispatch-line">
                          <span className={`badge badge-${job?.status ?? 'dispatched'}`}>{label.text}</span>
                          {label.error ? <span className="note-error">{label.error}</span> : null}
                        </span>
                      ) : (
                        <span className={`chip chip-status-${matter.status}`}>{matter.status}</span>
                      )}
                    </td>
                    <td>{job?.visitAt ? formatWhen(job.visitAt) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {shown.length === 0 ? <p className="meta">No matters in this view.</p> : null}
        </div>
      )}
    </section>
  )
}
