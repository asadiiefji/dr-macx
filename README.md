<p align="center"><img src="client/public/favicon.svg" width="88" alt="Dr. Macx logo"></p>

# Dr. Macx — Every machine, checked.

**Live demo:** https://dr-macx-392303972228.asia-southeast2.run.app · kiosk: [`/soul`](https://dr-macx-392303972228.asia-southeast2.run.app/soul)

OEE monitoring for **machine presses** (stamping), built for the Google Cloud AI Builder Cup 2026 (Manufacturing: Intelligent
Operations & Industrial Efficiency). Each machine press carries a sensor set (Essential or Premium) wired to its PLC; Dr. Macx
reads the sensors from **Kepware** (or a built-in simulator), turns them into Availability, Performance, Quality and OEE per
shift, records every stop, and gives each machine a voice: **Dr. Macx Live**, a kiosk where a 3D machine character tells
operators what is going on and what to do next, asks when output surprises it, shows faults on the machine anatomy and hands
over between shifts, using Gemini.

## Data source

| Source | Use |
| --- | --- |
| **Kepware** (production) | The plant edge PC runs Kepware's IoT Gateway (REST client agent) and POSTs tag values every second to `POST /api/kepware/ingest` with `Authorization: Bearer <KEPWARE_TOKEN>`. Each sensor maps to one tag per machine (Master data › Machines › Connection & tags); a needed tag missing for 10 s marks the machine disconnected. |
| Simulator (demo) | Stroke-level machine simulator with fault scenarios (loose node, sticking part, I/O fault, overheat, breakdown) and worse / normal / better modes. |

The source is chosen per machine, so simulated and Kepware machines run side by side. Cloud Run never reaches into the plant
network; the plant pushes out.

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

Essential machines get NC from the operator. Tonnage nodes are judged against rated tonnage ÷ nodes ± tolerance (default 5 %,
alarm at 1.5×), e.g. 400 t / 4 nodes = 100 t each.

Demo machines: **PRS-03** Premium 400 t straight-side, **PRS-05** Essential 160 t C-frame, **PRS-07** Premium 250 t
straight-side, **PRS-09** Essential 110 t C-frame, each with 30 days of history.

## Stack

- `client/` — React 19 + Vite + Material UI v7 (+ react-three-fiber for the 3D Floor, character and anatomy, MUI X Charts)
- `server/` — Node 22 + Express 5: master-data API, 1 s live loop (Kepware tags or simulator), OEE engine, Dr. Macx Live
  brain, Gemini calls; serves the React build
- Firestore — master data, hourly OEE buckets, downtime events, points, kiosk messages, shift handovers
- BigQuery (optional, `BQ_DATASET`) — per-minute sensor summaries (`sensor_minutes`), read by Gemini and the cycle-time learner
- Cloud Text-to-Speech — the machine's voice (falls back to the browser's voice)
- Google AI on Vertex AI — **Gemini** (`gemini-3.8-flash`) for everything: stop analysis, stop-reason suggestions from the
  operator's note in any language, downtime analysis, chat, the kiosk's words, translation and shift handovers
- Secret Manager — `kepware-token` for the Kepware ingest
- One container on Cloud Run

## Pages

| Page | What it does |
| --- | --- |
| Dashboard | Plant OEE for the shift, machine status, output, OEE by machine, stopped machines |
| Dr. Macx Live (`/soul`, kiosk) | Pick a machine, sign in with an employee number (active, skill ≥ 2). 3D character tinted by the current issue; the latest message as issue, fact and **action plan** (linked to the page where the action is done); Ask Dr. Macx and Answer / Explain by voice in one dialog with that hour's evidence; OEE ring with A / P / Q; events, sensors and anatomy; history and machine status popups; foldable progress footer; language and voice per kiosk |
| Monitoring | One card per machine, judged green / yellow / red against its own targets; OEE simulation (simulated machines); stops to confirm |
| Machine detail › Live | Shift KPIs, sensor values with ok / warn / alarm, NC entry (Essential) |
| Machine detail › OEE history | Shift timeline (bar + list), KPIs, by-shift comparison, OEE / A / P / Q trends, history table; filter by period, shift, hour/shift/day |
| Machine detail › Downtime & AI | Stops, Pareto, trend, repeated cases, downtime log with confirm, Gemini analysis and chat |
| Machine detail › Anatomy | Isometric machine drawing + 3D view; the part with the worst sensor is outlined, with its live reading |
| Machine detail › Shift handovers | What each finished shift handed to the next |
| 3D Floor | Gamified floor: machines and operators from master data, live counts, stop reactions, submit reason, points leaderboard; list view fallback |
| Master data | Machines (targets & tolerance, machine & sensors, connection & tags, cycle-time suggestions to approve), OEE calculation (breaks, break tolerance), Downtime reasons, Operators, Skill matrix, Users & roles |

The pages have a **Tutorial** button with a guided tour.

## Run locally

Needs Node 22+ and Java 11+ (for the Firestore emulator).

```bash
npm install
npm run dev
```

Opens the Firestore emulator (:8085), API (:8080) and web app (http://localhost:5173). Emulator data is in memory, so every start
re-seeds the demo data (the four machines above, operators, skills, users, downtime reasons, breaks) and 30 days of simulated
history.

For the AI features, copy `.env.example` to `.env`: with `GOOGLE_GENAI_USE_VERTEXAI=true` and `GCP_PROJECT` set, local runs use
Vertex AI through your `gcloud auth application-default login`. Set `BQ_DATASET` to also send telemetry to BigQuery.
`npm run seed` loads the same demo data into whatever Firestore the environment points at; `SEED_ONLY=prs-05,prs-07` adds just
those machines (and their history) without touching the others.

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
  A reason already used by a stop can't be deleted.
- A **repeated case** is the same reason 3+ times on one machine within 24 h.
- Schedule target (3D Floor): pieces due by now = (time since shift start − breaks − planned stops) ÷ ideal cycle time.

## Dr. Macx Live

The machine speaks only on events (stored in `machines/{id}/soul`, translated into the kiosk language on read):

- **Sensor alert:** a sensor out of limits for 30 s, once per 30 min (sooner if a warning becomes an alarm); names the node or
  part and outlines it on the anatomy.
- **Stop:** an unplanned stop lasting 1 min; Gemini reads the sensors 60 / 30 / 5 s before the stop and gives the likely issue,
  why, what to check and a suggested downtime reason.
- **Target risk:** projected good pieces at shift end (current pace × remaining planned time) below plan × OEE target; hourly.
- **Question:** each hour, if output was below 85 % of what the last 3 hours' rate predicted ("I expected 400, made 310 — what
  happened?"); the operator answers by voice or by picking a suggested answer, and Gemini checks it against that hour's data.
- **Advice:** on a schedule (Settings, default hourly) what the machine would tell the operator now.
- **Cycle time:** once a day, the best steady stroke (mean of the fastest 10 % of fully-running minutes over the last 3 shifts;
  hour buckets without BigQuery) is compared with the ideal cycle time; more than 5 % off → a suggestion a supervisor approves or
  rejects on the Machines page.
- **Handover:** when a shift ends, Gemini summarises it (OEE, output vs plan, losses, open stops, sensor alerts, unanswered
  questions) with advice for the next shift (`machines/{id}/handovers`), and the machine says it to the incoming shift.

## API

| Method & path | Purpose |
| --- | --- |
| `POST /api/kepware/ingest` | Kepware IoT Gateway tag values `{ values: [{ id, v, q, t }] }`, Bearer `KEPWARE_TOKEN` |
| `GET /api/live` | Live state of every machine |
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
| `GET /api/machines/:id/soul?lang` | What the machine said |
| `POST /api/machines/:id/soul/ask`, `POST /api/machines/:id/soul/explain` | Ask Gemini; explain by voice `{ text, lang, operatorId, replyTo? }` |
| `POST /api/machines/:id/soul/options`, `POST /api/machines/:id/soul/chat` | Suggested answers for a question; follow-up chat |
| `POST /api/translate`, `GET /api/languages` | UI translation through Gemini |
| `POST /api/tts` | Voice (MP3): `{ text, lang }` |
| `POST /api/machines/:id/cycle-time/learn`, `POST /api/machines/:id/cycle-time` | Check the cycle time now; approve / reject `{ approve }` |
| `GET /api/machines/:id/handovers` | Shift handover history |

**Points (3D Floor):** an operator who gives a stop its reason earns **+10** if it is within 5 min of the stop starting, **+5**
later; only the first confirmation of a stop scores, and the operator must have skill level 2 ("Can run") on that machine.
The waiting-for-reason counter turns red when a stop has waited more than 15 min.

## Deploy to Cloud Run

Create a GCP project, enable Cloud Run, Cloud Build, Firestore (Native mode), Vertex AI, BigQuery, Text-to-Speech and Secret
Manager, create the BigQuery dataset `drmacx` (asia-southeast2), give the Cloud Run service account `roles/datastore.user`,
`roles/aiplatform.user`, `roles/bigquery.dataEditor`, `roles/bigquery.jobUser` and `roles/secretmanager.secretAccessor`, then:

```bash
openssl rand -hex 32 | gcloud secrets create kepware-token --data-file=-
```

```bash
gcloud run deploy dr-macx --source . --region asia-southeast2 --allow-unauthenticated --min-instances 1 --max-instances 1 --no-cpu-throttling --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,GCP_PROJECT=YOUR_PROJECT,GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_LOCATION=global,BQ_DATASET=drmacx --set-secrets KEPWARE_TOKEN=kepware-token:latest
```

- With `GOOGLE_GENAI_USE_VERTEXAI=true` Gemini (`gemini-3.8-flash`) runs through **Vertex AI** with the service account,
  billed to the Cloud billing account, on the `global` location. A busy (429) answer is retried twice.
- Without it, Gemini uses an AI Studio key (`GEMINI_API_KEY`), which needs AI Studio prepay credit.
- The sidebar's **AI models** panel shows the model, how it is reached and whether its last call worked.
- Give the Kepware IoT Gateway the token from `gcloud secrets versions access latest --secret kepware-token` and the URL
  `https://YOUR_SERVICE/api/kepware/ingest`.

The live loop, Kepware tag values, shift accumulators and the kiosk's throttles live in memory, so the service runs as a single
always-on instance. Set the plant time zone with the `TZ` env var (default `Asia/Jakarta` in the Dockerfile).
