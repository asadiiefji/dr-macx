# Dr. Macx — Every machine, checked.

Machine OEE monitoring for the Google Cloud AI Builder Cup 2026 (Manufacturing: Intelligent Operations & Industrial Efficiency).
Dr. Macx reads four signals per machine (run/stop, total count, NG count, alarm code) from the PLC through Kepware — or from a
built-in dummy PLC generator — and turns them into Availability, Performance, Quality and OEE per shift.

## Stack

- `client/` — React 19 + Vite + Material UI v7
- `server/` — Node 22 + Express 5: master-data API, 1 s tag poller, OEE engine; serves the React build
- Firestore — master data (machines, operators, skills, users)
- One container on Cloud Run

## Run locally

Needs Node 22+ and Java 11+ (for the Firestore emulator).

```bash
npm install
npm run dev
```

Opens the Firestore emulator (:8085), API (:8080) and web app (http://localhost:5173). Emulator data is in memory and is cleared on restart.

```bash
npm test
```

## Deploy to Cloud Run

Enable Firestore (Native mode) in your GCP project, then:

```bash
gcloud run deploy dr-macx --source . --region asia-southeast2 --allow-unauthenticated --min-instances 1 --max-instances 1 --no-cpu-throttling
```

The poller and shift accumulators live in memory, so the service runs as a single always-on instance. Set the plant time zone with the `TZ` env var (default `Asia/Jakarta` in the Dockerfile).

## OEE

Shifts: 07:00–15:00, 15:00–23:00, 23:00–07:00.
Availability = run time ÷ planned time · Performance = ideal CT × total ÷ run time · Quality = good ÷ total · OEE = A × P × Q.
