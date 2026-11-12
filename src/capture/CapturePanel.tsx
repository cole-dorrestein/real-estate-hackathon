import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { CapturePanelProps, Pin, PlanHit, SourceRef } from '../types'
import './capture.css'

const MAX_SIDE = 1280
const JPEG_QUALITY = 0.8

type DraftPhoto = { id: string; dataUrl: string; mimeType: string }

type SpeechResultEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

type SpeechSession = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechCtor = new () => SpeechSession

function speechRecognitionCtor(): SpeechCtor | null {
  const host = window as unknown as {
    SpeechRecognition?: SpeechCtor
    webkitSpeechRecognition?: SpeechCtor
  }
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null
}

function titleFromDescription(description: string): string {
  const words = description.trim().split(/\s+/).slice(0, 8).join(' ')
  return words || 'Untitled matter'
}

function transcriptOf(event: SpeechResultEvent): string {
  const parts: string[] = []
  for (let i = 0; i < event.results.length; i++) {
    const text = event.results[i]?.[0]?.transcript?.trim()
    if (text) parts.push(text)
  }
  return parts.join(' ')
}

async function downscalePhoto(file: File): Promise<DraftPhoto> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return {
      id: crypto.randomUUID(),
      dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY),
      mimeType: 'image/jpeg',
    }
  } finally {
    bitmap.close()
  }
}

function CaptureSheet(props: {
  hit: PlanHit
  onCancel: () => void
  onSave: CapturePanelProps['onSave']
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<DraftPhoto[]>([])
  const [dictations, setDictations] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const sessionRef = useRef<SpeechSession | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canDictate = speechRecognitionCtor() !== null
  const place = [props.hit.floorId, props.hit.roomName].filter(Boolean).join(' · ')

  useEffect(() => {
    return () => {
      try {
        sessionRef.current?.stop()
      } catch {
        // The session may already have ended.
      }
    }
  }, [])

  async function onFiles(list: FileList | null) {
    const files = list ? Array.from(list) : []
    if (fileRef.current) fileRef.current.value = ''
    if (files.length === 0) return
    setBusy(true)
    setError('')
    const settled = await Promise.allSettled(files.map(downscalePhoto))
    const next = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    setPhotos((current) => [...current, ...next])
    if (next.length !== files.length) setError('Could not read one of those photos.')
    setBusy(false)
  }

  function onDictate() {
    const Ctor = speechRecognitionCtor()
    if (!Ctor) return
    if (listening) {
      sessionRef.current?.stop()
      return
    }
    const session = new Ctor()
    let committed = false
    session.lang = 'en-US'
    session.interimResults = false
    session.continuous = false
    session.onresult = (event) => {
      if (committed) return
      const transcript = transcriptOf(event)
      if (!transcript) return
      committed = true
      setDescription((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript))
      setDictations((current) => [...current, transcript])
    }
    session.onerror = () => {
      setListening(false)
      setError('Dictation is unavailable right now. You can still type the description.')
    }
    session.onend = () => setListening(false)
    sessionRef.current = session
    try {
      session.start()
      setListening(true)
      setError('')
    } catch {
      setListening(false)
      setError('Dictation is unavailable right now. You can still type the description.')
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const now = new Date().toISOString()
    const descriptionText = description.trim()
    const pin: Pin = {
      id: crypto.randomUUID(),
      floorId: props.hit.floorId,
      roomId: props.hit.roomId,
      roomName: props.hit.roomName,
      position: props.hit.position,
      normal: props.hit.normal,
      createdAt: now,
    }
    const sources: SourceRef[] = [
      ...photos.map((photo) => ({
        id: photo.id,
        kind: 'photo' as const,
        dataUrl: photo.dataUrl,
        mimeType: photo.mimeType,
        createdAt: now,
      })),
    ]
    if (descriptionText) {
      sources.push({ id: crypto.randomUUID(), kind: 'note', text: descriptionText, createdAt: now })
    }
    for (const text of dictations) {
      sources.push({ id: crypto.randomUUID(), kind: 'dictation', text, createdAt: now })
    }
    props.onSave({
      title: title.trim() || titleFromDescription(descriptionText),
      description: descriptionText,
      sources,
      pin,
    })
  }

  return (
    <>
      <div className="cap-backdrop" onClick={props.onCancel} />
      <form className="cap-sheet" onSubmit={onSubmit}>
        <div className="cap-grab" aria-hidden="true" />
        <h1>Log an issue</h1>
        <p className="cap-place">{place}</p>
        <label className="cap-field">
          Title
          <input
            value={title}
            placeholder="Short title"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="cap-field">
          Description
          <textarea
            value={description}
            rows={4}
            placeholder="What needs attention?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="cap-file">
          {busy ? 'Resizing photos…' : photos.length > 0 ? `Add photos (${photos.length})` : 'Add photos'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(event) => void onFiles(event.target.files)}
          />
        </label>
        {photos.length > 0 ? (
          <ul className="cap-photos">
            {photos.map((photo) => (
              <li key={photo.id}>
                <img src={photo.dataUrl} alt="Attached" />
                <button
                  type="button"
                  onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {canDictate ? (
          <button
            type="button"
            className="cap-dictate"
            onClick={onDictate}
            aria-label="Dictate"
            aria-pressed={listening}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
            </svg>
          </button>
        ) : null}
        {listening ? <p className="cap-status">Listening…</p> : null}
        {error ? <p className="cap-error">{error}</p> : null}
        <div className="cap-actions">
          <button type="submit" disabled={busy}>
            Save matter
          </button>
          <button type="button" className="secondary" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </>
  )
}

export function CapturePanel(props: CapturePanelProps): JSX.Element {
  if (!props.pendingHit) {
    return <p className="cap-hint">Tap the plan to drop a pin</p>
  }
  const hit = props.pendingHit
  return (
    <CaptureSheet
      key={`${hit.floorId}:${hit.roomId ?? ''}:${hit.position.x}:${hit.position.y}:${hit.position.z}`}
      hit={hit}
      onCancel={props.onCancel}
      onSave={props.onSave}
    />
  )
}
