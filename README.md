# Dr. Macx — Every machine, checked.

Machine OEE monitoring for the Google Cloud AI Builder Cup 2026 (Manufacturing: Intelligent Operations & Industrial Efficiency).
Dr. Macx reads four signals per machine (run/stop, total count, NC count, alarm code) from the PLC through Kepware — or from a
built-in dummy PLC generator — and turns them into Availability, Performance, Quality and OEE per shift, records every stop,
and uses Google AI to explain and classify downtime.

## Stack

- `client/` — React 19 + Vite + Material UI v7 (+ react-three-fiber for the 3D Floor, MUI X Charts)
- `server/` — Node 22 + Express 5: master-data API, 1 s tag poller, OEE engine, Gemini / Gemma calls; serves the React build
- Firestore — master data, hourly OEE buckets, downtime events, points
- Google AI — **Gemma** (`gemma-4-26b-a4b-it`) suggests a stop's reason from the operator's note in any language;
  **Gemini** (`gemini-3.8-flash`) analyses downtime and answers questions in a chat
- One container on Cloud Run

## Pages

| Page | What it does |
| --- | --- |
| Dashboard | Plant OEE for the shift, machine status, output, OEE by machine, stopped machines |
| Machine monitoring | One card per machine, judged green / yellow / red against its own targets; OEE simulation (dummy machines); stops to confirm |
| Machine detail › Live | Shift KPIs, live tag values |
| Machine detail › OEE history | Shift timeline (bar + list), KPIs, by-shift comparison, OEE / A / P / Q trends, history table; filter by period, shift, hour/shift/day |
| Machine detail › Downtime & AI | Stops, Pareto, trend, repeated cases, downtime log with confirm, Gemini analysis and chat |
| 3D Floor | Gamified floor: presses and operators from master data, live counts, stop reactions, submit reason, points leaderboard; list view fallback |
| Master data | Machines (incl. targets & tolerance), OEE calculation (breaks, break tolerance), Downtime reasons, Operators, Skill matrix, Users & roles |

## Run locally

Needs Node 22+ and Java 11+ (for the Firestore emulator).

```bash
npm install
npm run dev
```

Opens the Firestore emulator (:8085), API (:8080) and web app (http://localhost:5173). Emulator data is in memory, so every start
re-seeds the demo data (1 machine, operators, skills, users, downtime reasons, breaks) and 30 days of simulated history.

For the AI features, copy `.env.example` to `.env` and set `GEMINI_API_KEY` (from https://aistudio.google.com/apikey).
`npm run seed` loads the same demo data into whatever Firestore the environment points at.

```bash
npm test
```

## OEE, breaks and downtime

- Shifts: 07:00–15:00, 15:00–23:00, 23:00–07:00. Each shift has a 15 min tea break after the first 2 h and a 45 min lunch
  after 5 h (1 h of breaks per shift), set on the OEE calculation page.
- Planned time = shift time − breaks − confirmed **planned** stops (maintenance, meetings, QC patrol).
  Availability = run time ÷ planned time · Performance = ideal CT × total ÷ run time · Quality = good ÷ total · OEE = A × P × Q.
- Rejected pieces are called **NC** (non-conformance).
- Every stop outside a break is recorded (`machines/{id}/downtime`) and waits for a confirmed reason; the PLC alarm pre-fills a
  suggestion and Gemma can suggest one from the operator's spoken or typed note (translated to English).
- An **Operator break** reason fits only a stop during a break or within the break tolerance before / after it (default ±5 min).
- A **repeated case** is the same reason 3+ times on one machine within 24 h.
- Schedule target (3D Floor): pieces due by now = (time since shift start − breaks − planned stops) ÷ ideal cycle time.

## Downtime and points API

| Method & path | Purpose |
| --- | --- |
| `GET /api/machines/:id/downtime?from&to&shift` | Stops in a range with reasons, repeats and stats |
| `GET /api/machines/:id/downtime/pending` | Stops still waiting for a reason |
| `PUT /api/machines/:id/downtime/:eventId` | Confirm / change a reason: `{ reasonCode, comment, operatorId? }` |
| `POST /api/machines/:id/downtime/:eventId/suggest` | Gemma reason suggestion: `{ note }` (any language) |
| `GET /api/machines/:id/timeline?start` | Shift timeline segments (run / unplanned / planned / break / no data) |
| `GET /api/machines/:id/history?from&to&by&shift` | OEE rows, by-shift summary, totals |
| `POST /api/machines/:id/analysis`, `POST /api/machines/:id/chat` | Gemini analysis and chat |
| `GET /api/points` | Leaderboard for the current shift |

**Points (3D Floor):** an operator who gives a stop its reason earns **+10** if it is within 5 min of the stop starting, **+5**
later; only the first confirmation of a stop scores, and the operator must have skill level 2 ("Can run") on that machine.
The waiting-for-reason counter turns red when a stop has waited more than 15 min.

## Deploy to Cloud Run

Create a GCP project, enable Cloud Run, Cloud Build, Firestore (Native mode), Secret Manager and Vertex AI, store the AI
Studio key in Secret Manager as `gemini-api-key`, give the Cloud Run service account `roles/datastore.user`,
`roles/secretmanager.secretAccessor` and `roles/aiplatform.user`, then:

```bash
gcloud run deploy dr-macx --source . --region asia-southeast2 --allow-unauthenticated --min-instances 1 --max-instances 1 --no-cpu-throttling --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_LOCATION=global --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

- **Gemini** runs through **Vertex AI** with the service account, billed to the Cloud billing account
  (`gemini-3.8-flash` is served in the `global` location).
- **Gemma** is served only through the Gemini API, so it uses the AI Studio key and needs AI Studio prepay credit.
- The sidebar's **AI models** panel shows each model, how it is reached and whether its last call worked.

The poller and shift accumulators live in memory, so the service runs as a single always-on instance. Set the plant time zone
with the `TZ` env var (default `Asia/Jakarta` in the Dockerfile).
