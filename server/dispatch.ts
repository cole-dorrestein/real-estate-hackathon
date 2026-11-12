import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DispatchChannel, DispatchJob } from '../src/agent/types.ts'

type Trade = 'plumber' | 'electrician' | 'carpenter' | 'general'
type Priority = 'P1' | 'P2' | 'P3'
type ReportStatus = 'contacted' | 'visit_agreed' | 'failed'

type Contractor = {
  name: string
  trade: Trade
  phone?: string
  email?: string
}

type WebhookPayload = {
  matterId: string
  title: string
  trade: Trade
  priority: Priority
  location: { floor: string; room: string }
  description: string
  photoUrls: string[]
  pinUrl: string
  contractor: { name: string; trade: Trade; phone?: string; email?: string }
  channel: DispatchChannel
  callbackUrl?: string
  statusToken?: string
  probe?: boolean
}

type StatusReport = {
  matterId: string
  status: ReportStatus
  channel?: DispatchChannel
  visitAt?: string
  summary?: string
  error?: string
  at?: string
}

type StoredJob = {
  statusToken: string
  reportAtMs: number
  job?: DispatchJob
  earlyReport?: { report: StatusReport; timeMs: number }
}

type DispatchBody = {
  matter: {
    id: string
    title?: string
    description?: string
    pin?: { floorId?: string; roomName?: string }
    sources?: { dataUrl?: string }[]
  }
  triage: { trade: Trade; priority: Priority }
  brief: { pinUrl: string }
  contractorId?: string
}

const PICKER_TRADES: readonly Trade[] = ['plumber', 'electrician']

const TRADES: Trade[] = ['plumber', 'electrician', 'carpenter', 'general']
const PRIORITIES: Priority[] = ['P1', 'P2', 'P3']
const REPORT_STATUSES: ReportStatus[] = ['contacted', 'visit_agreed', 'failed']
const WEBHOOK_TIMEOUT_MS = 8000
const PORT = 8787

const serverDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(serverDir, '..')
const jobsPath = resolve(serverDir, 'dispatch-jobs.json')
const failedLogPath = resolve(serverDir, 'dispatch-failed.jsonl')

loadEnvFile(resolve(repoRoot, '.env.local'))

const contractors = loadContractors()
const statusDir = resolveStatusDir()
const jobs = new Map<string, StoredJob>()
loadJobs()

if (process.argv.includes('--probe')) {
  const job = await runProbe()
  console.log(JSON.stringify(publicView(job), null, 2))
  process.exit(job.status === 'dispatched' ? 0 : 1)
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    if (res.headersSent) return
    send(req, res, 500, { error: 'server error' })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`dispatch server listening on http://0.0.0.0:${PORT}`)
  console.log(`status dir ${statusDir}`)
})

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await route(req, res)
  } catch (err) {
    if (res.headersSent) return
    if (err instanceof SyntaxError) {
      send(req, res, 400, { error: 'invalid JSON' })
      return
    }
    throw err
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    if (!originAllowed(req)) {
      send(req, res, 403, { error: 'origin not allowed' })
      return
    }
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  const path = pathname(req)

  if (req.method === 'GET' && path === '/api/contractors') {
    if (!originAllowed(req)) {
      send(req, res, 403, { error: 'origin not allowed' })
      return
    }
    send(req, res, 200, listPickerContractors())
    return
  }

  const contractorMatch = path.match(/^\/api\/contractors\/([^/]+)$/)
  if (req.method === 'GET' && contractorMatch) {
    const trade = decodeURIComponent(contractorMatch[1] ?? '')
    const contractor = contractors.find((item) => item.trade === trade)
    if (!contractor) {
      send(req, res, 404, { error: 'unknown trade' })
      return
    }
    send(req, res, 200, { name: contractor.name, channel: channelFor(contractor) })
    return
  }

  if (req.method === 'POST' && path === '/api/dispatch/probe') {
    if (!originAllowed(req)) {
      send(req, res, 403, { error: 'origin not allowed' })
      return
    }
    await readJson(req)
    const existing = blockingJob('probe')
    if (existing) {
      send(req, res, 409, existing)
      return
    }
    send(req, res, 200, await runProbe())
    return
  }

  if (req.method === 'POST' && path === '/api/dispatch') {
    if (!originAllowed(req)) {
      send(req, res, 403, { error: 'origin not allowed' })
      return
    }
    const body = await readJson(req)
    if (!isDispatchBody(body)) {
      send(req, res, 400, { error: 'expected {matter, triage, brief}' })
      return
    }
    if (!pinUrlAllowed(body.brief.pinUrl)) {
      send(req, res, 400, { error: 'pinUrl is not on an allowed origin' })
      return
    }
    const existing = blockingJob(body.matter.id)
    if (existing) {
      send(req, res, 409, existing)
      return
    }
    const phone = process.env.DISPATCH_PHONE_NUMBER?.trim() ?? ''
    const contractor: Contractor = { name: 'Personal phone', trade: body.triage.trade, phone }
    const payload = buildPayload(body, contractor, 'phone')
    const failure = /^\+[1-9]\d{7,14}$/.test(phone) ? undefined : 'Configure DISPATCH_PHONE_NUMBER in E.164 format'
    const job = await completeDispatch(body.matter.id, payload, {
      channel: 'phone', contractorName: 'Personal phone', failure,
    })
    send(req, res, 200, job)
    return
  }

  const statusMatch = path.match(/^\/api\/dispatch\/([^/]+)\/status$/)
  if (req.method === 'POST' && statusMatch) {
    const matterId = decodeURIComponent(statusMatch[1] ?? '')
    const stored = jobs.get(matterId)
    if (!stored) {
      send(req, res, 404, { error: 'unknown matter' })
      return
    }
    const body = await readJson(req)
    const token = tokenFrom(req, body)
    if (!token || token !== stored.statusToken) {
      send(req, res, 401, { error: 'invalid status token' })
      return
    }
    const report = parseReport(body, matterId)
    if (!report) {
      send(req, res, 400, { error: 'invalid status report' })
      return
    }
    const timeMs = reportTime(report.at, Date.now())
    if (applyReport(stored, report, timeMs)) saveJobs()
    syncStatusFile(matterId)
    if (!stored.job) {
      send(req, res, 202, { matterId, accepted: true })
      return
    }
    send(req, res, 200, stored.job)
    return
  }

  const jobMatch = path.match(/^\/api\/dispatch\/([^/]+)$/)
  if (req.method === 'GET' && jobMatch) {
    const matterId = decodeURIComponent(jobMatch[1] ?? '')
    syncStatusFile(matterId)
    const job = jobs.get(matterId)?.job
    if (!job) {
      send(req, res, 404, { error: 'unknown matter' })
      return
    }
    send(req, res, 200, job)
    return
  }

  send(req, res, 404, { error: 'not found' })
}


async function runProbe(): Promise<DispatchJob> {
  return { matterId: 'probe', status: 'failed', channel: 'phone', updatedAt: new Date().toISOString(), error: 'Phone calls must be started from a matter; no call was placed.' }
}

async function completeDispatch(
  matterId: string,
  payload: WebhookPayload,
  meta: { channel: DispatchChannel; contractorName: string; failure?: string },
): Promise<DispatchJob> {
  const token = crypto.randomUUID()
  const full: WebhookPayload = { ...payload, ...callbackFields(matterId, token) }
  jobs.set(matterId, { statusToken: token, reportAtMs: 0 })
  saveJobs()

  const result = meta.failure ? { ok: false as const, error: meta.failure } : await postPhoneWebhook(full)
  const updatedAt = new Date().toISOString()
  const job: DispatchJob = result.ok
    ? {
        matterId,
        status: 'dispatched',
        channel: meta.channel,
        contractorName: meta.contractorName,
        updatedAt,
      }
    : {
        matterId,
        status: 'failed',
        channel: meta.channel,
        contractorName: meta.contractorName,
        updatedAt,
        error: result.error,
      }
  if (!result.ok) logFailed(full)
  settleJob(matterId, job)
  return jobs.get(matterId)?.job ?? job
}

async function postPhoneWebhook(payload: WebhookPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.GROKBOT_WEBHOOK_URL?.trim()
  const key = process.env.GROKBOT_WEBHOOK_KEY?.trim()
  if (!url || !key) return { ok: false, error: 'Grok Bot webhook URL and key must be configured.' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Automation-Key': key },
      body: JSON.stringify(payload), signal: controller.signal,
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `Grok Bot webhook returned HTTP ${res.status}` }
  } catch {
    return { ok: false, error: 'Grok Bot did not respond. The call may have been placed; check before retrying.' }
  } finally { clearTimeout(timer) }
}

function buildPayload(body: DispatchBody, contractor: Contractor | undefined, channel: DispatchChannel): WebhookPayload {
  const pin = body.matter.pin
  const room = pin?.roomName?.trim() ? pin.roomName : 'unknown room'
  return {
    matterId: body.matter.id,
    title: body.matter.title ?? '',
    trade: contractor?.trade ?? body.triage.trade,
    priority: body.triage.priority,
    location: { floor: pin?.floorId ?? '', room },
    description: body.matter.description ?? '',
    photoUrls: httpPhotoUrls(body.matter.sources),
    pinUrl: body.brief.pinUrl,
    contractor: contractor ? contractorBody(contractor) : { name: body.triage.trade, trade: body.triage.trade },
    channel,
  }
}

function httpPhotoUrls(sources: { dataUrl?: string }[] | undefined): string[] {
  const urls: string[] = []
  for (const source of sources ?? []) {
    if (typeof source.dataUrl === 'string' && /^https?:\/\//i.test(source.dataUrl)) urls.push(source.dataUrl)
  }
  return urls
}

function contractorBody(contractor: Contractor): WebhookPayload['contractor'] {
  const body: WebhookPayload['contractor'] = { name: contractor.name, trade: contractor.trade }
  if (contractor.phone) body.phone = contractor.phone
  else if (contractor.email) body.email = contractor.email
  return body
}

function channelFor(contractor: Contractor): DispatchChannel {
  return contractor.phone ? 'phone' : 'email'
}

function findContractor(id: string): Contractor | undefined {
  const byTrade = contractors.find((item) => item.trade === id)
  if (byTrade) return byTrade
  if (/^\d+$/.test(id)) return contractors[Number(id)]
  return undefined
}

function listPickerContractors(): {
  id: string
  name: string
  trade: Trade
  channel: DispatchChannel
  phone?: string
  email?: string
}[] {
  return contractors.filter((item) => PICKER_TRADES.includes(item.trade)).map((contractor) => {
    const item: {
      id: string
      name: string
      trade: Trade
      channel: DispatchChannel
      phone?: string
      email?: string
    } = {
      id: contractor.trade,
      name: contractor.name,
      trade: contractor.trade,
      channel: channelFor(contractor),
    }
    if (contractor.phone) item.phone = contractor.phone
    else if (contractor.email) item.email = contractor.email
    return item
  })
}

function callbackFields(matterId: string, token: string): { callbackUrl?: string; statusToken?: string } {
  const base = process.env.DISPATCH_CALLBACK_BASE_URL?.trim()
  if (!base) return {}
  const origin = base.replace(/\/$/, '')
  return {
    callbackUrl: `${origin}/api/dispatch/${encodeURIComponent(matterId)}/status`,
    statusToken: token,
  }
}

function settleJob(matterId: string, job: DispatchJob): void {
  const stored = jobs.get(matterId)
  if (!stored) return
  stored.job = job
  stored.reportAtMs = Date.parse(job.updatedAt)
  const early = stored.earlyReport
  delete stored.earlyReport
  if (early) applyReport(stored, early.report, early.timeMs)
  syncStatusFile(matterId)
  saveJobs()
}

function syncStatusFile(matterId: string): void {
  const stored = jobs.get(matterId)
  if (!stored) return
  const found = readStatusReport(matterId)
  if (!found) return
  if (applyReport(stored, found.report, found.timeMs)) saveJobs()
}

function readStatusReport(matterId: string): { report: StatusReport; timeMs: number } | null {
  if (!/^[A-Za-z0-9._-]+$/.test(matterId)) return null
  const path = resolve(statusDir, `${matterId}.json`)
  const root = statusDir.endsWith('/') ? statusDir : `${statusDir}/`
  if (!path.startsWith(root)) return null
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  const report = parseReport(raw, matterId)
  if (!report) return null
  return { report, timeMs: reportTime(report.at, statSync(path).mtimeMs) }
}

function applyReport(stored: StoredJob, report: StatusReport, timeMs: number): boolean {
  if (!stored.job) {
    stored.earlyReport = { report, timeMs }
    return true
  }
  if (timeMs < stored.reportAtMs) return false
  stored.reportAtMs = timeMs
  const next: DispatchJob = {
    matterId: stored.job.matterId,
    status: report.status,
    updatedAt: new Date(stored.reportAtMs).toISOString(),
    channel: report.channel ?? stored.job.channel,
    contractorName: stored.job.contractorName,
  }
  if (report.status === 'visit_agreed') next.visitAt = report.visitAt ?? stored.job.visitAt
  if (report.status === 'failed') next.error = report.error || 'dispatch failed'
  if (typeof report.summary === 'string') next.summary = report.summary
  else if (stored.job.summary) next.summary = stored.job.summary
  stored.job = next
  return true
}

function reportTime(at: string | undefined, fallbackMs: number): number {
  if (typeof at === 'string') {
    const parsed = Date.parse(at)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallbackMs
}

function parseReport(value: unknown, matterId: string): StatusReport | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (body.matterId !== matterId) return null
  if (!isOneOf(body.status, REPORT_STATUSES)) return null
  if (body.channel !== undefined && body.channel !== 'phone' && body.channel !== 'email') return null
  if (body.visitAt !== undefined && typeof body.visitAt !== 'string') return null
  if (body.summary !== undefined && typeof body.summary !== 'string') return null
  if (body.error !== undefined && typeof body.error !== 'string') return null
  if (body.at !== undefined && typeof body.at !== 'string') return null
  return {
    matterId,
    status: body.status,
    channel: body.channel,
    visitAt: body.visitAt,
    summary: typeof body.summary === 'string' ? body.summary : undefined,
    error: body.error,
    at: body.at,
  }
}

function tokenFrom(req: IncomingMessage, body: unknown): string | undefined {
  const authorization = req.headers.authorization
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(\S+)\s*$/i)
    if (match) return match[1]
  }
  const header = req.headers['x-status-token']
  if (typeof header === 'string' && header.trim()) return header.trim()
  if (body && typeof body === 'object') {
    const token = (body as { statusToken?: unknown }).statusToken
    if (typeof token === 'string' && token.trim()) return token.trim()
  }
  return undefined
}

function logFailed(payload: WebhookPayload): void {
  appendFileSync(failedLogPath, `${JSON.stringify(payload)}\n`)
}

function loadJobs(): void {
  if (!existsSync(jobsPath)) return
  try {
    const parsed = JSON.parse(readFileSync(jobsPath, 'utf8')) as Record<string, StoredJob>
    for (const [id, stored] of Object.entries(parsed)) jobs.set(id, stored)
  } catch (err) {
    console.error('could not read dispatch jobs', err instanceof Error ? err.message : err)
  }
}

function saveJobs(): void {
  try {
    const obj: Record<string, StoredJob> = {}
    for (const [id, stored] of jobs) obj[id] = stored
    writeFileSync(jobsPath, `${JSON.stringify(obj, null, 2)}\n`)
  } catch (err) {
    console.error('could not save dispatch jobs', err instanceof Error ? err.message : err)
  }
}

function loadContractors(): Contractor[] {
  const localPath = resolve(serverDir, 'contractors.local.json')
  const examplePath = resolve(serverDir, 'contractors.example.json')
  const path = existsSync(localPath) ? localPath : examplePath
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Contractor[]
  if (!Array.isArray(parsed)) throw new Error(`${path} must be a JSON array`)
  return parsed.map(normalizeContractor)
}

function normalizeContractor(raw: Contractor): Contractor {
  const name = String(raw.name ?? '').trim()
  const trade = raw.trade
  const phone = typeof raw.phone === 'string' && raw.phone.trim() ? raw.phone.trim() : undefined
  const email = typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : undefined
  if (!isOneOf(trade, TRADES)) throw new Error(`unknown contractor trade ${String(trade)}`)
  if (phone) return { name, trade, phone }
  if (email) return { name, trade, email }
  return { name, trade }
}

function resolveStatusDir(): string {
  const preferred = process.env.DISPATCH_STATUS_DIR?.trim() || '/workspace/hackathon/dispatch-status'
  try {
    mkdirSync(preferred, { recursive: true })
    return preferred
  } catch (err) {
    const fallback = resolve(process.cwd(), 'dispatch-status')
    mkdirSync(fallback, { recursive: true })
    console.error(
      `status dir ${preferred} unavailable (${err instanceof Error ? err.message : err}); using ${fallback}`,
    )
    return fallback
  }
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const stripped = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = stripped.indexOf('=')
    if (eq <= 0) continue
    const key = stripped.slice(0, eq).trim()
    let value = stripped.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function isDispatchBody(value: unknown): value is DispatchBody {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  const matter = body.matter
  const triage = body.triage
  const brief = body.brief
  if (!matter || typeof matter !== 'object') return false
  if (!triage || typeof triage !== 'object') return false
  if (!brief || typeof brief !== 'object') return false
  const matterId = (matter as { id?: unknown }).id
  const trade = (triage as { trade?: unknown }).trade
  const priority = (triage as { priority?: unknown }).priority
  const pinUrl = (brief as { pinUrl?: unknown }).pinUrl
  if (body.contractorId !== undefined && typeof body.contractorId !== 'string') return false
  return (
    typeof matterId === 'string' &&
    matterId.length > 0 &&
    isOneOf(trade, TRADES) &&
    isOneOf(priority, PRIORITIES) &&
    typeof pinUrl === 'string'
  )
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  return JSON.parse(text) as unknown
}

function pathname(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname.replace(/\/+$/, '')
  return path || '/'
}

function allowedOrigins(): string[] {
  const defaults = ['http://localhost:5173', 'http://127.0.0.1:5173']
  const extra = (process.env.DISPATCH_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  return [...defaults, ...extra]
}

function requestOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin
  if (typeof origin !== 'string') return undefined
  const trimmed = origin.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = requestOrigin(req)
  return origin !== undefined && allowedOrigins().includes(origin)
}

function pinUrlAllowed(pinUrl: string): boolean {
  const bases = [...allowedOrigins()]
  const callback = process.env.DISPATCH_CALLBACK_BASE_URL?.trim().replace(/\/$/, '')
  if (callback) bases.push(callback)
  return bases.some((base) => pinUrl === base || pinUrl.startsWith(`${base}/`) || pinUrl.startsWith(`${base}?`))
}

function blockingJob(matterId: string): DispatchJob | { error: string } | undefined {
  const stored = jobs.get(matterId)
  if (!stored) return undefined
  if (!stored.job || stored.job.status !== 'failed' || stored.job.error?.includes('may have been placed')) return stored.job ?? { error: 'dispatch in progress' }
  return undefined
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Status-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  const origin = requestOrigin(req)
  if (origin && allowedOrigins().includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...corsHeaders(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function publicView(job: DispatchJob): { matterId: string; status: string; channel?: string; error: string | null } {
  return { matterId: job.matterId, status: job.status, channel: job.channel, error: job.error ?? null }
}
