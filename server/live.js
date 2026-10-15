// Live layer: reads each active machine's 4 tags every second (dummy generator now,
// Kepware later) and accumulates OEE for the current shift.

// ponytail: fixed plant-wide shift calendar in server local time (TZ env); move to master data if plants differ.
export const SHIFTS = [
  { name: 'Shift 1', start: 7 },
  { name: 'Shift 2', start: 15 },
  { name: 'Shift 3', start: 23 },
];

export function currentShift(now = new Date()) {
  let i = SHIFTS.findLastIndex((s) => s.start <= now.getHours());
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  if (i === -1) {
    i = SHIFTS.length - 1;
    start.setDate(start.getDate() - 1);
  }
  start.setHours(SHIFTS[i].start);
  const next = SHIFTS[(i + 1) % SHIFTS.length].start;
  const hours = (next - SHIFTS[i].start + 24) % 24 || 24;
  return { name: SHIFTS[i].name, start: start.getTime(), end: start.getTime() + hours * 3600e3 };
}

const ALARMS = [101, 102, 205, 310, 412]; // dummy fault codes

// PLC-like dummy: cumulative counters, random stops with alarm codes, ~2% NG.
export function dummyRead(m, st, dt) {
  if (st.run) {
    if (Math.random() < dt / 600) {
      // about one stop per 10 min of running, lasting 20 s – 3 min
      st.run = false;
      st.alarm = ALARMS[Math.floor(Math.random() * ALARMS.length)];
      st.stopLeft = 20 + Math.random() * 160;
    } else {
      st.partial += dt / (m.idealCycleTime * (1.05 + Math.random() * 0.25)); // run a bit slower than ideal
      while (st.partial >= 1) {
        st.partial--;
        st.total++;
        if (Math.random() < 0.02) st.ng++;
      }
    }
  } else if ((st.stopLeft -= dt) <= 0) {
    st.run = true;
    st.alarm = 0;
  }
  return { runStatus: st.run ? 1 : 0, totalCount: st.total, rejectCount: st.ng, alarmCode: st.alarm };
}

// Add one reading to a machine's shift accumulator. Counters are cumulative like a PLC's;
// a drop means the counter was reset, so the new value is the delta.
export function accumulate(acc, tags, dt, shift) {
  if (acc.shiftStart !== shift.start) Object.assign(acc, { shiftStart: shift.start, runSec: 0, plannedSec: 0, total: 0, ng: 0 });
  const delta = (cur, last) => (last === undefined ? 0 : cur >= last ? cur - last : cur);
  acc.total += delta(tags.totalCount, acc.lastTotal);
  acc.ng += delta(tags.rejectCount, acc.lastNg);
  acc.lastTotal = tags.totalCount;
  acc.lastNg = tags.rejectCount;
  acc.plannedSec += dt;
  if (tags.runStatus) acc.runSec += dt;
  return acc;
}

export function oee({ plannedSec, runSec, total, ng }, idealCycleTime) {
  const availability = plannedSec ? runSec / plannedSec : null;
  const performance = runSec ? Math.min(1, (idealCycleTime * total) / runSec) : null;
  const quality = total ? (total - ng) / total : null;
  const value = availability === null ? null : availability * (performance ?? 0) * (quality ?? 1);
  return { availability, performance, quality, oee: value };
}

// Plant totals weighted by time, so a big machine idle counts more than a small one.
export function plantOee(rows) {
  const s = rows.reduce(
    (a, r) => ({
      plannedSec: a.plannedSec + r.plannedSec,
      runSec: a.runSec + r.runSec,
      total: a.total + r.total,
      ng: a.ng + r.ng,
      ideal: a.ideal + r.idealCycleTime * r.total,
      idealGood: a.idealGood + r.idealCycleTime * (r.total - r.ng),
    }),
    { plannedSec: 0, runSec: 0, total: 0, ng: 0, ideal: 0, idealGood: 0 },
  );
  return {
    total: s.total,
    ng: s.ng,
    good: s.total - s.ng,
    availability: s.plannedSec ? s.runSec / s.plannedSec : null,
    performance: s.runSec ? Math.min(1, s.ideal / s.runSec) : null,
    quality: s.total ? (s.total - s.ng) / s.total : null,
    oee: s.plannedSec ? s.idealGood / s.plannedSec : null,
  };
}

// Watches the machines collection and polls every second. Returns a snapshot getter.
export function startLive(db) {
  const machines = new Map();
  const state = new Map(); // id -> { gen, acc, tags, status, since }

  // A listener that errors is dead for good, so resubscribe (e.g. Firestore not up yet).
  const watch = () =>
    db.collection('machines').onSnapshot(
      (snap) => {
        machines.clear();
        snap.forEach((d) => machines.set(d.id, { id: d.id, ...d.data() }));
        for (const id of state.keys()) if (!machines.has(id)) state.delete(id);
      },
      (err) => {
        console.error('machines listener failed, retrying in 5 s:', err.message);
        setTimeout(watch, 5000);
      },
    );
  watch();

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    const shift = currentShift(new Date(now));
    for (const m of machines.values()) {
      const s = state.get(m.id) ?? { gen: { run: true, total: 0, ng: 0, alarm: 0, partial: 0 }, acc: {}, since: now };
      state.set(m.id, s);
      // ponytail: Kepware read not wired yet; a PLC-source machine reports "disconnected".
      s.tags = m.active && m.source === 'dummy' ? dummyRead(m, s.gen, dt) : null;
      const status = !m.active ? 'inactive' : !s.tags ? 'disconnected' : s.tags.runStatus ? 'running' : 'stopped';
      if (status !== s.status) Object.assign(s, { status, since: now });
      if (s.tags) accumulate(s.acc, s.tags, dt, shift);
      else if (s.acc.shiftStart !== shift.start) s.acc = {};
    }
  }, 1000);

  return () => {
    const shift = currentShift();
    const rows = [...machines.values()].map((m) => {
      const s = state.get(m.id) ?? { acc: {}, status: m.active ? 'disconnected' : 'inactive', since: Date.now() };
      const acc = s.acc.shiftStart === shift.start ? s.acc : { plannedSec: 0, runSec: 0, total: 0, ng: 0 };
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        line: m.line,
        area: m.area,
        source: m.source,
        idealCycleTime: m.idealCycleTime,
        status: s.status,
        since: s.since,
        tags: s.tags ?? null,
        plannedSec: acc.plannedSec,
        runSec: acc.runSec,
        total: acc.total,
        ng: acc.ng,
        ...oee(acc, m.idealCycleTime),
      };
    });
    rows.sort((a, b) => a.code.localeCompare(b.code));
    return { now: Date.now(), shift, plant: plantOee(rows), machines: rows };
  };
}
