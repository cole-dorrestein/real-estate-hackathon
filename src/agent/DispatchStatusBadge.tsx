import type { JSX } from 'react'
import type { DispatchJob } from './types'

export function dispatchStatusLabel(job: DispatchJob): string {
  switch (job.status) {
    case 'dispatched':
      return 'Dispatched'
    case 'contacted':
      return `Contacted via ${job.channel ?? 'phone/email'}`
    case 'visit_agreed':
      return `Visit agreed: ${job.visitAt ?? ''}`.trim()
    case 'failed':
      return 'Failed'
  }
}

export function DispatchStatusBadge({ job }: { job: DispatchJob }): JSX.Element {
  return (
    <span className="dispatch-status" data-status={job.status} title={job.error}>
      {dispatchStatusLabel(job)}
    </span>
  )
}
