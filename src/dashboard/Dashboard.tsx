import type { JSX } from 'react'
import { useMatters } from '../store/matters'

export function Dashboard(): JSX.Element {
  const matters = useMatters()
  return (
    <section className="card">
      <h1>Matters</h1>
      <ul className="stack-list">
        {matters.map((matter) => (
          <li key={matter.id}>
            <a href={`/dashboard/matters/${encodeURIComponent(matter.id)}`}>{matter.title}</a>
            <span className="meta">
              {matter.status} · {matter.pin.floorId} {matter.pin.roomName}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
