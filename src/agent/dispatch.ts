import type { ContractorBrief, Matter, SourceRef } from '../types'
import { triageMatter } from './triage'
import type { DispatchJob } from './types'

export async function simulateDispatch(matter: Matter, brief: ContractorBrief): Promise<DispatchJob> {
  try {
    const triage = matter.triage ?? (await triageMatter(matter)).triage
    const res = await fetch(endpoint('/api/dispatch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matter: stripDataPhotos(matter),
        triage,
        brief,
      }),
    })
    const text = await res.text()
    const job = parseJob(text)
    if (job) return job
    return failedJob(matter.id, text || `dispatch failed (${res.status})`)
  } catch (err) {
    return failedJob(matter.id, err instanceof Error ? err.message : 'dispatch server unreachable')
  }
}

export const dispatchToBot = simulateDispatch

export async function getDispatchJob(matterId: string): Promise<DispatchJob | null> {
  try {
    const res = await fetch(endpoint(`/api/dispatch/${encodeURIComponent(matterId)}`))
    if (!res.ok) return null
    return parseJob(await res.text())
  } catch {
    return null
  }
}

function endpoint(path: string): string {
  return `http://${window.location.hostname}:8787${path}`
}

function stripDataPhotos(matter: Matter): Matter {
  return {
    ...matter,
    sources: matter.sources.map((source) => stripDataUrl(source)),
  }
}

function stripDataUrl(source: SourceRef): SourceRef {
  if (!source.dataUrl?.toLowerCase().startsWith('data:')) return source
  const copy = { ...source }
  delete copy.dataUrl
  return copy
}

function parseJob(text: string): DispatchJob | null {
  try {
    const job = JSON.parse(text) as DispatchJob
    if (job && typeof job.matterId === 'string' && typeof job.status === 'string') return job
  } catch {
    // Not a job payload.
  }
  return null
}

function failedJob(matterId: string, error: string): DispatchJob {
  return {
    matterId,
    status: 'failed',
    updatedAt: new Date().toISOString(),
    error,
  }
}
