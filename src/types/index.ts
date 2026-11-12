export type FloorId = string // seed uses "L1" | "L2"
export type Vec2 = [number, number]
export type Vec3 = { x: number; y: number; z: number }
export type Room = { id: string; name: string; points: Vec2[] }
export type Wall = { id?: string; from: Vec2; to: Vec2; thickness: number; height: number }
export type Floor = { id: FloorId; elevation: number; rooms: Room[]; walls: Wall[] }
export type BuildingPlan = { source: string; floors: Floor[] }
export type Pin = { id: string; floorId: FloorId; roomId?: string; roomName?: string; position: Vec3; normal?: Vec3; createdAt: string }
export type SourceKind = 'photo' | 'note' | 'dictation'
export type SourceRef = { id: string; kind: SourceKind; dataUrl?: string; text?: string; mimeType?: string; createdAt: string }
export type MatterStatus = 'open' | 'triaged' | 'dispatched'
export type Priority = 'P1' | 'P2' | 'P3'
export type Trade = 'plumber' | 'electrician' | 'carpenter' | 'general'
export type Triage = { priority: Priority; trade: Trade; summary: string; reasoning: string; model: string; at: string }
export type ContractorBrief = { contractorName: string; trade: Trade; locationText: string; pinUrl: string; body: string; at: string } // pinUrl = origin + "/?pin=" + pin.id
export type Dispatch = { status: 'simulated'; channel: 'dashboard'; sentAt: string; contractorName: string }
export type Matter = { id: string; title: string; description: string; issueType?: Trade; pin: Pin; sources: SourceRef[]; status: MatterStatus; triage?: Triage; brief?: ContractorBrief; dispatch?: Dispatch; createdAt: string; updatedAt: string }
export type PlanHit = { position: Vec3; normal?: Vec3; floorId: FloorId; roomId?: string; roomName?: string }
export type PlanViewerProps = { plan: BuildingPlan; matters: Matter[]; focusPinId?: string; onPinClick?: (pinId: string) => void; onDropRequest?: (hit: PlanHit) => void }
export type CapturePanelProps = { pendingHit: PlanHit | null; onCancel: () => void; onSave: (input: { title: string; description: string; issueType: Trade; sources: SourceRef[]; pin: Pin }) => void }
