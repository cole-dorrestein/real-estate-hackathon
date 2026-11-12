import type { DispatchJob } from '../agent/types'
import type { ContractorBrief, Triage } from '../types'

export function takeTriageResult(value: { triage: Triage; brief: ContractorBrief }): {
  triage: Triage
  brief: ContractorBrief
} {
  const { triage, brief } = value
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

export function dispatchLabel(job: DispatchJob): { text: string; error?: string } {
  if (job.status === 'dispatched') return { text: 'Call requested' }
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
