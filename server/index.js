import express from 'express';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { fileURLToPath } from 'node:url';
import { schemas, parseSettings, parseConfirm, DEFAULT_TARGETS, BREAK_CATEGORY } from './validate.js';
import { startLive } from './live.js';
import { currentShift, groupBuckets, oee, add, ZERO, touchesBreak, excludePlanned, buildTimeline } from './oee.js';
import { withReasons, markRepeats, downtimeStats, REPEAT, pointsFor } from './analysis.js';
import { analyze, suggestReason, chat, explain, aiStatus, MODEL, GEMMA_MODEL } from './ai.js';
import { SENSORS, SETUPS, FRAMES, CURRENT } from './sensors.js';
import { soulRoutes } from './soul.js';
import { startBrain } from './brain.js';
import { cycleRoutes } from './cycle.js';
import { handoverRoutes } from './handover.js';
import { LANGUAGES } from './ai.js';

const db = new Firestore({ ignoreUndefinedProperties: true });
const live = startLive(db);
const app = express();
app.use(express.json({ limit: '100kb' }));

const list = async (col) => (await db.collection(col).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

app.get('/api/live', (req, res) => res.json(live.snapshot()));

// Stamping-press sensor catalog (Essential / Premium), shared with the client.
app.get('/api/sensors', (req, res) => res.json({ setups: SETUPS, frames: FRAMES, current: CURRENT, sensors: SENSORS }));

// Which Google AI models are active, how they are reached, and how their last call went (sidebar).
app.get('/api/ai', (req, res) => res.json(aiStatus()));

// --- OEE calculation settings: targets + planned breaks ---
app.get('/api/settings', (req, res) => res.json(live.settings()));

app.put('/api/settings', async (req, res) => {
  const { value, error } = parseSettings(req.body ?? {});
  if (error) return res.status(400).json({ error });
  await db.doc('settings/oee').set(value);
  res.json(value);
});

// --- Skill matrix: one doc per operator × machine, level 0–3 (0 = no doc) ---
app.get('/api/skills', async (req, res) => res.json(await list('skills')));

app.put('/api/skills', async (req, res) => {
  const { operatorId, machineId } = req.body ?? {};
  const level = Number(req.body?.level);
  if (![0, 1, 2, 3].includes(level)) return res.status(400).json({ error: 'Skill level must be 0, 1, 2 or 3.' });
  if (typeof operatorId !== 'string' || typeof machineId !== 'string' || !operatorId || !machineId)
    return res.status(400).json({ error: 'operatorId and machineId are required.' });
  const [op, mc] = await Promise.all([db.doc(`operators/${operatorId}`).get(), db.doc(`machines/${machineId}`).get()]);
  if (!op.exists || !mc.exists) return res.status(404).json({ error: 'Operator or machine not found.' });
  const ref = db.doc(`skills/${operatorId}__${machineId}`);
  await (level ? ref.set({ operatorId, machineId, level }) : ref.delete());
  res.json({ operatorId, machineId, level });
});

// --- Machine history and downtime. Query: from, to (ms), shift (e.g. "Shift 2"), by (hour|shift|day) ---
const MAX_RANGE = 92 * 86400e3;

async function machineRange(req, res) {
  const from = Number(req.query.from ?? req.body?.from);
  const to = Number(req.query.to ?? req.body?.to);
  const shift = req.query.shift ?? req.body?.shift ?? '';
  if (!(from < to) || to - from > MAX_RANGE) return res.status(400).json({ error: 'Pick a date range of up to 92 days.' }), null;
  const ref = db.doc(`machines/${req.params.id}`);
  const machine = await ref.get();
  if (!machine.exists) return res.status(404).json({ error: 'Machine not found.' }), null;
  return { ...rangeFor(ref, from, to, (t) => !shift || currentShift(t).name === shift), machine: { id: machine.id, ...machine.data() }, shift };
}

// A stretch of one machine's history; keep(t) narrows it (e.g. to one shift name).
const rangeFor = (ref, from, to, keep = () => true) => ({
  ref, from, to, keep,
  between: (col) => ref.collection(col).where('start', '>=', from).where('start', '<', to).get(),
});

const hoursIn = async (r) => (await r.between('hours')).docs.map((d) => d.data()).filter((b) => r.keep(b.start));

// Events with their reason resolved, repeats marked, and whether an "Operator break" reason may be given.
// history = earlier events (up to 24 h before) so the first stops of a range get a correct repeat count.
async function resolve(events, history = []) {
  const { breaks, breakToleranceMin } = live.settings();
  const now = Date.now();
  const ids = new Set(events.map((e) => e.id));
  const all = markRepeats(withReasons([...events, ...history.filter((e) => !ids.has(e.id))], await list('reasons'), now));
  return all
    .filter((e) => ids.has(e.id))
    .map((e) => ({ ...e, breakAllowed: touchesBreak(e.start, e.end ?? now, breaks, breakToleranceMin * 60e3) }))
    .sort((a, b) => b.start - a.start);
}

const eventsSince = async (ref, from, to = Date.now() + 1) =>
  (await ref.collection('downtime').where('start', '>=', from).where('start', '<', to).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function downtimeIn(r) {
  const all = await eventsSince(r.ref, r.from - REPEAT.windowMs, r.to);
  return resolve(all.filter((e) => e.start >= r.from && r.keep(e.start)), all.filter((e) => e.start < r.from));
}

// Hour buckets of the range with confirmed planned stops taken out of planned time, plus the range's events.
async function rangeData(r) {
  const [events, raw] = await Promise.all([downtimeIn(r), hoursIn(r)]);
  const buckets = excludePlanned(raw, events);
  return { events, buckets, sum: buckets.reduce(add, ZERO) };
}

app.get('/api/machines/:id/history', async (req, res) => {
  const r = await machineRange(req, res);
  if (!r) return;
  const by = ['hour', 'shift', 'day'].includes(req.query.by) ? req.query.by : 'day';
  const { buckets, sum } = await rangeData(r);
  // one summary row per shift (Shift 1/2/3) across the whole range
  const byShift = new Map();
  for (const b of buckets) {
    const name = currentShift(b.start).name;
    byShift.set(name, add(byShift.get(name) ?? ZERO, b));
  }
  const shifts = [...byShift].sort((a, b) => a[0].localeCompare(b[0])).map(([name, s]) => ({ name, ...s, ...oee(s) }));
  res.json({ rows: groupBuckets(buckets, by), shifts, total: { ...sum, ...oee(sum) }, targets: r.machine.targets ?? DEFAULT_TARGETS });
});

// What the machine did during one shift, as time segments. Query: start = any time inside the shift (ms).
app.get('/api/machines/:id/timeline', async (req, res) => {
  const t = Number(req.query.start);
  if (!Number.isFinite(t)) return res.status(400).json({ error: 'Pick a shift.' });
  const shift = currentShift(t);
  const now = Date.now();
  if (shift.start > now) return res.json({ shift, segments: [] });
  const to = Math.min(shift.end, now);
  const ref = db.doc(`machines/${req.params.id}`);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Machine not found.' });
  const [events, hours] = await Promise.all([
    eventsSince(ref, shift.start - REPEAT.windowMs, to),
    ref.collection('hours').where('start', '>=', shift.start - 3600e3).where('start', '<', to).get(),
  ]);
  const recorded = new Set(hours.docs.map((d) => d.data().start));
  // the hour in progress is recorded in memory and saved once a minute
  if (to === now) recorded.add(new Date(now).setMinutes(0, 0, 0));
  const resolved = await resolve(events.filter((e) => (e.end ?? now) > shift.start));
  res.json({ shift, until: to, segments: buildTimeline(shift.start, to, resolved, live.settings().breaks, recorded) });
});

app.get('/api/machines/:id/downtime', async (req, res) => {
  const r = await machineRange(req, res);
  if (!r) return;
  const { events, buckets, sum } = await rangeData(r);
  res.json({ events, stats: downtimeStats(events, sum, buckets, r.from, r.to) });
});

// Stops waiting for a confirmed reason (live list kept by the poller), with repeats over the last 24 h.
app.get('/api/machines/:id/downtime/pending', async (req, res) => {
  const pending = live.pending(req.params.id);
  if (!pending.length) return res.json([]);
  const from = Math.min(...pending.map((e) => e.start)) - REPEAT.windowMs;
  res.json(await resolve(pending, await eventsSince(db.doc(`machines/${req.params.id}`), from)));
});

// Confirm or change the reason of one stop. A planned reason takes the stop out of OEE.
app.put('/api/machines/:id/downtime/:eventId', async (req, res) => {
  const { value, error } = parseConfirm(req.body ?? {});
  if (error) return res.status(400).json({ error });
  const ref = db.doc(`machines/${req.params.id}/downtime/${req.params.eventId}`);
  const [event, reasons] = await Promise.all([ref.get(), db.collection('reasons').where('code', '==', value.reasonCode).get()]);
  if (!event.exists) return res.status(404).json({ error: 'Downtime event not found.' });
  if (reasons.empty) return res.status(400).json({ error: `Reason ${value.reasonCode} is not in the downtime reason list.` });
  const e = event.data();
  const reason = reasons.docs[0].data();
  const { breaks, breakToleranceMin } = live.settings();
  if (reason.category === BREAK_CATEGORY && !touchesBreak(e.start, e.end ?? Date.now(), breaks, breakToleranceMin * 60e3))
    return res.status(400).json({ error: `An operator-break reason fits only a stop within ${breakToleranceMin} min of a scheduled break. Pick another reason.` });
  // The submitting operator must run this machine (skill level 2+), same rule as the Operators count on Machines.
  if (value.operatorId) {
    const skill = await db.doc(`skills/${value.operatorId}__${req.params.id}`).get();
    if (!(skill.data()?.level >= 2)) return res.status(403).json({ error: 'This operator is not assigned to this machine (needs skill level 2 or higher).' });
  }
  const now = Date.now();
  // Points only for the first confirmation of a stop, never for later changes.
  const points = value.operatorId && e.confirmed === false ? pointsFor(e.start, now) : 0;
  const batch = db.batch();
  batch.update(ref, { ...value, planned: reason.type === 'planned', confirmed: true, confirmedAt: now, ...(points && { points }) });
  if (points) {
    const shiftStart = currentShift(now).start;
    batch.set(
      db.doc(`points/${shiftStart}__${value.operatorId}`),
      { shiftStart, operatorId: value.operatorId, points: FieldValue.increment(points), submissions: FieldValue.increment(1) },
      { merge: true },
    );
  }
  await batch.commit();
  res.json({ ...value, points });
});

// Leaderboard: points per operator this shift.
app.get('/api/points', async (req, res) => {
  const shiftStart = currentShift().start;
  const [snap, operators] = await Promise.all([db.collection('points').where('shiftStart', '==', shiftStart).get(), list('operators')]);
  const byId = new Map(operators.map((o) => [o.id, o]));
  const rows = snap.docs
    .map((d) => d.data())
    .map((p) => ({ operatorId: p.operatorId, code: byId.get(p.operatorId)?.code ?? '?', name: byId.get(p.operatorId)?.name ?? 'Unknown', points: p.points, submissions: p.submissions }))
    .sort((a, b) => b.points - a.points);
  res.json({ shiftStart, rows });
});

// Gemma suggests a reason for one stop from its data and the operator's note (any language). Nothing is saved.
app.post('/api/machines/:id/downtime/:eventId/suggest', async (req, res) => {
  const machineRef = db.doc(`machines/${req.params.id}`);
  const [machine, event] = await Promise.all([machineRef.get(), machineRef.collection('downtime').doc(req.params.eventId).get()]);
  if (!machine.exists || !event.exists) return res.status(404).json({ error: 'Machine or stop not found.' });
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  const m = machine.data();
  const [stop] = await resolve([{ id: event.id, ...event.data() }], await eventsSince(machineRef, event.data().start - REPEAT.windowMs));
  const recent = withReasons(await eventsSince(machineRef, Date.now() - REPEAT.windowMs), await list('reasons'));
  const allowed = (await list('reasons')).filter((x) => x.category !== BREAK_CATEGORY || stop.breakAllowed);
  const now = live.snapshot().machines.find((x) => x.id === req.params.id);
  const counts = {};
  for (const e of recent) counts[e.reason] = (counts[e.reason] ?? 0) + 1;
  try {
    const out = await suggestReason({
      machine: { code: m.code, name: m.name, area: m.area, idealCycleTimeSec: m.idealCycleTime },
      stop: {
        startedAt: new Date(stop.start).toISOString(),
        durationMin: Math.round(stop.minutes * 10) / 10,
        stillStopped: !stop.end,
        plcAlarmCode: stop.alarmCode || null,
        reasonLinkedToAlarm: stop.suggested,
        touchesScheduledBreak: stop.breakAllowed,
        sameReasonInLast24h: stop.repeatCount,
      },
      machineCondition: now && {
        status: now.status,
        tags: now.tags,
        sensors: now.readings,
        sensorStatus: now.sensorStatus,
        shiftOeePct: now.oee == null ? null : Math.round(now.oee * 1000) / 10,
        shiftNgRatePct: now.total ? Math.round((now.ng / now.total) * 1000) / 10 : null,
      },
      stopsLast24hByReason: counts,
      operatorNote: note,
      reasons: allowed.map((x) => ({ code: x.code, name: x.name, category: x.category, type: x.type })),
    });
    const valid = allowed.some((x) => x.code === out.reasonCode);
    res.json({ ...out, reasonCode: valid ? out.reasonCode : null, model: GEMMA_MODEL });
  } catch (e) {
    console.error('gemma suggestion failed:', e.message);
    res.status(e.status === 503 ? 503 : 502).json({ error: explain(e) ?? 'Gemma could not suggest a reason. Pick one yourself or try again.' });
  }
});

// Simulation for a dummy machine: mode normal | better | worse, and/or inject a fault story
// (looseNode | stick | ioFault | overheat) for a demo.
app.put('/api/machines/:id/simulation', (req, res) => {
  const { mode, inject } = req.body ?? {};
  if ((!mode && !inject) || !live.simulate(req.params.id, mode, inject))
    return res.status(400).json({ error: 'Simulation works only for an active dummy-generator machine: mode normal, better or worse; inject looseNode, stick, ioFault or overheat.' });
  res.json({ mode, inject });
});

// Operator-entered NC pieces (Essential presses have no vision camera).
app.post('/api/machines/:id/nc', async (req, res) => {
  const count = Number(req.body?.count);
  const operatorId = typeof req.body?.operatorId === 'string' ? req.body.operatorId.slice(0, 64) : null;
  if (!Number.isInteger(count) || count < 1 || count > 10000) return res.status(400).json({ error: 'Enter a whole number of NC pieces (1–10000).' });
  const ref = db.doc(`machines/${req.params.id}`);
  const machine = await ref.get();
  if (!machine.exists) return res.status(404).json({ error: 'Machine not found.' });
  if (machine.data().setup === 'premium') return res.status(400).json({ error: 'This press counts NC with its vision camera.' });
  if (!live.addNc(req.params.id, count)) return res.status(409).json({ error: 'The press is not being monitored yet. Try again in a few seconds.' });
  await ref.collection('nc').add({ at: Date.now(), count, operatorId });
  res.status(201).json({ count });
});

// The data Gemini reasons over for one machine and range (analysis and chat).
async function machineContext(r) {
  const { events, buckets, sum } = await rangeData(r);
  const ct = r.machine.idealCycleTime;
  const stats = downtimeStats(events, sum, buckets, r.from, r.to);
  const now = live.snapshot().machines.find((x) => x.id === r.machine.id);
  return {
    events,
    context: {
      machine: { code: r.machine.code, name: r.machine.name, area: r.machine.area, idealCycleTimeSec: ct },
      period: { from: new Date(r.from).toISOString(), to: new Date(Math.min(r.to, Date.now())).toISOString(), shift: r.shift || 'all shifts' },
      oeePct: Object.fromEntries(Object.entries(oee(sum)).map(([k, v]) => [k, v == null ? null : Math.round(v * 1000) / 10])),
      targetsPct: r.machine.targets ?? DEFAULT_TARGETS,
      output: { total: sum.total, ng: sum.ng, plannedStopMin: Math.round(sum.plannedStopSec / 60) },
      // pieces the unplanned downtime cost at the ideal cycle time
      downtime: { ...stats, reasons: stats.reasons.map((x) => ({ ...x, lostPiecesAtIdealCt: x.type === 'planned' ? 0 : Math.round((x.minutes * 60) / ct) })) },
      now: now && {
        status: now.status,
        motor: now.motor,
        tags: now.tags,
        sensors: now.readings,
        sensorStatus: now.sensorStatus, // ok / warn / alarm per sensor; tonnage nodes vs nominal ± tolerance
        press: { setup: now.setup, frameType: now.frameType, ratedTonnage: now.ratedTonnage, nodes: now.nodes, nodeTolerancePct: now.nodeTolerancePct },
        shiftOeePct: now.oee == null ? null : Math.round(now.oee * 1000) / 10,
      },
      recentStops: events.slice(0, 15).map((e) => ({ at: new Date(e.start).toISOString(), min: Math.round(e.minutes * 10) / 10, reason: e.reason, type: e.type, confirmed: e.confirmed, repeated: e.repeated })),
      operatorComments: events.filter((e) => e.comment).slice(0, 30).map((e) => ({ reason: e.reason, at: new Date(e.start).toISOString(), comment: e.comment })),
    },
  };
}

const aiError = (res, what) => (e) => {
  console.error(`${what} failed:`, e.message);
  res.status(e.status === 503 ? 503 : 502).json({ error: explain(e) ?? `Gemini could not ${what}. Try again.` });
};

app.post('/api/machines/:id/analysis', async (req, res) => {
  const r = await machineRange(req, res);
  if (!r) return;
  const { events, context } = await machineContext(r);
  if (!events.length) return res.status(400).json({ error: 'No downtime in this range to analyse.' });
  analyze(context).then((out) => res.json(out), aiError(res, 'analyse this range'));
});

// Chat about the machine. Body: from, to, shift, messages: [{ role: 'user' | 'model', text }] (latest last).
app.post('/api/machines/:id/chat', async (req, res) => {
  const msgs = req.body?.messages;
  const ok = Array.isArray(msgs) && msgs.length && msgs.length <= 30 && msgs.at(-1).role === 'user' &&
    msgs.every((m) => ['user', 'model'].includes(m?.role) && typeof m.text === 'string' && m.text.trim() && m.text.length <= 4000);
  if (!ok) return res.status(400).json({ error: 'Send up to 30 messages, the last one from the user.' });
  const r = await machineRange(req, res);
  if (!r) return;
  const { context } = await machineContext(r);
  chat(context, msgs).then((text) => res.json({ text, model: MODEL }), aiError(res, 'answer'));
});

// --- Machine Soul kiosk (soul.js) ---
app.get('/api/languages', (req, res) => res.json(LANGUAGES));
const soul = soulRoutes(app, { db, live, list, resolve, eventsSince, repeatWindowMs: REPEAT.windowMs });
startBrain({ db, live, say: soul.say, context: soul.context, resolve });
cycleRoutes(app, { db, live, say: soul.say });
handoverRoutes(app, { db, live, say: soul.say, shiftData: (id, sh) => rangeData(rangeFor(db.doc(`machines/${id}`), sh.start, sh.end)) });

// --- Master data CRUD: machines, operators, users, reasons ---
app.use('/api/:col', (req, res, next) => (schemas[req.params.col] ? next() : res.status(404).json({ error: 'Not found.' })));

app.get('/api/:col', async (req, res) => res.json(await list(req.params.col)));

async function save(req, res, id) {
  const { col } = req.params;
  const schema = schemas[col];
  const { value, error } = schema.parse(req.body ?? {});
  if (error) return res.status(400).json({ error });
  const ref = id ? db.doc(`${col}/${id}`) : db.collection(col).doc();
  // ponytail: unique check is read-then-write; use a transaction if two admins edit at once.
  for (const [key, label] of schema.unique) {
    if (value[key] == null || value[key] === '') continue;
    const dup = await db.collection(col).where(key, '==', value[key]).get();
    if (dup.docs.some((d) => d.id !== ref.id)) return res.status(409).json({ error: `${label} "${value[key]}" already exists.` });
  }
  const old = id ? (await ref.get()).data() : null;
  if (id && !old) return res.status(404).json({ error: 'Not found.' });
  // a learned cycle-time suggestion is not part of the form, so it survives edits
  await ref.set({ ...value, ...(old?.cycleSuggestion && { cycleSuggestion: old.cycleSuggestion }), updatedAt: Date.now() });
  res.status(id ? 200 : 201).json({ id: ref.id, ...value });
}

app.post('/api/:col', (req, res) => save(req, res));
app.put('/api/:col/:id', (req, res) => save(req, res, req.params.id));

app.delete('/api/:col/:id', async (req, res) => {
  const { col, id } = req.params;
  const ref = db.doc(`${col}/${id}`);
  if (col === 'machines') await db.recursiveDelete(ref); // also its hours and downtime history
  const batch = db.batch();
  batch.delete(ref);
  const field = { machines: 'machineId', operators: 'operatorId' }[col];
  if (field) (await db.collection('skills').where(field, '==', id).get()).forEach((d) => batch.delete(d.ref));
  await batch.commit();
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// --- React build (production) ---
const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error. Check the server log.' });
});

const port = process.env.PORT || 8080;
const server = app.listen(port, () => console.log(`Dr. Macx server on :${port}`));

// Cloud Run sends SIGTERM before stopping: save the last minute of hour buckets first.
process.once('SIGTERM', async () => {
  server.close();
  await live.flush();
  process.exit(0);
});
