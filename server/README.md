# Dispatch server

The browser never calls the Grok Bot webhook. This process holds the webhook URL and key. Triage is deterministic and runs in the browser (`src/agent/triage.ts`) with no LLM. Nothing is dispatched until the property manager clicks Dispatch, which calls `simulateDispatch`.

## Run

From the repo root:

```bash
npx tsx server/dispatch.ts
```

The server listens on `0.0.0.0:8787` and sends CORS headers so the Vite dev origin can call it.

Send a harmless setup probe (payload includes `probe: true`):

```bash
npx tsx server/dispatch.ts --probe
```

or `POST /api/dispatch/probe` on a running server.

## .env.local

Put these in `.env.local` at the repo root (already gitignored). Do not use a `VITE_` prefix. They must not be imported by client code.

```bash
GROKBOT_WEBHOOK_URL=
GROKBOT_WEBHOOK_KEY=
DISPATCH_CALLBACK_BASE_URL=
DISPATCH_STATUS_DIR=
DISPATCH_ALLOWED_ORIGINS=
```

| Key | Required | Purpose |
| --- | --- | --- |
| `GROKBOT_WEBHOOK_URL` | no | Hack-dispatch webhook. If unset, a dispatch is stored as `failed` and the payload is appended to `server/dispatch-failed.jsonl`. |
| `GROKBOT_WEBHOOK_KEY` | no | Sent as `Authorization: Bearer <key>` and `X-Automation-Key: <key>`. |
| `DISPATCH_CALLBACK_BASE_URL` | no | Origin only, for example `http://127.0.0.1:8787`. When set, the webhook payload includes `callbackUrl` (`<origin>/api/dispatch/<matterId>/status`) and `statusToken`. A `pinUrl` may also start with this origin. |
| `DISPATCH_STATUS_DIR` | no | Where status files are read. Default `/workspace/hackathon/dispatch-status`. If that directory cannot be created, the server uses `./dispatch-status`. |
| `DISPATCH_ALLOWED_ORIGINS` | no | Comma-separated extra browser origins allowed to dispatch, for example `http://192.168.1.20:5173`. `http://localhost:5173` and `http://127.0.0.1:5173` are always allowed. |

`POST /api/dispatch` and `POST /api/dispatch/probe` require an `Origin` on that list. Any other origin, or a missing `Origin`, gets 403. The response never reflects an origin that is not on the list. `pinUrl` must start with an allowed origin or `DISPATCH_CALLBACK_BASE_URL`, otherwise 400. A second dispatch for a matter that is not `failed` returns 409 and keeps the existing status token.

The webhook call is one try, 8 second timeout, no retry. HTTP 200 sets the job to `dispatched`. Any failure sets `failed`.

## Contractors

Contacts stay on the server. `server/contractors.example.json` has obvious placeholders (one phone or one email per trade, never both). Copy it to `server/contractors.local.json` to override. Do not commit the local file, and do not put a real person's name, phone, or email in either file.

`GET /api/contractors/:trade` returns `{ "name", "channel" }` and nothing else. `channel` is `phone` when that contractor has a phone, otherwise `email`.

`GET /api/contractors` uses the same `Origin` allowlist as dispatch. It returns only the plumber and electrician, each as `{ "id", "name", "trade", "channel" }` plus `phone` or `email`. `id` is the trade (the file index also works as an id on dispatch). Phone or email is included so the dashboard can show it.

## HTTP

`POST /api/dispatch` body: `{ matter, triage, brief, contractorId? }`. `matter` must not include `data:` photo URLs. With no `contractorId`, the server picks the contractor by `triage.trade`, unchanged. When `contractorId` is present, that contractor is used instead. It posts this webhook payload (http(s) photo URLs only):

```json
{
  "matterId": "matter-faucet",
  "title": "Broken faucet",
  "trade": "plumber",
  "priority": "P1",
  "location": { "floor": "L2", "room": "Kitchen" },
  "description": "...",
  "photoUrls": [],
  "pinUrl": "http://localhost:5173/?pin=pin-faucet",
  "contractor": { "name": "Demo Plumber", "trade": "plumber", "phone": "+44 7700 900000" },
  "channel": "phone"
}
```

`GET /api/dispatch/:matterId` returns the current job. On each read the server also applies `DISPATCH_STATUS_DIR/<matterId>.json` when that report is newer. Shape:

```json
{ "matterId": "matter-faucet", "status": "visit_agreed", "channel": "phone", "visitAt": "Friday 09:00", "summary": "Spoke to the plumber and booked Friday morning.", "at": "2026-11-12T21:00:00.000Z" }
```

`status` is `contacted`, `visit_agreed`, or `failed`. `summary` is optional: a call transcript or short summary. The server copies it onto the job, and `GET /api/dispatch/:matterId` returns it. The latest report wins (file or callback).

`POST /api/dispatch/:matterId/status` is the optional callback. It requires the job's `statusToken` as `Authorization: Bearer <statusToken>`, in the `X-Status-Token` header, or in a `statusToken` field. Same body shape as the status file.

Jobs are kept in memory and in `server/dispatch-jobs.json` (includes the status token; do not commit).

Job status values: `dispatched`, `contacted`, `visit_agreed`, `failed`.

## Gitignore

F0 owns `.gitignore`. These generated paths must stay untracked:

```
server/contractors.local.json
server/dispatch-failed.jsonl
server/dispatch-jobs.json
dispatch-status/
```

`server/dispatch-jobs.json` stores jobs and the status token. `dispatch-status/` is the fallback status directory.
