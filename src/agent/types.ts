export type DispatchChannel = 'phone' | 'email'

export type DispatchJobStatus = 'dispatched' | 'contacted' | 'visit_agreed' | 'failed'

export type DispatchJob = {
  matterId: string
  status: DispatchJobStatus
  channel?: DispatchChannel
  visitAt?: string
  contractorName?: string
  updatedAt: string
  error?: string
}
