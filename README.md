# Dr. Macx — Every machine, checked.

OEE monitoring for **stamping presses**, built for the Google Cloud AI Builder Cup 2026 (Manufacturing: Intelligent Operations &
Industrial Efficiency). Each press carries a sensor set (Essential or Premium) wired to its PLC; Dr. Macx reads the sensors through
Kepware (or a built-in press simulator), turns them into Availability, Performance, Quality and OEE per shift, records every stop,
and gives each press a voice: the **Machine Soul**, a kiosk where a 3D press character tells operators what is going on, asks
when output surprises it, shows faults on the press anatomy and hands over between shifts, using Gemini.

## Sensors

| Sensor | Setup | Feeds |
| --- | --- | --- |
| Laser eye at the exit chute (part count) | Essential | Performance, Quality |
| Clip-on current sensor on the main motor (off / idle / running) | Essential | Availability |
| PLC alarm word | Essential | Stop reasons |
| Tonnage load cell per node (2 or 4) | Premium | Quality risk, maintenance |
| Vibration (motor, gearbox), temperature (motor, gearbox, lube line) | Premium | Prediction |
| Vision camera at the exit (NC count) | Premium | Quality |
| Acoustic stick score, network I/O module (proximity-sensor health) | Premium | Stop prediction, remote diagnosis |

Essential presses get NC from the operator. Each sensor is one PLC tag per press (Machines › Press & sensors). Tonnage nodes are
judged against rated tonnage ÷ nodes ± tolerance (default 5 %, alarm at 1.5×), e.g. 400 t / 4 nodes = 100 t each.

## Stack

- `client/` — React 19 + Vite + Material UI v7 (+ react-three-fiber for the 3D Floor, MUI X Charts)
- `server/` — Node 22 + Express 5: master-data API, 1 s sensor poller + press simulator, OEE engine, Machine Soul brain,
  Gemini calls; serves the React build
- Firestore — master data, hourly OEE buckets, downtime events, points, Soul messages, shift handovers
- BigQuery (optional, `BQ_DATASET`) — per-minute sensor summaries (`sensor_minutes`), read by Gemini and the cycle-time learner
- Cloud Text-to-Speech — the press's voice (falls back to the browser's voice)
- Google AI on Vertex AI — **Gemini** (`gemini-3.8-flash`) for everything: stop-reason suggestions from the operator's note in
  any language, downtime analysis, chat, the Machine Soul's words, translation and shift handovers
- One container on Cloud Run

## Pages

| Page | What it does |
| --- | --- |
| Dashboard | Plant OEE for the shift, machine status, output, OEE by machine, stopped machines |
| Machine monitoring | One card per machine, judged green / yellow / red against its own targets; OEE simulation (dummy machines); stops to confirm |
| Machine Soul (`/soul`, kiosk) | Pick a press, sign in with an employee number (active, skill ≥ 2). 3D press character with OEE mood, what it said, schedule vs actual, events, stops waiting for a reason, Ask Gemini, explain by voice, anatomy, handovers; language per kiosk |
| Machine detail › Live | Shift KPIs, sensor values with ok / warn / alarm, NC entry (Essential) |
| Machine detail › OEE history | Shift timeline (bar + list), KPIs, by-shift comparison, OEE / A / P / Q trends, history table; filter by period, shift, hour/shift/day |
| Machine detail › Downtime & AI | Stops, Pareto, trend, repeated cases, downtime log with confirm, Gemini analysis and chat |
| Machine detail › Anatomy | Isometric press drawing + 3D view; the part with the worst sensor is lit, with its live reading |
| Machine detail › Shift handovers | What each finished shift handed to the next |
| 3D Floor | Gamified floor: presses and operators from master data, live counts, stop reactions, submit reason, points leaderboard; list view fallback |
| Master data | Machines (targets & tolerance, press & sensors, cycle-time suggestions to approve), OEE calculation (breaks, break tolerance), Downtime reasons, Operators, Skill matrix, Users & roles |

## Run locally

Needs Node 22+ and Java 11+ (for the Firestore emulator).

```bash
npm install
npm run dev
```

Opens the Firestore emulator (:8085), API (:8080) and web app (http://localhost:5173). Emulator data is in memory, so every start
re-seeds the demo data (PRS-03 Premium 400 t straight-side, PRS-05 Essential 160 t C-frame, operators, skills, users, downtime
reasons, breaks) and 30 days of simulated history.

For the AI features, copy `.env.example` to `.env`: with `GOOGLE_GENAI_USE_VERTEXAI=true` and `GCP_PROJECT` set, local runs use
Vertex AI through your `gcloud auth application-default login`. Set `BQ_DATASET` to also send telemetry to BigQuery.
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
  suggestion and Gemini can suggest one from the operator's spoken or typed note (translated to English).
- An **Operator break** reason fits only a stop during a break or within the break tolerance before / after it (default ±5 min).
- A **repeated case** is the same reason 3+ times on one machine within 24 h.
- Schedule target (3D Floor): pieces due by now = (time since shift start − breaks − planned stops) ÷ ideal cycle time.

## Machine Soul

The press speaks only on events (stored in `machines/{id}/soul`, translated into the kiosk language on read):

- **Sensor alert:** a sensor out of limits for 30 s, once per 30 min (sooner if a warning becomes an alarm); names the node or
  part and lights it on the anatomy.
- **Stop:** an unplanned stop lasting 1 min; Gemini names the probable cause from the sensors 60 / 30 / 5 s before the stop.
- **Target risk:** projected good pieces at shift end (current pace × remaining planned time) below plan × OEE target; hourly.
- **Question:** each hour, if output was below 85 % of what the last 3 hours' rate predicted ("I expected 400, made 310 — what
  happened?"); the operator answers with the mic and Gemini checks the answer against the data.
- **Cycle time:** once a day, the best steady stroke (mean of the fastest 10 % of fully-running minutes over the last 3 shifts;
  hour buckets without BigQuery) is compared with the ideal cycle time; more than 5 % off → a suggestion a supervisor approves or
  rejects on the Machines page.
- **Handover:** when a shift ends, Gemini summarises it (OEE, output vs plan, losses, open stops, sensor alerts, unanswered
  questions) with advice for the next shift (`machines/{id}/handovers`), and the press says it to the incoming shift.

## API

| Method & path | Purpose |
| --- | --- |
| `GET /api/machines/:id/downtime?from&to&shift` | Stops in a range with reasons, repeats and stats |
| `GET /api/machines/:id/downtime/pending` | Stops still waiting for a reason |
| `PUT /api/machines/:id/downtime/:eventId` | Confirm / change a reason: `{ reasonCode, comment, operatorId? }` |
| `POST /api/machines/:id/downtime/:eventId/suggest` | Gemini reason suggestion: `{ note }` (any language) |
| `GET /api/machines/:id/timeline?start` | Shift timeline segments (run / unplanned / planned / break / no data) |
| `GET /api/machines/:id/history?from&to&by&shift` | OEE rows, by-shift summary, totals |
| `POST /api/machines/:id/analysis`, `POST /api/machines/:id/chat` | Gemini analysis and chat |
| `GET /api/points` | Leaderboard for the current shift |
| `GET /api/sensors` | Sensor catalog |
| `PUT /api/machines/:id/simulation` | Simulator: `{ mode: worse\|normal\|better }` for all factors, `{ factor: availability\|performance\|quality, level }` for one, or `{ inject: looseNode\|stick\|ioFault\|overheat\|breakdown }` |
| `POST /api/machines/:id/nc` | Operator NC entry (Essential): `{ count, operatorId }` |
| `POST /api/soul/verify` | Kiosk sign-in: `{ machineId, code }` |
| `GET /api/machines/:id/soul?lang` | What the press said |
| `POST /api/machines/:id/soul/ask`, `POST /api/machines/:id/soul/explain` | Ask Gemini; explain by voice `{ text, lang, operatorId, replyTo? }` |
| `POST /api/tts` | Voice (MP3): `{ text, lang }` |
| `POST /api/machines/:id/cycle-time/learn`, `POST /api/machines/:id/cycle-time` | Check the cycle time now; approve / reject `{ approve }` |
| `GET /api/machines/:id/handovers` | Shift handover history |

**Points (3D Floor):** an operator who gives a stop its reason earns **+10** if it is within 5 min of the stop starting, **+5**
later; only the first confirmation of a stop scores, and the operator must have skill level 2 ("Can run") on that machine.
The waiting-for-reason counter turns red when a stop has waited more than 15 min.

## Deploy to Cloud Run

Create a GCP project, enable Cloud Run, Cloud Build, Firestore (Native mode), Vertex AI, BigQuery and Text-to-Speech, create
the BigQuery dataset `drmacx` (asia-southeast2), give the Cloud Run service account `roles/datastore.user`,
`roles/aiplatform.user`, `roles/bigquery.dataEditor` and `roles/bigquery.jobUser`, then:

```bash
gcloud run deploy dr-macx --source . --region asia-southeast2 --allow-unauthenticated --min-instances 1 --max-instances 1 --no-cpu-throttling --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,GCP_PROJECT=YOUR_PROJECT,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_LOCATION=global,BQ_DATASET=drmacx
```

- With `GOOGLE_GENAI_USE_VERTEXAI=true` Gemini (`gemini-3.8-flash`) runs through **Vertex AI** with the service account,
  billed to the Cloud billing account, on the `global` location. A busy (429) answer is retried twice.
- Without it, Gemini uses an AI Studio key (`GEMINI_API_KEY`), which needs AI Studio prepay credit.
- The sidebar's **AI models** panel shows the model, how it is reached and whether its last call worked.

The poller, shift accumulators and the Soul's throttles live in memory, so the service runs as a single always-on instance. Set the plant time zone
with the `TZ` env var (default `Asia/Jakarta` in the Dockerfile).
