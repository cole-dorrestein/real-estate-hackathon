import type { ContractorBrief, Matter, Priority, Trade, Triage } from '../types'

const TRADE_RULES: { trade: Trade; keywords: string[] }[] = [
  { trade: 'plumber', keywords: ['faucet', 'leak', 'pipe', 'plumber'] },
  { trade: 'electrician', keywords: ['spark', 'socket', 'light', 'electrical'] },
  { trade: 'carpenter', keywords: ['door', 'wood', 'carpenter'] },
]

const URGENT_KEYWORDS = ['leak', 'water', 'spark']

export function buildPinUrl(pinId: string): string {
  return `${window.location.origin}/?pin=${encodeURIComponent(pinId)}`
}

export async function triageMatter(matter: Matter): Promise<{ triage: Triage; brief: ContractorBrief }> {
  const text = matterText(matter)
  let trade: Trade = 'general'
  let tradeKeywords: string[] = []
  for (const rule of TRADE_RULES) {
    const found = matchedKeywords(text, rule.keywords)
    if (found.length > 0) {
      trade = rule.trade
      tradeKeywords = found
      break
    }
  }

  if (matter.issueType) trade = matter.issueType

  const broken = matchedKeywords(text, ['broken']).length > 0
  const urgent = matchedKeywords(text, URGENT_KEYWORDS)
  const l2Kitchen = isL2Kitchen(matter)
  const priority: Priority = urgent.length > 0 || (broken && l2Kitchen) ? 'P1' : broken ? 'P2' : 'P3'
  const at = new Date().toISOString()
  const pinUrl = buildPinUrl(matter.pin.id)
  const location = formatLocation(matter)
  const name = await lookupContractorName(trade)

  const triage: Triage = {
    priority,
    trade,
    summary: `${matter.title} — ${trade}, ${priority}.`,
    reasoning: reasoning(tradeKeywords, urgent, broken, l2Kitchen),
    model: 'deterministic-v1',
    at,
  }
  const brief: ContractorBrief = {
    contractorName: name,
    trade,
    locationText: location,
    pinUrl,
    body: briefBody(matter, location, pinUrl),
    at,
  }
  return { triage, brief }
}

function matterText(matter: Matter): string {
  return [matter.title, matter.description, ...matter.sources.map((source) => source.text ?? '')].join('\n')
}

function matchedKeywords(text: string, keywords: readonly string[]): string[] {
  return keywords.filter((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(text))
}

function isL2Kitchen(matter: Matter): boolean {
  return (
    matter.pin.floorId.trim().toLowerCase() === 'l2' &&
    (matter.pin.roomName ?? '').trim().toLowerCase() === 'kitchen'
  )
}

function formatLocation(matter: Matter): string {
  const room = matter.pin.roomName?.trim() ? matter.pin.roomName : 'unknown room'
  const { x, y, z } = matter.pin.position
  return `Floor ${matter.pin.floorId}, ${room}, pin (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`
}

function briefBody(matter: Matter, location: string, pinUrl: string): string {
  const photos = matter.sources.filter((source) => source.kind === 'photo').length
  return [matter.title, '', matter.description, '', `Location: ${location}`, `Pin: ${pinUrl}`, `Photos: ${photos}`].join(
    '\n',
  )
}

function reasoning(tradeKeywords: string[], urgent: string[], broken: boolean, l2Kitchen: boolean): string {
  const tradePart = tradeKeywords.length
    ? `Matched trade keywords: ${tradeKeywords.join(', ')}.`
    : 'Matched trade keywords: none.'
  const priorityBits = [...urgent]
  if (broken && l2Kitchen) priorityBits.push('broken on L2 kitchen')
  else if (broken) priorityBits.push('broken')
  const priorityPart = priorityBits.length
    ? `Matched priority keywords: ${priorityBits.join(', ')}.`
    : 'Matched priority keywords: none.'
  return `${tradePart} ${priorityPart}`
}

async function lookupContractorName(trade: Trade): Promise<string> {
  try {
    const res = await fetch(`http://${window.location.hostname}:8787/api/contractors/${trade}`)
    if (res.ok) {
      const body = (await res.json()) as { name?: unknown }
      if (typeof body.name === 'string' && body.name.trim()) return body.name.trim()
    }
  } catch {
    // The brief still builds when the dispatch server is down.
  }
  return trade.charAt(0).toUpperCase() + trade.slice(1)
}
