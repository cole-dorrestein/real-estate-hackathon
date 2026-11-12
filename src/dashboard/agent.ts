import type { ContractorBrief, Triage } from '../types'

// Mirrors src/agent/types.ts so this folder typechecks before F4 lands.
export type DispatchJobStatus = 'dispatched' | 'contacted' | 'visit_agreed' | 'failed'

export type DispatchJob = {
  matterId: string
  status: DispatchJobStatus
  channel?: 'phone' | 'email'
  visitAt?: string
  contractorName?: string
  updatedAt: string
  error?: string
}

type TriageModule = {
  triageMatter: (matter: unknown) => Promise<unknown>
}

type DispatchModule = {
  simulateDispatch: (matter: unknown, brief: unknown) => Promise<unknown>
  getDispatchJob: (matterId: string) => Promise<unknown>
}

// A literal `import('../agent/triage')` fails tsc and Vite while those files
// are absent. import.meta.glob keeps the same paths and is an empty map until
// F4 adds them, then the next build bundles the real modules.
const triageGlob = import.meta.glob<TriageModule>('../agent/triage.ts')
const dispatchGlob = import.meta.glob<DispatchModule>('../agent/dispatch.ts')

const STATUSES: readonly DispatchJobStatus[] = ['dispatched', 'contacted', 'visit_agreed', 'failed']

function firstLoader<T>(glob: Record<string, () => Promise<T>>): (() => Promise<T>) | undefined {
  return Object.values(glob)[0]
}

export async function loadTriage(): Promise<TriageModule | 'pending'> {
  const load = firstLoader(triageGlob)
  if (!load) return 'pending'
  return load()
}

export async function loadDispatch(): Promise<DispatchModule | 'pending'> {
  const load = firstLoader(dispatchGlob)
  if (!load) return 'pending'
  return load()
}

export function takeTriageResult(value: unknown): { triage: Triage; brief: ContractorBrief } {
  if (!value || typeof value !== 'object') throw new Error('Unexpected triage result')
  const record = value as { triage?: Triage; brief?: ContractorBrief }
  if (!record.triage || !record.brief) throw new Error('Unexpected triage result')
  const { triage, brief } = record
  return {
    triage: {
      priority: triage.priority,
      trade: triage.trade,
      summary: triage.summary,
      reasoning: triage.reasoning,
      model: triage.model,
      at: triage.at,
    },
    brief: {
      contractorName: brief.contractorName,
      trade: brief.trade,
      locationText: brief.locationText,
      pinUrl: brief.pinUrl,
      body: brief.body,
      at: brief.at,
    },
  }
}

// Copy only the fields the screen shows, so a phone or email on the payload
// never lands in React state or localStorage.
export function toPublicJob(value: unknown): DispatchJob | null {
  if (value == null) return null
  if (typeof value !== 'object') throw new Error('Unexpected dispatch result')
  const job = value as Record<string, unknown>
  if (typeof job.status !== 'string' || !STATUSES.includes(job.status as DispatchJobStatus)) {
    throw new Error('Unexpected dispatch result')
  }
  return {
    matterId: typeof job.matterId === 'string' ? job.matterId : '',
    status: job.status as DispatchJobStatus,
    channel: job.channel === 'phone' || job.channel === 'email' ? job.channel : undefined,
    visitAt: typeof job.visitAt === 'string' ? job.visitAt : undefined,
    contractorName: typeof job.contractorName === 'string' ? job.contractorName : undefined,
    updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : '',
    error: typeof job.error === 'string' ? job.error : undefined,
  }
}

export function dispatchLabel(job: DispatchJob): { text: string; error?: string } {
  if (job.status === 'dispatched') return { text: 'Dispatched' }
  if (job.status === 'contacted' && job.channel === 'phone') return { text: 'Contacted via phone' }
  if (job.status === 'contacted' && job.channel === 'email') return { text: 'Contacted via email' }
  if (job.status === 'contacted') return { text: 'Contacted' }
  if (job.status === 'visit_agreed') return { text: `Visit agreed: ${job.visitAt ?? ''}` }
  return { text: 'Failed', error: job.error }
}

export function isTerminalJob(job: DispatchJob | null | undefined): boolean {
  return job?.status === 'visit_agreed' || job?.status === 'failed'
}

export function formatWhen(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
