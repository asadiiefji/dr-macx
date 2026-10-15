// Live layer: reads each active machine's 4 tags every second (dummy generator now, Kepware later),
// records hourly OEE buckets and downtime events to Firestore, and serves the current-shift snapshot.
import { currentShift, onBreak, breakIn, oee, add, ZERO, excludePlanned, schedulePlan } from './oee.js';
import { newDummy, dummyStep, MODES } from './dummy.js';
import { newRecorder, record } from './recorder.js';
import { DEFAULT_TARGETS } from './validate.js';

export const DEFAULT_SETTINGS = { breaks: [], breakToleranceMin: 5 };

const logErr = (e) => console.error('firestore write failed:', e.message);

export function startLive(db) {
  const machines = new Map();
  const state = new Map(); // id -> { gen, rec, tags, status, since, ready, pending, unwatch }
  let settings = DEFAULT_SETTINGS;

  // A listener that errors is dead for good, so resubscribe (e.g. Firestore not up yet). Returns a stop function.
  const watch = (ref, onSnap) => {
    let unsub;
    let stopped = false;
    const go = () => {
      if (stopped) return;
      unsub = ref.onSnapshot(onSnap, (err) => {
        console.error('listener failed, retrying in 5 s:', err.message);
        setTimeout(go, 5000);
      });
    };
    go();
    return () => ((stopped = true), unsub?.());
  };
  watch(db.collection('machines'), (snap) => {
    machines.clear();
    snap.forEach((d) => machines.set(d.id, { id: d.id, ...d.data() }));
    for (const [id, s] of state) if (!machines.has(id)) (s.unwatch(), s.unrecent?.(), state.delete(id));
  });
  watch(db.doc('settings/oee'), (d) => (settings = { ...DEFAULT_SETTINGS, ...d.data() }));

  // Pick up this shift's recorded hours, so a restart doesn't zero the shift.
  async function load(id, s) {
    const ref = db.collection('machines').doc(id);
    const [hours, open] = await Promise.all([
      ref.collection('hours').where('start', '>=', currentShift().start).get(),
      ref.collection('downtime').where('end', '==', null).get(),
    ]);
    hours.forEach((d) => s.rec.hours.set(d.data().start, d.data()));
    // ponytail: a stop left open by a previous run is closed now, which over-counts if the server was down long.
    const now = Date.now();
    await Promise.all(open.docs.map((d) => d.ref.update({ end: now, durationSec: (now - d.data().start) / 1000 })));
    s.ready = true;
  }

  function ensure(m, now) {
    let s = state.get(m.id);
    if (!s) {
      s = { gen: newDummy(), rec: newRecorder(), tags: null, status: null, since: now, ready: false, pending: [], recent: [] };
      state.set(m.id, s);
      // Stops waiting for an operator to confirm the reason, kept live for the monitoring cards.
      s.unwatch = watch(db.collection(`machines/${m.id}/downtime`).where('confirmed', '==', false), (snap) => {
        s.pending = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.start - a.start);
      });
      load(m.id, s).catch((e) => (console.error(`load ${m.code} failed:`, e.message), s.unwatch(), state.delete(m.id)));
    }
    return s;
  }

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    const br = onBreak(now, settings.breaks);
    const nextBreak = breakIn(now, settings.breaks);
    const hour = new Date(now).getHours();
    const shiftStart = currentShift(now).start;
    for (const m of machines.values()) {
      const s = ensure(m, now);
      if (!s.ready) continue;
      // This shift's stops (from 12 h before, for stops that run into it): planned ones leave the live OEE.
      if (s.recentFrom !== shiftStart) {
        s.unrecent?.();
        s.recentFrom = shiftStart;
        s.unrecent = watch(db.collection(`machines/${m.id}/downtime`).where('start', '>=', shiftStart - 12 * 3600e3), (snap) => {
          s.recent = snap.docs.map((d) => d.data());
        });
      }
      // ponytail: Kepware read not wired yet; a PLC-source machine reports "disconnected".
      s.tags = m.active && m.source === 'dummy' ? dummyStep(s.gen, m, dt, { hour, onBreak: br, breakIn: nextBreak }) : null;
      const status = !m.active ? 'inactive' : !s.tags ? 'disconnected' : s.tags.runStatus ? 'running' : br ? 'break' : 'stopped';
      if (status !== s.status) Object.assign(s, { status, since: now });
      if (!s.tags) continue;
      const { opened, closed } = record(s.rec, s.tags, now, dt, m.idealCycleTime, br);
      const events = db.collection(`machines/${m.id}/downtime`);
      // A new stop waits for an operator to confirm its reason.
      if (opened) events.doc(String(opened.start)).set({ ...opened, end: null, durationSec: null, confirmed: false, reasonCode: null }).catch(logErr);
      if (closed) events.doc(String(closed.start)).set(closed, { merge: true }).catch(logErr);
    }
  }, 1000);

  // Hour buckets are written once a minute (and on shutdown); older hours drop out of memory.
  function flush() {
    const keepFrom = currentShift().start;
    const writes = [];
    for (const [id, s] of state) {
      if (!s.ready) continue;
      for (const h of s.rec.dirty) writes.push(db.doc(`machines/${id}/hours/${h}`).set(s.rec.hours.get(h)).catch(logErr));
      s.rec.dirty.clear();
      for (const h of s.rec.hours.keys()) if (h < keepFrom) s.rec.hours.delete(h);
    }
    return Promise.all(writes);
  }
  setInterval(flush, 60_000);

  function snapshot() {
    const now = Date.now();
    const shift = currentShift(now);
    const rows = [...machines.values()].map((m) => {
      const s = state.get(m.id);
      const hours = [...(s?.rec.hours.values() ?? [])].filter((b) => b.start >= shift.start);
      const sum = excludePlanned(hours, s?.recent ?? [], now).reduce(add, ZERO);
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        line: m.line,
        area: m.area,
        source: m.source,
        status: s?.status ?? (m.active ? 'disconnected' : 'inactive'),
        since: s?.since ?? now,
        tags: s?.tags ?? null,
        sim: m.source === 'dummy' ? s?.gen.mode ?? 'normal' : null,
        pending: s?.pending.length ?? 0,
        pendingSince: s?.pending.length ? Math.min(...s.pending.map((e) => e.start)) : null,
        // the stop happening now, while it still waits for a reason
        openStop: (({ id, start, alarmCode } = {}) => (id ? { id, start, alarmCode } : null))(s?.pending.find((e) => e.end == null)),
        targets: m.targets ?? DEFAULT_TARGETS,
        plan: schedulePlan(shift, now, settings.breaks, sum.plannedStopSec, m.idealCycleTime), // schedule target qty
        ...sum,
        ...oee(sum),
      };
    });
    rows.sort((a, b) => a.code.localeCompare(b.code));
    const plant = rows.reduce((a, r) => add(a, r), ZERO);
    return {
      now,
      shift,
      plant: { ...plant, good: plant.total - plant.ng, ...oee(plant) },
      machines: rows,
    };
  }

  // Simulation for dummy machines: push OEE up or down live. ponytail: in memory, resets on restart.
  function simulate(id, mode) {
    const s = state.get(id);
    if (!s || machines.get(id)?.source !== 'dummy' || !MODES[mode]) return false;
    s.gen.mode = mode;
    return true;
  }

  return { snapshot, flush, simulate, settings: () => settings, pending: (id) => state.get(id)?.pending ?? [] };
}
