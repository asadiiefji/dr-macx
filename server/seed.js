// Demo master data + 30 days of simulated history. Fixed IDs, so re-running overwrites these docs only
// and never duplicates; history is only generated for a machine that has none yet.
// Run: npm run seed (dev runs it automatically, since the emulator starts empty).
// SEED_ONLY=prs-05,prs-07 adds just those presses (their master data if missing, their skills and history) and
// writes nothing else: operators, reasons, settings and every other press stay as they are.
import { Firestore } from '@google-cloud/firestore';
import { schemas, parseSettings, DEFAULT_TARGETS } from './validate.js';
import { currentShift, dayStart, onBreak, breakIn } from './oee.js';
import { newDummy, dummyStep } from './dummy.js';
import { newRecorder, record } from './recorder.js';
import { defaultTags, pressDefaults, toOeeTags } from './sensors.js';
import { minuteOf, newMinute, addReading, minuteRow } from './telemetry.js';
import { bqEnabled, insertRows, query } from './bq.js';

// Four stamping presses: Premium and Essential sensor sets, straight-side and C-frame.
const press = (m) => ({ ...m, sensorTags: defaultTags(pressDefaults(m), 'Channel1', m.kepware.device), targets: DEFAULT_TARGETS });
const machines = {
  'prs-03': press({
    code: 'PRS-03', name: 'Press 03 · 400T straight-side', line: 'Line 2', area: 'Stamping', idealCycleTime: 6, source: 'dummy',
    setup: 'premium', frameType: 'straight-side', ratedTonnage: 400, nodes: 4, nodeTolerancePct: 5,
    kepware: { endpoint: 'opc.tcp://192.168.1.10:49320', channel: 'Channel1', device: 'Press03' },
  }),
  'prs-05': press({
    code: 'PRS-05', name: 'Press 05 · JH21-160 C-frame', line: 'Line 3', area: 'Stamping', idealCycleTime: 2.5, source: 'dummy',
    setup: 'essential', frameType: 'c-frame', ratedTonnage: 160, nodes: 2, nodeTolerancePct: 5,
    kepware: { endpoint: 'opc.tcp://192.168.1.11:49320', channel: 'Channel1', device: 'Press05' },
  }),
  'prs-07': press({
    code: 'PRS-07', name: 'Press 07 · 250T straight-side', line: 'Line 1', area: 'Stamping', idealCycleTime: 4, source: 'dummy',
    setup: 'premium', frameType: 'straight-side', ratedTonnage: 250, nodes: 4, nodeTolerancePct: 5,
    kepware: { endpoint: 'opc.tcp://192.168.1.12:49320', channel: 'Channel1', device: 'Press07' },
  }),
  'prs-09': press({
    code: 'PRS-09', name: 'Press 09 · JH21-110 C-frame', line: 'Line 3', area: 'Stamping', idealCycleTime: 2, source: 'dummy',
    setup: 'essential', frameType: 'c-frame', ratedTonnage: 110, nodes: 2, nodeTolerancePct: 5,
    kepware: { endpoint: 'opc.tcp://192.168.1.13:49320', channel: 'Channel1', device: 'Press09' },
  }),
};

const operators = {
  'op-001': { code: 'OP-001', name: 'Budi Santoso' },
  'op-002': { code: 'OP-002', name: 'Siti Rahmawati' },
  'op-003': { code: 'OP-003', name: 'Nguyen Van An' },
  'op-004': { code: 'OP-004', name: 'Maria Santos' },
};

// machine -> operator -> level (0 None, 1 Trainee, 2 Can run, 3 Can teach)
const skills = {
  'prs-03': { 'op-001': 3, 'op-002': 2, 'op-003': 1 },
  'prs-05': { 'op-003': 3, 'op-004': 2, 'op-001': 1 },
  'prs-07': { 'op-002': 3, 'op-001': 2, 'op-004': 1 },
  'prs-09': { 'op-004': 3, 'op-003': 2, 'op-002': 2 },
};

// Downtime reasons. alarmCode links a PLC alarm (see dummy.js) to the reason suggested for a new stop.
const reasons = [
  { code: 'BD-HYD', name: 'Hydraulic pressure low', category: 'Breakdown', alarmCode: 310 },
  { code: 'BD-MOTOR', name: 'Main motor overload trip', category: 'Breakdown', alarmCode: 320 },
  { code: 'BD-DIE', name: 'Die damage / repair', category: 'Breakdown' },
  { code: 'CO-DIE', name: 'Die change (model changeover)', category: 'Changeover', alarmCode: 205 },
  { code: 'CO-ADJ', name: 'Setup adjustment after changeover', category: 'Changeover' },
  { code: 'MT-COIL', name: 'Coil material shortage', category: 'Material', alarmCode: 412 },
  { code: 'MT-WAIT', name: 'Waiting for forklift / material handling', category: 'Material' },
  { code: 'MS-JAM', name: 'Material jam in feeder', category: 'Minor stop', alarmCode: 101 },
  { code: 'MS-SENS', name: 'Part sensor misread', category: 'Minor stop', alarmCode: 102 },
  { code: 'QC-INSP', name: 'QC inspection (first piece / patrol)', category: 'Quality', type: 'planned' },
  { code: 'QC-NG', name: 'Stopped for NC (non-conformance) / quality issue', category: 'Quality' },
  { code: 'BRK-OP', name: 'Operator break (early stop / late return)', category: 'Operator break' },
  { code: 'OT-MEET', name: 'Team meeting / briefing', category: 'Other', type: 'planned' },
  { code: 'OT-NOOP', name: 'No operator available', category: 'Other' },
  { code: 'OT-PM', name: 'Planned maintenance', category: 'Other', type: 'planned' },
];

const settings = {
  // Each 8 h shift: 15 min tea after the first 2 h, 45 min lunch after 5 h (1 h of breaks per shift).
  breaks: [
    { name: 'Shift 1 tea break', start: '09:00', end: '09:15' },
    { name: 'Shift 1 lunch', start: '12:00', end: '12:45' },
    { name: 'Shift 2 tea break', start: '17:00', end: '17:15' },
    { name: 'Shift 2 dinner', start: '20:00', end: '20:45' },
    { name: 'Shift 3 tea break', start: '01:00', end: '01:15' },
    { name: 'Shift 3 meal', start: '04:00', end: '04:45' },
  ],
  breakToleranceMin: 5,
};

// Field notes an operator might leave on a stop; the AI analysis reads these.
const COMMENTS = {
  'BD-HYD': ['Hydraulic oil looked dark, topped up 2 L.', 'Pump noisy at start-up, pressure came back after 10 min.', 'Small leak at the cylinder fitting, tightened it.'],
  'MT-COIL': ['Forklift busy on Line 3, coil arrived late.', 'Only one forklift driver on the night shift.'],
  'CO-DIE': ['Die alignment took longer than standard.'],
};

const db = new Firestore({ ignoreUndefinedProperties: true });

// Commit in chunks (Firestore batch limit is 500). The emulator may still be starting, so retry for a minute.
async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    for (let attempt = 1; ; attempt++) {
      try {
        const batch = db.batch(); // a batch can be committed only once, so build one per attempt
        for (const [path, data] of writes.slice(i, i + 400)) batch.set(db.doc(path), data);
        await batch.commit();
        break;
      } catch (e) {
        if (attempt >= 30) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}

// Small seeded PRNG so every seed produces the same history.
const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Runs the same sensor simulator + recorder as the live server, second by second, up to the current shift.
// Also builds the per-minute sensor rows for BigQuery.
function simulate(id, raw) {
  const m = pressDefaults({ ...raw, id });
  const end = currentShift().start;
  const start = dayStart(end - 30 * 86400e3);
  const rnd = mulberry32({ 'prs-03': 42, 'prs-05': 7, 'prs-07': 19, 'prs-09': 23 }[id] ?? 99); // a different, repeatable history per press
  const gen = newDummy();
  const rec = newRecorder();
  const events = [];
  const rows = [];
  let agg = null;
  let lastNc = 0;
  for (let t = start; t < end; t += 1000) {
    const br = onBreak(t, settings.breaks);
    // pump wear grows over the month, so hydraulic stops, vibration and temperatures rise
    const r = dummyStep(gen, m, 1, { rnd, wear: (t - start) / (end - start), hour: new Date(t).getHours(), onBreak: br, breakIn: breakIn(t, settings.breaks) });
    // Essential presses: the operators logged the NC pieces they found, as if entered on the kiosk
    const tags = toOeeTags(m, r, gen.ng);
    const { opened, closed } = record(rec, tags, t, 1, m.idealCycleTime, br);
    if (opened) opened.reasonCode = gen.reason; // the operator's answer, as if they had confirmed it
    if (closed) events.push(closed);
    const minute = minuteOf(t);
    if (agg && agg.start !== minute) rows.push(minuteRow(agg, m, 'normal'));
    if (!agg || agg.start !== minute) agg = newMinute(minute, m.nodes);
    addReading(agg, m, r, 1, br, tags.rejectCount - lastNc);
    lastNc = tags.rejectCount;
  }
  if (rec.open) events.push({ ...rec.open, end, durationSec: (end - rec.open.start) / 1000 });

  const seen = {};
  const writes = [...rec.hours.values()].map((b) => [`machines/${id}/hours/${b.start}`, b]);
  events.forEach((e, i) => {
    // the newest few stops are left for an operator to confirm
    if (i >= events.length - 4) return writes.push([`machines/${id}/downtime/${e.start}`, { ...e, reasonCode: null, confirmed: false }]);
    const notes = COMMENTS[e.reasonCode];
    const n = (seen[e.reasonCode] = (seen[e.reasonCode] ?? 0) + 1);
    const comment = notes && e.start > end - 14 * 86400e3 && n % 4 === 0 ? notes[(n / 4) % notes.length] : undefined;
    const planned = reasons.find((r) => r.code === e.reasonCode)?.type === 'planned';
    writes.push([`machines/${id}/downtime/${e.start}`, { ...e, confirmed: true, planned, ...(comment && { comment }) }]);
  });
  return { writes, rows, hours: rec.hours.size, events: events.length };
}

const only = process.env.SEED_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
for (const id of only ?? []) if (!machines[id]) throw new Error(`SEED_ONLY: unknown press ${id}`);
const picked = (id) => !only || only.includes(id);

const writes = [];
const reasonDocs = Object.fromEntries(reasons.map((r) => [r.code, r]));
const masters = only ? { machines: Object.fromEntries(Object.entries(machines).filter(([id]) => picked(id))) } : { machines, operators, reasons: reasonDocs };
for (const [col, docs] of Object.entries(masters)) {
  for (const [id, body] of Object.entries(docs)) {
    if (only && (await db.doc(`${col}/${id}`).get()).exists) continue; // adding presses never overwrites one
    const { value, error } = schemas[col].parse(body);
    if (error) throw new Error(`${col}/${id}: ${error}`);
    writes.push([`${col}/${id}`, { ...value, updatedAt: Date.now() }]);
  }
}
for (const [machineId, levels] of Object.entries(skills)) {
  if (!picked(machineId)) continue;
  for (const [operatorId, level] of Object.entries(levels)) {
    writes.push([`skills/${operatorId}__${machineId}`, { operatorId, machineId, level }]);
  }
}
if (!only) writes.push(['settings/oee', parseSettings(settings).value]);
await commit(writes);
console.log(only ? `Added ${only.join(', ')}: ${writes.length} docs (presses and skills).` : `Seeded ${Object.keys(machines).length} presses, 4 operators, skills, ${reasons.length} downtime reasons and planned breaks.`);

for (const [id, m] of Object.entries(machines)) {
  if (!picked(id)) continue;
  // never overwrite recorded history: Firestore and BigQuery are each filled only when empty for this press
  const past = db.collection(`machines/${id}/hours`).where('start', '<', currentShift().start).limit(1);
  const needFirestore = (await past.get()).empty;
  const needBq = bqEnabled && Number((await query('SELECT COUNT(*) AS n FROM `T` WHERE machine_id = @id', { id }))[0].n) === 0;
  if (!needFirestore && !needBq) continue;
  const sim = simulate(id, m);
  if (needFirestore) {
    await commit(sim.writes);
    console.log(`Backfilled ${m.code}: ${sim.hours} hours, ${sim.events} downtime events.`);
  }
  if (needBq) {
    await insertRows(sim.rows);
    console.log(`BigQuery: ${sim.rows.length} sensor minutes for ${m.code}.`);
  }
}
process.exit(0);
