import { useEffect, useState, type JSX } from 'react'
import { listContractors } from '../agent/dispatch'
import type { ListedContractor } from '../agent/types'

function tradeLabel(trade: string): string {
  if (trade === 'plumber') return 'Plumber'
  if (trade === 'electrician') return 'Electrician'
  return trade.charAt(0).toUpperCase() + trade.slice(1)
}

function contactOf(contractor: ListedContractor): string | undefined {
  return contractor.phone ?? contractor.email
}

export function ContractorPicker({
  trade,
  value,
  onChange,
}: {
  trade?: string
  value: string
  onChange: (id: string) => void
}): JSX.Element {
  const [options, setOptions] = useState<ListedContractor[]>([])
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listContractors()
      .then((list) => {
        if (!cancelled) setOptions(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setNote(err instanceof Error ? err.message : 'Could not load contractors')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selected = options.some((item) => item.id === value)
    ? value
    : (options.find((item) => item.trade === trade) ?? options[0])?.id ?? ''

  useEffect(() => {
    if (selected && selected !== value) onChange(selected)
  }, [selected, value, onChange])

  return (
    <label>
      Contractor
      <select value={selected} onChange={(event) => onChange(event.target.value)} disabled={options.length === 0}>
        {options.length === 0 ? <option value="">Loading contractors…</option> : null}
        {options.map((item) => {
          const contact = contactOf(item)
          return (
            <option key={item.id} value={item.id}>
              {tradeLabel(item.trade)} · {item.name}
              {contact ? ` · ${contact}` : ''}
            </option>
          )
        })}
      </select>
      {note ? <span className="note-error">{note}</span> : null}
    </label>
  )
}
