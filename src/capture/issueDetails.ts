import type { Trade } from '../types'

const ISSUE_RULES: { trade: Trade; label: string; pattern: RegExp }[] = [
  { trade: 'plumber', label: 'Plumbing', pattern: /\b(leak\w*|water|tap|faucet|pipe\w*|drain\w*|toilet|sink|plumb\w*|boiler|radiator)\b/i },
  { trade: 'electrician', label: 'Electrical', pattern: /\b(electric\w*|spark\w*|socket\w*|outlet\w*|light\w*|wiring|wire\w*|switch\w*|power)\b/i },
  { trade: 'carpenter', label: 'Carpentry', pattern: /\b(door\w*|hinge\w*|wood\w*|cabinet\w*|cupboard\w*|window\w*|carpent\w*)\b/i },
]

export function inferIssue(text: string): { title: string; trade: Trade; label: string } {
  const cleaned = text.trim().replace(/\s+/g, ' ')
  const rule = ISSUE_RULES.find((item) => item.pattern.test(cleaned))
  const firstSentence = cleaned.split(/[.!?]/)[0].trim()
    .replace(/^(?:um[, ]+|uh[, ]+|there(?:'s| is)\s+|i(?:'ve| have) noticed\s+|i can see\s+)+/i, '')
  const words = firstSentence.split(/\s+/).filter(Boolean)
  const title = words.slice(0, 8).join(' ')
  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : '',
    trade: rule?.trade ?? 'general',
    label: rule?.label ?? 'General maintenance',
  }
}
