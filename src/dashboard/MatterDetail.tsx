import type { JSX } from 'react'
import { useMatters } from '../store/matters'

export function MatterDetail({ matterId }: { matterId: string }): JSX.Element {
  const matter = useMatters().find((item) => item.id === matterId)
  if (!matter) {
    return (
      <section className="card">
        <h1>Matter not found</h1>
        <p>{matterId}</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h1>{matter.title}</h1>
      <p>{matter.description}</p>
      <p className="meta">
        {matter.status} · {matter.pin.floorId} · {matter.pin.roomName} · {matter.pin.id}
      </p>
      <ul className="stack-list">
        {matter.sources.map((source) => (
          <li key={source.id}>
            <span>
              {source.kind}
              {source.text ? `: ${source.text}` : ''}
            </span>
            {source.kind === 'photo' && source.dataUrl ? (
              <img src={source.dataUrl} alt="" width={80} height={80} />
            ) : null}
          </li>
        ))}
      </ul>
      <p>
        <a href={`/?pin=${encodeURIComponent(matter.pin.id)}`}>Open pin on the plan</a>
      </p>
    </section>
  )
}
