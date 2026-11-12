import { useState, type JSX, type MouseEvent } from 'react'
import type { BuildingPlan, Vec2, Wall } from '../types'
import { UPLOADED_PLAN_STORAGE_KEY } from './planFile'

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
const DEFAULT_MPP = '0.02'
const CLOSE_HIT_PX = 20

type Point = [number, number]

type RoomDraft = {
  id: string
  name: string
  points: Point[]
}

type FloorDraft = {
  id: string
  elevation: number
  fileName: string
  label: string
  dataUrl: string
  width: number
  height: number
  rooms: RoomDraft[]
  open: Point[]
}

type PageImage = {
  fileName: string
  label: string
  dataUrl: string
  width: number
  height: number
}

type PdfViewport = { width: number; height: number }

type PdfjsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (src: { data: Uint8Array }) => {
    promise: Promise<{
      numPages: number
      getPage: (pageNumber: number) => Promise<{
        getViewport: (params: { scale: number }) => PdfViewport
        render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => {
          promise: Promise<void>
        }
      }>
    }>
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new Error('That image has no size'))
        return
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => reject(new Error('Could not read that image'))
    image.src = dataUrl
  })
}

async function loadPdfjs(): Promise<PdfjsModule> {
  const specifier = PDFJS_URL
  const loaded = (await import(/* @vite-ignore */ specifier)) as Partial<PdfjsModule> & {
    default?: Partial<PdfjsModule>
  }
  const api = typeof loaded.getDocument === 'function' ? loaded : loaded.default
  if (!api?.getDocument || !api.GlobalWorkerOptions) {
    throw new Error('Could not load PDF.js. Upload an image instead.')
  }
  return api as PdfjsModule
}

async function rasterizePdf(data: Uint8Array): Promise<Array<{ dataUrl: string; width: number; height: number }>> {
  try {
    const pdfjs = await loadPdfjs()
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL
    const pdf = await pdfjs.getDocument({ data }).promise
    if (pdf.numPages < 1) throw new Error('That PDF has no pages')
    const pages: Array<{ dataUrl: string; width: number; height: number }> = []
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not draw the PDF page')
      await page.render({ canvasContext: context, viewport }).promise
      pages.push({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })
    }
    return pages
  } catch (error) {
    if (error instanceof Error && error.message.includes('Upload an image')) throw error
    const detail = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Could not read that PDF (${detail}). Upload an image instead.`)
  }
}

function roomId(rooms: RoomDraft[], name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  const base = slug || 'room'
  const taken = new Set(rooms.map((room) => room.id))
  let index = 0
  while (taken.has(`${base}_${index}`)) index += 1
  return `${base}_${index}`
}

function makeFloor(page: PageImage, index: number): FloorDraft {
  return {
    id: `L${index + 1}`,
    elevation: index * 3,
    fileName: page.fileName,
    label: page.label,
    dataUrl: page.dataUrl,
    width: page.width,
    height: page.height,
    rooms: [],
    open: [],
  }
}

// Image y grows downward. The viewer maps [x, y] to world x and z, so pixel y is stored as-is.
function toMetres(points: Point[], metresPerPixel: number): Vec2[] {
  return points.map(([x, y]): Vec2 => [round3(x * metresPerPixel), round3(y * metresPerPixel)])
}

const WALL_THICKNESS = 0.1
const WALL_HEIGHT = 2.7
const EDGE_TOLERANCE = 0.05

function nearPoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= EDGE_TOLERANCE && Math.abs(a[1] - b[1]) <= EDGE_TOLERANCE
}

function wallsFromRooms(rooms: Array<{ points: Vec2[] }>): Wall[] {
  const walls: Wall[] = []
  for (const room of rooms) {
    const { points } = room
    for (let index = 0; index < points.length; index += 1) {
      const from = points[index]
      const to = points[(index + 1) % points.length]
      if (nearPoint(from, to)) continue
      const shared = walls.some(
        (wall) =>
          (nearPoint(wall.from, from) && nearPoint(wall.to, to)) ||
          (nearPoint(wall.from, to) && nearPoint(wall.to, from)),
      )
      if (shared) continue
      walls.push({ from, to, thickness: WALL_THICKNESS, height: WALL_HEIGHT })
    }
  }
  return walls
}

function buildPlan(floors: FloorDraft[], metresPerPixel: number): BuildingPlan {
  const names = [...new Set(floors.map((floor) => floor.fileName))]
  return {
    source: `uploaded:${names.join('+')}`,
    floors: floors.map((floor) => {
      const rooms = floor.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        points: toMetres(room.points, metresPerPixel),
      }))
      return {
        id: floor.id,
        elevation: round3(floor.elevation),
        rooms,
        walls: wallsFromRooms(rooms),
      }
    }),
  }
}

function imagePoint(event: MouseEvent<HTMLDivElement>, floor: FloorDraft): Point | null {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const x = ((event.clientX - rect.left) / rect.width) * floor.width
  const y = ((event.clientY - rect.top) / rect.height) * floor.height
  return [Math.min(floor.width, Math.max(0, x)), Math.min(floor.height, Math.max(0, y))]
}

function screenDistance(event: MouseEvent<HTMLDivElement>, floor: FloorDraft, point: Point): number {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = rect.left + (point[0] / floor.width) * rect.width
  const y = rect.top + (point[1] / floor.height) * rect.height
  return Math.hypot(event.clientX - x, event.clientY - y)
}

export function PlanUploader({
  onPlanReady,
}: {
  onPlanReady: (plan: BuildingPlan) => void
}): JSX.Element {
  const [floors, setFloors] = useState<FloorDraft[]>([])
  const [active, setActive] = useState(0)
  const [roomName, setRoomName] = useState('')
  const [mppText, setMppText] = useState(DEFAULT_MPP)
  const [measuring, setMeasuring] = useState(false)
  const [measure, setMeasure] = useState<Point[]>([])
  const [lengthText, setLengthText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const floor = floors[active]
  const parsedMpp = Number(mppText)
  const metresPerPixel = Number.isFinite(parsedMpp) && parsedMpp > 0 ? parsedMpp : null

  function updateActive(patch: (floor: FloorDraft) => FloorDraft) {
    setFloors((current) => current.map((item, index) => (index === active ? patch(item) : item)))
  }

  async function addFiles(files: File[]) {
    setBusy(true)
    setMessage('')
    const pages: PageImage[] = []
    const errors: string[] = []
    for (const file of files) {
      try {
        if (isPdf(file)) {
          setMessage(`Reading ${file.name}…`)
          const rasters = await rasterizePdf(new Uint8Array(await file.arrayBuffer()))
          rasters.forEach((raster, index) => {
            pages.push({
              fileName: file.name,
              label: rasters.length > 1 ? `${file.name} p.${index + 1}` : file.name,
              dataUrl: raster.dataUrl,
              width: raster.width,
              height: raster.height,
            })
          })
        } else {
          const dataUrl = await readDataUrl(file)
          const size = await measureImage(dataUrl)
          pages.push({ fileName: file.name, label: file.name, dataUrl, ...size })
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Could not read ${file.name}`)
      }
    }
    if (pages.length > 0) {
      const start = floors.length
      setFloors((current) => {
        const next = [...current]
        for (const page of pages) next.push(makeFloor(page, next.length))
        return next
      })
      setActive(start)
    }
    setMessage(errors.join(' '))
    setBusy(false)
  }

  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    if (!floor) return
    const point = imagePoint(event, floor)
    if (!point) return
    if (measuring) {
      setMeasure((points) => (points.length >= 2 ? [point] : [...points, point]))
      setMessage('')
      return
    }
    if (floor.open.length >= 3 && screenDistance(event, floor, floor.open[0]) <= CLOSE_HIT_PX) {
      closeRoom()
      return
    }
    const last = floor.open[floor.open.length - 1]
    if (last && screenDistance(event, floor, last) < 4) return
    updateActive((current) => ({ ...current, open: [...current.open, point] }))
    setMessage('')
  }

  function closeRoom() {
    if (!floor) return
    const name = roomName.trim()
    if (!name) {
      setMessage('Name the room before closing it.')
      return
    }
    if (floor.open.length < 3) {
      setMessage('Add at least three points before closing the room.')
      return
    }
    const id = roomId(floor.rooms, name)
    const points = floor.open
    updateActive((current) => ({
      ...current,
      open: [],
      rooms: [...current.rooms, { id, name, points }],
    }))
    setRoomName('')
    setMessage('')
  }

  function undoPoint() {
    if (measuring) {
      setMeasure((points) => points.slice(0, -1))
      return
    }
    updateActive((current) => ({ ...current, open: current.open.slice(0, -1) }))
  }

  function applyScale() {
    if (measure.length < 2) {
      setMessage('Click two points on the plan first.')
      return
    }
    const metres = Number(lengthText)
    const pixels = Math.hypot(measure[1][0] - measure[0][0], measure[1][1] - measure[0][1])
    if (!Number.isFinite(metres) || metres <= 0 || pixels < 1) {
      setMessage('Enter how many metres that traced length is.')
      return
    }
    const next = metres / pixels
    setMppText(String(Number(next.toPrecision(6))))
    setMeasuring(false)
    setMessage(`Scale set to ${next.toPrecision(4)} m per pixel.`)
  }

  function usePlan() {
    if (floors.length === 0) {
      setMessage('Upload a floor plan first.')
      return
    }
    if (floors.some((item) => item.open.length > 0)) {
      setMessage('Close the open room, or undo its points, before using the plan.')
      return
    }
    if (metresPerPixel === null) {
      setMessage('Enter a metres-per-pixel scale greater than zero.')
      return
    }
    onPlanReady(buildPlan(floors, metresPerPixel))
  }

  function resetToDemo() {
    localStorage.removeItem(UPLOADED_PLAN_STORAGE_KEY)
    window.location.assign('/')
  }

  const pixelLength =
    measure.length === 2 ? Math.hypot(measure[1][0] - measure[0][0], measure[1][1] - measure[0][1]) : null

  return (
    <section className="card">
      <h1>Upload plan</h1>
      <p>Upload a floor-plan image, or a PDF (one floor per page). Click around a room, then close it and name it.</p>
      <label>
        Floor plan image or PDF
        <input
          type="file"
          accept="image/*,application/pdf,.pdf"
          multiple
          disabled={busy}
          onChange={(event) => {
            const list = event.target.files
            if (!list || list.length === 0) return
            const files = Array.from(list)
            event.target.value = ''
            void addFiles(files)
          }}
        />
      </label>
      {message ? <p className="meta">{message}</p> : null}
      <label>
        Metres per pixel
        <input
          type="number"
          min="0"
          step="any"
          value={mppText}
          onChange={(event) => setMppText(event.target.value)}
        />
      </label>
      <p className="meta">Default is 0.02. Or trace a known length and say how many metres it is.</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          type="button"
          className={measuring ? undefined : 'secondary'}
          onClick={() => {
            setMeasuring((current) => !current)
            setMeasure([])
            setMessage('')
          }}
        >
          {measuring ? 'Cancel measure' : 'Measure a length'}
        </button>
        {measuring ? (
          <button type="button" onClick={applyScale}>
            Apply scale
          </button>
        ) : null}
      </div>
      {measuring ? (
        <label>
          This traced length is
          <input
            type="number"
            min="0"
            step="any"
            value={lengthText}
            placeholder="metres"
            onChange={(event) => setLengthText(event.target.value)}
          />
          <span className="meta">
            {pixelLength === null
              ? `Click ${2 - measure.length} more point${measure.length === 1 ? '' : 's'} on the plan.`
              : `${round3(pixelLength)} px. Click Apply scale.`}
          </span>
        </label>
      ) : null}

      {floors.length > 0 ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {floors.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className={index === active ? undefined : 'secondary'}
              aria-pressed={index === active}
              onClick={() => setActive(index)}
            >
              {item.id}
            </button>
          ))}
        </div>
      ) : (
        <p className="meta">No floors yet. Each image, and each PDF page, becomes the next floor (L1, L2, …).</p>
      )}

      {floor ? (
        <>
          <p className="meta">
            {floor.label} · {floor.width}×{floor.height} px
          </p>
          <label>
            Elevation (m)
            <input
              type="number"
              step="0.1"
              value={floor.elevation}
              onChange={(event) => {
                const elevation = Number(event.target.value)
                if (!Number.isFinite(elevation)) return
                updateActive((current) => ({ ...current, elevation }))
              }}
            />
          </label>
          <div
            role="application"
            aria-label="Trace rooms on this floor"
            onClick={onStageClick}
            style={{ position: 'relative', width: '100%', cursor: 'crosshair', background: '#efe7da', borderRadius: 8 }}
          >
            <img
              src={floor.dataUrl}
              alt=""
              draggable={false}
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8 }}
            />
            <FloorSvg floor={floor} measure={measure} />
          </div>
          <p className="meta">
            {floor.open.length === 0
              ? 'Click the plan to drop room corners.'
              : `${floor.open.length} point${floor.open.length === 1 ? '' : 's'}. Click the first point, or Close room.`}
          </p>
          <label>
            Room name
            <input value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Kitchen" />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="secondary" onClick={undoPoint}>
              Undo point
            </button>
            <button type="button" onClick={closeRoom}>
              Close room
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setFloors((current) =>
                  current.filter((_, index) => index !== active).map((item, index) => ({ ...item, id: `L${index + 1}` })),
                )
                setActive((current) => Math.max(0, Math.min(current, floors.length - 2)))
              }}
            >
              Remove floor
            </button>
          </div>
          {floor.rooms.length === 0 ? (
            <p className="meta">No rooms on {floor.id} yet.</p>
          ) : (
            <ul className="stack-list">
              {floor.rooms.map((room) => (
                <li key={room.id}>
                  <span>
                    {room.name} <span className="meta">({room.id})</span>
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      updateActive((current) => ({
                        ...current,
                        rooms: current.rooms.filter((item) => item.id !== room.id),
                      }))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" onClick={usePlan}>
          Use this plan
        </button>
        <button type="button" className="secondary" onClick={resetToDemo}>
          Reset to demo plan
        </button>
      </div>
    </section>
  )
}

function FloorSvg({ floor, measure }: { floor: FloorDraft; measure: Point[] }) {
  const unit = Math.max(floor.width, floor.height)
  return (
    <svg
      viewBox={`0 0 ${floor.width} ${floor.height}`}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {floor.rooms.map((room) => (
        <polygon
          key={room.id}
          points={room.points.map((point) => point.join(',')).join(' ')}
          fill="rgba(31, 58, 46, 0.16)"
          stroke="#1f3a2e"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {floor.open.length > 0 ? (
        <polyline
          points={floor.open.map((point) => point.join(',')).join(' ')}
          fill="none"
          stroke="#9a3412"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {floor.open.map((point, index) => (
        <circle
          key={`${point[0]}-${point[1]}-${index}`}
          cx={point[0]}
          cy={point[1]}
          r={index === 0 ? unit / 45 : unit / 90}
          fill={index === 0 ? '#9a3412' : '#1f3a2e'}
        />
      ))}
      {measure.length === 2 ? (
        <line
          x1={measure[0][0]}
          y1={measure[0][1]}
          x2={measure[1][0]}
          y2={measure[1][1]}
          stroke="#1d4e89"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {measure.map((point, index) => (
        <circle key={`m-${index}`} cx={point[0]} cy={point[1]} r={unit / 70} fill="#1d4e89" />
      ))}
    </svg>
  )
}

