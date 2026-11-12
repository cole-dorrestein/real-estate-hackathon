export type DispatchChannel = 'phone' | 'email'

export type DispatchJobStatus = 'dispatched' | 'contacted' | 'visit_agreed' | 'failed'

export type DispatchJob = {
  matterId: string
  status: DispatchJobStatus
  channel?: DispatchChannel
  visitAt?: string
  summary?: string
  contractorName?: string
  updatedAt: string
  error?: string
}

export type ListedContractor = {
  id: string
  name: string
  trade: string
  channel: DispatchChannel
  phone?: string
  email?: string
}
