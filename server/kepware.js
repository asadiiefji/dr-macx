// Live machine press data from Kepware. Cloud Run cannot reach the plant network, so the plant pushes:
// Kepware's IoT Gateway (REST client agent) on the edge PC POSTs its tag values here every second, and the live
// loop builds each machine press's readings from the latest value of its tags (Master data › Machines › sensor tags).
import { sensorsFor } from './sensors.js';

const STALE_MS = 10_000; // a tag not updated for this long is treated as missing
const MAX_TAGS = 10_000; // ponytail: plain in-memory map, one Cloud Run instance (maxScale 1); a shared store if that grows
const latest = new Map(); // tag id ('Channel1.Press03.LaserEye.PartCount') -> { v, at }

// Kepware IoT Gateway standard JSON: { timestamp, values: [{ id, v, q, t }] }. Returns how many values were kept,
// or null when the body is not that shape. Bad-quality and non-numeric values are skipped.
export function ingest(body, now = Date.now()) {
  if (!Array.isArray(body?.values)) return null;
  let kept = 0;
  for (const x of body.values) {
    if (typeof x?.id !== 'string' || x.q === false) continue;
    const v = Number(x.v); // booleans become 0 / 1
    if (!Number.isFinite(v) || (latest.size >= MAX_TAGS && !latest.has(x.id))) continue;
    latest.set(x.id, { v, at: now });
    kept++;
  }
  return kept;
}

// The sensors OEE cannot do without: part count, running state, alarm, and NC count where a camera gives it.
const needed = (m, s) => ['laserEye', 'motorCurrent', 'alarm'].includes(s.id) || (s.id === 'visionNc' && m.setup === 'premium');

// Readings in the simulator's shape (see dummy.js), or null (= "disconnected") while a needed tag is missing or stale.
// Other sensors that are missing read null. prev = the last readings, to count the parts made since.
export function kepwareReadings(m, prev, now = Date.now()) {
  const r = { tonnage: [] };
  for (const s of sensorsFor(m)) {
    const x = latest.get(m.sensorTags?.[s.id]);
    const v = x && now - x.at <= STALE_MS ? x.v : null;
    if (v === null && needed(m, s)) return null;
    if (s.node) r.tonnage[s.node - 1] = v;
    else r[s.id] = v;
  }
  // the laser eye is a PLC counter; a drop means it was reset, so the new value is what was made since
  const last = prev?.laserEye;
  r.made = last === undefined ? 0 : r.laserEye >= last ? r.laserEye - last : r.laserEye;
  return r;
}
