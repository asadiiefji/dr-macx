// Demo master data + 30 days of simulated history. Fixed IDs, so re-running overwrites these docs only
// and never duplicates; history is only generated for a machine that has none yet.
// Run: npm run seed (dev runs it automatically, since the emulator starts empty).
import { Firestore } from '@google-cloud/firestore';
import { schemas, parseSettings, DEFAULT_TARGETS } from './validate.js';
import { currentShift, dayStart, onBreak, breakIn } from './oee.js';
import { newDummy, dummyStep } from './dummy.js';
import { newRecorder, record } from './recorder.js';

const machines = {
  'prs-03': {
    code: 'PRS-03', name: 'Press 03 · 200T', line: 'Line 2', area: 'Stamping', idealCycleTime: 6, source: 'dummy',
    kepware: { endpoint: 'opc.tcp://192.168.1.10:49320', channel: 'Channel1', device: 'Press03' },
    tags: {
      runStatus: 'Channel1.Press03.RunStatus', totalCount: 'Channel1.Press03.TotalCount',
      rejectCount: 'Channel1.Press03.RejectCount', alarmCode: 'Channel1.Press03.AlarmCode',
    },
    targets: DEFAULT_TARGETS,
  },
};

const operators = {
  'op-001': { code: 'OP-001', name: 'Budi Santoso' },
  'op-002': { code: 'OP-002', name: 'Siti Rahmawati' },
  'op-003': { code: 'OP-003', name: 'Nguyen Van An' },
  'op-004': { code: 'OP-004', name: 'Maria Santos' },
};

// operator -> level on PRS-03 (0 None, 1 Trainee, 2 Can run, 3 Can teach)
const skills = { 'op-001': 3, 'op-002': 2, 'op-003': 1 };

const users = {
  'usr-admin': { name: 'Asadi', email: 'admin@drmacx.demo', role: 'admin' },
  'usr-supervisor': { name: 'Rina Wijaya', email: 'supervisor@drmacx.demo', role: 'supervisor' },
  'usr-operator': { name: 'Budi Santoso', email: 'budi.santoso@drmacx.demo', role: 'operator' },
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

// Runs the same dummy PLC + recorder as the live server, second by second, up to the current shift.
function simulate(id, m) {
  const end = currentShift().start;
  const start = dayStart(end - 30 * 86400e3);
  const rnd = mulberry32(42);
  const gen = newDummy();
  const rec = newRecorder();
  const events = [];
  for (let t = start; t < end; t += 1000) {
    const br = onBreak(t, settings.breaks);
    // pump wear grows over the month, so hydraulic stops become more frequent
    const tags = dummyStep(gen, m, 1, { rnd, wear: (t - start) / (end - start), hour: new Date(t).getHours(), onBreak: br, breakIn: breakIn(t, settings.breaks) });
    const { opened, closed } = record(rec, tags, t, 1, m.idealCycleTime, br);
    if (opened) opened.reasonCode = gen.reason; // the operator's answer, as if they had confirmed it
    if (closed) events.push(closed);
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
  return { writes, hours: rec.hours.size, events: events.length };
}

const writes = [];
const reasonDocs = Object.fromEntries(reasons.map((r) => [r.code, r]));
for (const [col, docs] of Object.entries({ machines, operators, users, reasons: reasonDocs })) {
  for (const [id, body] of Object.entries(docs)) {
    const { value, error } = schemas[col].parse(body);
    if (error) throw new Error(`${col}/${id}: ${error}`);
    writes.push([`${col}/${id}`, { ...value, updatedAt: Date.now() }]);
  }
}
for (const [operatorId, level] of Object.entries(skills)) {
  writes.push([`skills/${operatorId}__prs-03`, { operatorId, machineId: 'prs-03', level }]);
}
writes.push(['settings/oee', parseSettings(settings).value]);
await commit(writes);
console.log(`Seeded 1 machine, 4 operators, 3 skills, 3 users, ${reasons.length} downtime reasons and planned breaks.`);

for (const [id, m] of Object.entries(machines)) {
  const past = db.collection(`machines/${id}/hours`).where('start', '<', currentShift().start).limit(1);
  if (!(await past.get()).empty) continue; // never overwrite recorded history
  const sim = simulate(id, m);
  await commit(sim.writes);
  console.log(`Backfilled ${m.code}: ${sim.hours} hours, ${sim.events} downtime events.`);
}
process.exit(0);
