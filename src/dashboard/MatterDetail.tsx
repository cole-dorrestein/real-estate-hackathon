import { useEffect, useRef, useState, type JSX } from 'react'
import { getDispatchJob, simulateDispatch } from '../agent/dispatch'
import { triageMatter } from '../agent/triage'
import type { DispatchJob } from '../agent/types'
import { navigate } from '../shell/router'
import { getMattersStore, useMatters } from '../store/matters'
import type { Matter, SourceKind } from '../types'
import { dispatchLabel, formatWhen, isTerminalJob, takeTriageResult } from './agent'
import './dashboard.css'

function place(matter: Matter): string {
  const room = matter.pin.roomName || matter.pin.roomId
  return room ? `${matter.pin.floorId} ${room}` : matter.pin.floorId
}

function sourceLabel(kind: SourceKind): string {
  if (kind === 'photo') return 'Photo'
  if (kind === 'note') return 'Note'
  return 'Dictation'
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

export function MatterDetail({ matterId }: { matterId: string }): JSX.Element {
  const matter = useMatters().find((item) => item.id === matterId)
  const [job, setJob] = useState<DispatchJob | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<'triage' | 'dispatch' | null>(null)
  const jobRef = useRef(job)
  jobRef.current = job
  const status = matter?.status

  useEffect(() => {
    setJob(null)
    setBusy(null)
    setNote(null)
  }, [matterId])

  useEffect(() => {
    if (status !== 'dispatched') return
    let cancelled = false
    let timer = 0
    let running = false

    const tick = async () => {
      if (running) return
      if (isTerminalJob(jobRef.current)) {
        window.clearInterval(timer)
        return
      }
      running = true
      try {
        const next = await getDispatchJob(matterId)
        if (cancelled) return
        setJob(next)
        if (isTerminalJob(next)) window.clearInterval(timer)
      } catch (err) {
        if (!cancelled) setNote(errorText(err))
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
  }, [matterId, status])

  async function onTriage() {
    const current = getMattersStore().get(matterId)
    if (!current || current.status === 'dispatched') return
    setBusy('triage')
    setNote(null)
    try {
      const picked = takeTriageResult(await triageMatter(current))
      const updatedAt = new Date().toISOString()
      getMattersStore().upsert({
        ...current,
        callError: undefined,
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
      setJob(null)
    } catch (err) {
      setNote(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function onDispatch() {
    const current = getMattersStore().get(matterId)
    if (!current?.brief || (current.status !== 'triaged' && !(current.status === 'dispatched' && job?.status === 'failed'))) return
    setBusy('dispatch')
    setNote(null)
    try {
      const next = await simulateDispatch(current, current.brief)
      if (next.status === 'failed') {
        setJob(next)
        getMattersStore().upsert({ ...current, callError: next.error || 'Call request failed', updatedAt: new Date().toISOString() })
        return
      }
      const sentAt = new Date().toISOString()
      getMattersStore().upsert({
        ...current,
        status: 'dispatched',
        callError: undefined,
        dispatch: {
          status: 'simulated',
          channel: 'dashboard',
          sentAt,
          contractorName: next.contractorName ?? current.brief.contractorName,
        },
        updatedAt: sentAt,
      })
      setJob(next)
    } catch (err) {
      setNote(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  if (!matter) {
    return (
      <section className="card matter-detail">
        <h1>Matter not found</h1>
        <p>{matterId}</p>
        <p>
          <a
            href="/dashboard"
            onClick={(event) => {
              event.preventDefault()
              navigate('/dashboard')
            }}
          >
            All matters
          </a>
        </p>
      </section>
    )
  }

  const pinTo = `/?pin=${encodeURIComponent(matter.pin.id)}`
  const visibleJob = job && (matter.status === 'dispatched' || job.status === 'failed') ? job : null
  const label = visibleJob
    ? dispatchLabel(visibleJob)
    : matter.status === 'dispatched'
      ? { text: 'Dispatched', error: undefined }
      : null
  const contractor = visibleJob?.contractorName ?? matter.dispatch?.contractorName
  const canDispatch = Boolean(matter.brief) && (matter.status === 'triaged' || (matter.status === 'dispatched' && job?.status === 'failed'))

  return (
    <section className="card matter-detail">
      <p>
        <a
          href="/dashboard"
          onClick={(event) => {
            event.preventDefault()
            navigate('/dashboard')
          }}
        >
          All matters
        </a>
      </p>
      <h1>{matter.title}</h1>
      <p>{matter.description}</p>
      <p className="matter-facts">
        <span className="meta">{place(matter)}</span>
        <span className={`chip chip-${matter.triage?.priority ?? 'none'}`}>{matter.triage?.priority ?? '—'}</span>
        <span className="meta">{matter.triage?.trade ?? matter.issueType ?? '—'}</span>
        <span className={`chip chip-status-${matter.status}`}>{matter.status}</span>
      </p>
      {matter.triage ? <p>{matter.triage.summary}</p> : null}

      <section>
        <h2>Source trail</h2>
        {matter.sources.map((source) => (
          <article key={source.id} className="source">
            <p className="meta">
              {sourceLabel(source.kind)} · {formatWhen(source.createdAt)}
            </p>
            {source.kind === 'photo' && source.dataUrl ? (
              <img src={source.dataUrl} alt="Photo" width={96} height={96} />
            ) : null}
            {source.text ? <p>{source.text}</p> : null}
          </article>
        ))}
        <p>
          <a
            href={pinTo}
            onClick={(event) => {
              event.preventDefault()
              navigate(pinTo)
            }}
          >
            Open pin on the plan
          </a>
        </p>
      </section>

      {matter.brief ? (
        <section>
          <h2>Call brief</h2>
          <p>{matter.brief.locationText}</p>
          <p className="brief-body">{matter.brief.body}</p>
          <p>
            <a href={matter.brief.pinUrl}>{matter.brief.pinUrl}</a>
          </p>
        </section>
      ) : null}

      {label ? (
        <section>
          <h2>Dispatch</h2>
          <p className="dispatch-line">
            <span className={`badge badge-${visibleJob?.status ?? 'dispatched'}`}>{label.text}</span>
            {contractor ? <span className="meta">{contractor}</span> : null}
          </p>
          {visibleJob?.status === 'visit_agreed' ? <h2>Visit booked: {visibleJob.visitAt ?? ''}</h2> : null}
          {visibleJob?.summary ? <p className="brief-body">{visibleJob.summary}</p> : null}
          {label.error ? <p className="note-error">{label.error}</p> : null}
        </section>
      ) : null}

      {canDispatch ? <p className="meta">Calls are sent to your configured personal phone via Grok Bot.</p> : null}

      <div className="actions">
        <button type="button" onClick={() => void onTriage()} disabled={busy !== null || matter.status === 'dispatched'}>
          {busy === 'triage' ? 'Triaging…' : 'Triage'}
        </button>
        <button
          type="button"
          onClick={() => void onDispatch()}
          disabled={busy !== null || !canDispatch}
          title={canDispatch ? undefined : 'Dispatch is available after triage'}
        >
          {busy === 'dispatch' ? 'Requesting call…' : 'Call Contractor'}
        </button>
      </div>
      {note ? (
        <p className="note-error" role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
