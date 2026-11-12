import type { JSX } from 'react'
import type { PlanViewerProps, Vec2 } from '../types'

function centroid(points: Vec2[]): Vec2 {
  const total = points.reduce<[number, number]>((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
  const count = points.length || 1
  return [total[0] / count, total[1] / count]
}

export function PlanViewer({
  plan,
  matters,
  focusPinId,
  onPinClick,
  onDropRequest,
}: PlanViewerProps): JSX.Element {
  return (
    <section className="card">
      <h1>Plan</h1>
      <p className="meta">{plan.source}</p>
      <p>
        Focus pin: <strong>{focusPinId ?? 'none'}</strong>
      </p>
      {plan.floors.map((floor) => (
        <div key={floor.id}>
          <h2>
            {floor.id} · elevation {floor.elevation} m · {floor.rooms.length} rooms
          </h2>
          <ul className="stack-list">
            {floor.rooms.map((room) => (
              <li key={`${floor.id}-${room.id}`}>
                <span>
                  {room.name} <span className="meta">({room.id})</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const [x, z] = centroid(room.points)
                    onDropRequest?.({
                      position: { x, y: floor.elevation, z },
                      floorId: floor.id,
                      roomId: room.id,
                      roomName: room.name,
                    })
                  }}
                >
                  Drop pin
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <h2>Pins</h2>
      <ul className="stack-list">
        {matters.map((matter) => (
          <li key={matter.id}>
            <span>
              {matter.title} <span className="meta">({matter.pin.id})</span>
            </span>
            <button type="button" onClick={() => onPinClick?.(matter.pin.id)}>
              Focus
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
