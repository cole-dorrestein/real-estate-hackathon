# PM Copilot

A property manager walks a building on their phone, drops a pin on a two-floor plan, and attaches photos and a note. That becomes a matter with a source trail. A dashboard lists the matters so someone can triage them and simulate contractor dispatch. This repo is the shared foundation those screens plug into.

## Run

```bash
npm install
npm run dev
```

To open it on a phone on the same network:

```bash
npm run dev -- --host
```

Check the production build with `npm run build`. None of the variables in `.env.example` are required to run the demo.

Matters are stored in `localStorage` under `pm.matters.v1`. Clear that key to load the three seed matters again. An uploaded plan is stored under `pm.plan.v1`; clear that key to return to the ResPlan seed.

## Routes

| Path | Screen |
| --- | --- |
| `/` | Walk-round: plan viewer and capture panel |
| `/?pin=<pinId>` | Same view, focused on that pin (`focusPinId`) |
| `/dashboard` | Matter list |
| `/dashboard/matters/:matterId` | One matter |
| `/upload` | Replace the active plan (stub until F5) |

Seeded kitchen pin: `/?pin=pin-faucet`.

## Plan data

Demo plan derived from ResPlan (Abouagour et al.), CC BY 4.0, https://github.com/m-agour/ResPlan.

`src/data/demo-plan.json` is ResPlan list index 0 (dataset id 14433), kept as floor `L1` (elevation 0) and copied to floor `L2` (elevation 3). L2 has a room named Kitchen. The pickle stores a normalised canvas (about 256 units across) plus an `area` in square metres, so the converter scales coordinates by `sqrt(area / inner.area)` and then shifts the plan to the origin. Room `points` are `[x, z]` metres after that. A pin's `position.y` is the floor elevation, and `position.x` / `position.z` are that plan point. Walls are the room edges, 0.15 m thick and 2.7 m tall.

The original `ResPlan.pkl` is not in this repo. `scripts/convert-resplan.py` rebuilds the JSON from a local copy of the pickle.

## File ownership

| Path | Owner |
| --- | --- |
| Root config, `src/main.tsx`, `src/shell`, `src/types`, `src/store`, `src/data` | F0 scaffolding |
| `src/viewer` | F1 3D viewer. Replace the stub `PlanViewer`. |
| `src/capture` | F2 capture. Replace the stub `CapturePanel`. |
| `src/dashboard` | F3 dashboard. Replace the stub `Dashboard` and `MatterDetail`. |
| `src/agent` and its server | F4 agent. Not created yet. |
| `src/upload` | F5 plan upload. Replace the stub `PlanUploader` and `planFile`. |

The shell imports these exports and nothing else from those folders:

- `export function PlanViewer(props: PlanViewerProps): JSX.Element` from `src/viewer/PlanViewer.tsx`
- `export function CapturePanel(props: CapturePanelProps): JSX.Element` from `src/capture/CapturePanel.tsx`
- `export function Dashboard(): JSX.Element` from `src/dashboard/Dashboard.tsx`
- `export function MatterDetail(props: { matterId: string }): JSX.Element` from `src/dashboard/MatterDetail.tsx`
- `export function PlanUploader(props: { onPlanReady: (plan: BuildingPlan) => void }): JSX.Element` from `src/upload/PlanUploader.tsx`

Shared types live in `src/types/index.ts`. `getBuildingPlan()` reads `localStorage['pm.plan.v1']` when it holds a plan, and otherwise the demo plan. `setActivePlan()` writes that key and `useBuildingPlan()` re-renders. `getMattersStore()` / `useMatters()` read and write matters.
