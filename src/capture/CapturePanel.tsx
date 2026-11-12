import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { CapturePanelProps, Pin, PlanHit, SourceRef } from '../types'
import { inferIssue } from './issueDetails'
import './capture.css'

const MAX_SIDE = 1280
const JPEG_QUALITY = 0.8

type DraftPhoto = { id: string; dataUrl: string; mimeType: string }

type SpeechResult = ArrayLike<{ transcript: string }> & { isFinal: boolean }

type SpeechResultEvent = {
  results: ArrayLike<SpeechResult>
}

type SpeechErrorEvent = { error?: string }

type SpeechSession = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
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

function dictationErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Allow microphone access to dictate. If this browser does not support Web Speech, use Chrome or Safari.'
    case 'audio-capture':
      return 'No microphone was detected.'
    case 'network':
      return 'Speech recognition needs an internet connection. Use Google Chrome or Safari.'
    case 'no-speech':
      return 'No speech detected — try speaking closer to the mic.'
    default:
      return code
        ? `Dictation failed (${code}). You can still type the description.`
        : 'Dictation is unavailable right now. You can still type the description.'
  }
}

function heardTranscript(event: SpeechResultEvent): { finalTranscript: string; interimTranscript: string } {
  const finals: string[] = []
  const interim: string[] = []
  for (let i = 0; i < event.results.length; i++) {
    const result = event.results[i]
    const text = result?.[0]?.transcript?.trim()
    if (!text) continue
    if (result?.isFinal) finals.push(text)
    else interim.push(text)
  }
  return { finalTranscript: finals.join(' '), interimTranscript: interim.join(' ') }
}

function textToCommit(finalTranscript: string, interimTranscript: string): string {
  const fallback = (finalTranscript || interimTranscript).trim()
  if (!finalTranscript.trim() || !interimTranscript.trim()) return fallback
  return `${finalTranscript.trim()} ${interimTranscript.trim()}`
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
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<DraftPhoto[]>([])
  const [dictations, setDictations] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const sessionRef = useRef<SpeechSession | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const canDictate = speechRecognitionCtor() !== null
  const place = [props.hit.floorId, props.hit.roomName].filter(Boolean).join(' · ')
  const issue = inferIssue([description, interim].filter(Boolean).join(' '))

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
    let finalTranscript = ''
    let interimTranscript = ''
    let committed = false
    let ended = false
    const commitHeard = () => {
      if (committed) return
      const transcript = textToCommit(finalTranscript, interimTranscript)
      if (!transcript) return
      committed = true
      setDescription((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript))
      setDictations((current) => [...current, transcript])
    }
    session.lang = 'en-GB'
    session.interimResults = true
    session.continuous = true
    session.onresult = (event) => {
      const heard = heardTranscript(event)
      finalTranscript = heard.finalTranscript
      interimTranscript = heard.interimTranscript
      if (ended) {
        commitHeard()
        return
      }
      setInterim(textToCommit(finalTranscript, interimTranscript))
    }
    session.onerror = (event) => {
      if (event.error === 'no-speech' && session.continuous) return
      setListening(false)
      setError(dictationErrorMessage(event.error))
    }
    session.onend = () => {
      ended = true
      commitHeard()
      setListening(false)
      setInterim('')
      sessionRef.current = null
    }
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
    if (busy || listening || !description.trim()) return
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
    const inferred = inferIssue(descriptionText)
    try {
      props.onSave({
        title: inferred.title || 'Untitled matter',
        issueType: inferred.trade,
        description: descriptionText,
        sources,
        pin,
      })
    } catch {
      setError('Could not save this issue. Browser storage may be full; try removing a photo.')
    }
  }

  return (
    <>
      <div className="cap-backdrop" onClick={props.onCancel} />
      <form className="cap-sheet" onSubmit={onSubmit}>
        <div className="cap-grab" aria-hidden="true" />
        <div className="cap-heading">
          <div><h1>What needs attention?</h1><p className="cap-place">{place}</p></div>
          <button type="button" className="cap-close" onClick={props.onCancel} aria-label="Close">×</button>
        </div>
        <button
          type="button"
          className={`cap-dictate${listening ? ' is-listening' : ''}`}
          onClick={onDictate}
          disabled={!canDictate}
          aria-pressed={listening}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" />
          </svg>
          <span>{listening ? 'Listening… tap to finish' : 'Tap to describe the issue'}</span>
        </button>
        {!canDictate ? <p className="cap-status">Dictation isn’t available in this browser. Type below instead.</p> : null}
        <label className="cap-description">
          <span className="cap-label">Your description</span>
          <textarea
            value={[description, interim].filter(Boolean).join(' ')}
            rows={3}
            placeholder="Describe what you see, or type here…"
            readOnly={listening}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {issue.title ? (
          <div className="cap-summary" aria-live="polite">
            <div><span className="cap-label">Title</span><strong>{issue.title}</strong></div>
            <div><span className="cap-label">Issue type</span><strong>{issue.label}</strong></div>
          </div>
        ) : null}
        <label className="cap-file">
          <span aria-hidden="true">＋</span> {busy ? 'Preparing photos…' : 'Add photos'}
          <input ref={fileRef} type="file" accept="image/*" multiple disabled={busy}
            onChange={(event) => void onFiles(event.target.files)} />
        </label>
        {photos.length > 0 ? (
          <ul className="cap-photos">
            {photos.map((photo, index) => (
              <li key={photo.id}>
                <img src={photo.dataUrl} alt={`Attachment ${index + 1}`} />
                <button type="button" aria-label={`Remove photo ${index + 1}`}
                  onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}>×</button>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="cap-error" role="alert">{error}</p> : null}
        <button className="cap-save" type="submit" disabled={busy || listening || !description.trim()}>Save issue</button>
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
