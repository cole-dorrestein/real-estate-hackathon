import { useEffect, useRef, useState, type JSX } from 'react'
import { navigate } from '../shell/router'
import { getMattersStore, useMatters } from '../store/matters'
import type { Matter } from '../types'
import {
  dispatchLabel,
  isTerminalJob,
  loadDispatch,
  loadTriage,
  takeTriageResult,
  toPublicJob,
  type DispatchJob,
} from './agent'
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
    let cancelled = false
    void (async () => {
      try {
        const triage = await loadTriage()
        const dispatch = await loadDispatch()
        if (cancelled) return
        if (triage === 'pending' || dispatch === 'pending') setNote('Agent pending')
      } catch (err) {
        if (!cancelled) setNote(errorText(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
        const dispatch = await loadDispatch()
        if (cancelled) return
        if (dispatch === 'pending') {
          setNote('Agent pending')
          window.clearInterval(timer)
          return
        }
        const updates: Record<string, DispatchJob | null> = {}
        for (const id of ids) {
          try {
            updates[id] = toPublicJob(await dispatch.getDispatchJob(id))
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
      const triage = await loadTriage()
      if (triage === 'pending') {
        setNote('Agent pending')
        return
      }
      const ids = getMattersStore()
        .list()
        .filter((matter) => !matter.triage)
        .map((matter) => matter.id)
      for (const id of ids) {
        const current = getMattersStore().get(id)
        if (!current || current.triage) continue
        const picked = takeTriageResult(await triage.triageMatter(current))
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

  return (
    <section className="card dashboard">
      <h1>Matters</h1>
      <div className="actions">
        <button type="button" onClick={() => void triageAll()} disabled={busy || openCount === 0}>
          {busy ? 'Triaging…' : 'Triage all'}
        </button>
      </div>
      {note ? (
        <p className={note === 'Agent pending' ? 'meta' : 'note-error'} role="status">
          {note}
        </p>
      ) : null}
      {ranked.length === 0 ? (
        <p>No matters yet.</p>
      ) : (
        <ol className="matter-list">
          {ranked.map((matter) => {
            const to = `/dashboard/matters/${encodeURIComponent(matter.id)}`
            const job = matter.status === 'dispatched' ? (jobs[matter.id] ?? null) : null
            const label = job
              ? dispatchLabel(job)
              : matter.status === 'dispatched'
                ? { text: 'Dispatched', error: undefined }
                : null
            const contractor = job?.contractorName ?? matter.dispatch?.contractorName
            return (
              <li key={matter.id}>
                <a
                  className="matter-link"
                  href={to}
                  onClick={(event) => {
                    event.preventDefault()
                    navigate(to)
                  }}
                >
                  <span className="title">{matter.title}</span>
                  <span className="meta">{place(matter)}</span>
                  <span className="meta">{matter.triage?.priority ?? '—'}</span>
                  <span className="meta">{matter.triage?.trade ?? '—'}</span>
                  <span className="meta">{matter.status}</span>
                  {label ? (
                    <span className="dispatch-line">
                      <span className={`badge badge-${job?.status ?? 'dispatched'}`}>{label.text}</span>
                      {label.error ? <span className="note-error">{label.error}</span> : null}
                      {contractor ? <span className="meta">{contractor}</span> : null}
                    </span>
                  ) : null}
                </a>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
