import { useState, type JSX } from 'react'
import type { CapturePanelProps, Pin, SourceRef } from '../types'

export function CapturePanel({ pendingHit, onCancel, onSave }: CapturePanelProps): JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [note, setNote] = useState('')

  if (!pendingHit) {
    return (
      <section className="card">
        <h1>Capture</h1>
        <p>Drop a pin on the plan to attach a note.</p>
      </section>
    )
  }

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault()
        const now = new Date().toISOString()
        const pin: Pin = {
          id: `pin-${crypto.randomUUID()}`,
          floorId: pendingHit.floorId,
          roomId: pendingHit.roomId,
          roomName: pendingHit.roomName,
          position: pendingHit.position,
          normal: pendingHit.normal,
          createdAt: now,
        }
        const sources: SourceRef[] = []
        const text = note.trim()
        if (text) {
          sources.push({ id: `src-${crypto.randomUUID()}`, kind: 'note', text, createdAt: now })
        }
        onSave({
          title: title.trim() || 'Untitled matter',
          description: description.trim(),
          sources,
          pin,
        })
        setTitle('')
        setDescription('')
        setNote('')
      }}
    >
      <h1>Capture</h1>
      <p>
        {pendingHit.floorId}
        {pendingHit.roomName ? ` · ${pendingHit.roomName}` : ''} · {pendingHit.position.x.toFixed(2)},{' '}
        {pendingHit.position.z.toFixed(2)}
      </p>
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Description
        <textarea value={description} rows={2} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label>
        Note
        <textarea value={note} rows={3} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="row">
        <button type="submit">Save matter</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
