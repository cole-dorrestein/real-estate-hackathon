import { useSyncExternalStore } from 'react'
import seedMatters from '../data/seed-matters.json'
import type { Matter } from '../types'

export const MATTERS_STORAGE_KEY = 'pm.matters.v1'

export interface MattersStore {
  list(): Matter[]
  get(id: string): Matter | undefined
  getByPinId(pinId: string): Matter | undefined
  upsert(matter: Matter): void
  subscribe(listener: () => void): () => void
}

let snapshot: Matter[] | null = null
const listeners = new Set<() => void>()

function readInitial(): Matter[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(MATTERS_STORAGE_KEY)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed as Matter[]
      }
    }
  } catch {
    // Broken storage falls back to the seed file.
  }
  return structuredClone(seedMatters) as unknown as Matter[]
}

function ensure(): Matter[] {
  if (!snapshot) snapshot = readInitial()
  return snapshot
}

function emit(): void {
  for (const listener of listeners) listener()
}

const store: MattersStore = {
  list() {
    return ensure()
  },
  get(id) {
    return ensure().find((matter) => matter.id === id)
  },
  getByPinId(pinId) {
    return ensure().find((matter) => matter.pin.id === pinId)
  },
  upsert(matter) {
    const current = ensure()
    const index = current.findIndex((item) => item.id === matter.id)
    snapshot =
      index >= 0 ? current.map((item, i) => (i === index ? matter : item)) : [...current, matter]
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MATTERS_STORAGE_KEY, JSON.stringify(snapshot))
    }
    emit()
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function getMattersStore(): MattersStore {
  return store
}

export function useMatters(): Matter[] {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.list(),
  )
}
