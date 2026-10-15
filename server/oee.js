// Pure OEE math and plant time helpers (server local time; set TZ for the plant).

// ponytail: fixed plant-wide shift calendar; move to master data if plants differ.
export const SHIFTS = [
  { name: 'Shift 1', start: 7 },
  { name: 'Shift 2', start: 15 },
  { name: 'Shift 3', start: 23 },
];

export function currentShift(t = Date.now()) {
  const now = new Date(t);
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

export const hourStart = (t) => new Date(t).setMinutes(0, 0, 0);
export const dayStart = (t) => new Date(t).setHours(0, 0, 0, 0);

const minuteOfDay = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Planned breaks are "HH:MM"–"HH:MM" within one day; that time is not planned production time.
export function breakAt(t, breaks) {
  const d = new Date(t);
  const min = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  return breaks.find((b) => min >= minuteOfDay(b.start) && min < minuteOfDay(b.end)) ?? null;
}
export const onBreak = (t, breaks) => !!breakAt(t, breaks);

// Each break as [start, end] ms windows on the days that [from, to] touches.
function breakWindows(from, to, breaks) {
  const out = [];
  for (let day = dayStart(from - 86400e3); day <= to; day += 86400e3) {
    for (const b of breaks) out.push({ ...b, from: day + minuteOfDay(b.start) * 60e3, to: day + minuteOfDay(b.end) * 60e3 });
  }
  return out.filter((w) => w.to > from && w.from < to);
}

// Break seconds inside [from, to].
export const breakSecondsBetween = (from, to, breaks) =>
  breakWindows(from, to, breaks).reduce((a, w) => a + (Math.min(to, w.to) - Math.max(from, w.from)) / 1000, 0);

// Seconds until the next planned break starts today (Infinity if none is ahead).
export function breakIn(t, breaks) {
  const day = dayStart(t);
  const ahead = breaks.map((b) => day + minuteOfDay(b.start) * 60e3 - t).filter((ms) => ms > 0);
  return ahead.length ? Math.min(...ahead) / 1000 : Infinity;
}

// May a stop [start, end] take an operator-break reason? Yes if it overlaps a scheduled break widened by the
// tolerance on both sides (an early stop before the break, a late return after it).
export function touchesBreak(start, end, breaks, toleranceMs = 5 * 60e3) {
  return breakWindows(start - toleranceMs, end + toleranceMs, breaks).some((w) => start <= w.to + toleranceMs && end >= w.from - toleranceMs);
}

// Schedule target for one machine: pieces it should make at its ideal cycle time in the shift's planned time
// (shift time minus breaks minus confirmed planned stops). toNow = due by now, shift = whole shift.
export function schedulePlan(shift, now, breaks, plannedStopSec, idealCycleTime) {
  const until = Math.min(now, shift.end);
  const toNowSec = (until - shift.start) / 1000 - breakSecondsBetween(shift.start, until, breaks) - plannedStopSec;
  const shiftSec = (shift.end - shift.start) / 1000 - breakSecondsBetween(shift.start, shift.end, breaks) - plannedStopSec;
  return { toNow: Math.max(0, Math.floor(toNowSec / idealCycleTime)), shift: Math.max(0, Math.floor(shiftSec / idealCycleTime)) };
}

// What the machine was doing over [from, to]: run, unplanned or planned stop (with reason), planned break,
// or no data (no recorded hour). events need { id, start, end, planned, reason, ... } (withReasons output).
export function buildTimeline(from, to, events, breaks, recordedHours) {
  const stops = events.map((e) => ({ ...e, end: e.end ?? to })).filter((e) => e.end > from && e.start < to);
  const wins = breakWindows(from, to, breaks);
  const cuts = new Set([from, to]);
  for (const e of stops) cuts.add(Math.max(from, e.start)).add(Math.min(to, e.end));
  for (const w of wins) cuts.add(Math.max(from, w.from)).add(Math.min(to, w.to));
  for (let h = hourStart(from) + 3600e3; h < to; h += 3600e3) cuts.add(h);
  const points = [...cuts].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const mid = (a + b) / 2;
    const stop = stops.filter((e) => e.start <= mid && e.end > mid).sort((x, y) => y.start - x.start)[0];
    const brk = !stop && wins.find((w) => w.from <= mid && w.to > mid);
    const seg = stop
      ? { kind: stop.planned ? 'planned' : 'unplanned', label: stop.reason, eventId: stop.id, code: stop.code, category: stop.category, confirmed: stop.confirmed, comment: stop.comment ?? '', alarmCode: stop.alarmCode }
      : brk
        ? { kind: 'break', label: brk.name }
        : !recordedHours.has(hourStart(mid))
          ? { kind: 'nodata', label: 'No data recorded' }
          : { kind: 'run', label: 'Running' };
    const last = segs.at(-1);
    if (last && last.kind === seg.kind && last.label === seg.label && last.eventId === seg.eventId) last.end = b;
    else segs.push({ start: a, end: b, ...seg });
  }
  return segs;
}

// A bucket sums one machine's time and counts. idealSec = ideal cycle time × pieces made.
// plannedStopSec = stop time confirmed as planned downtime, taken out of planned time.
export const ZERO = { plannedSec: 0, runSec: 0, downSec: 0, plannedStopSec: 0, total: 0, ng: 0, idealSec: 0 };
export const add = (a, b) => Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k] + (b[k] ?? 0)]));

// Buckets are recorded raw; stops later confirmed as planned are taken out of planned time and downtime here.
export function excludePlanned(buckets, events, now = Date.now()) {
  const planned = events.filter((e) => e.planned);
  if (!planned.length) return buckets;
  return buckets.map((b) => {
    const end = b.start + 3600e3;
    let sec = 0;
    for (const e of planned) {
      const overlap = Math.min(end, e.end ?? now) - Math.max(b.start, e.start);
      if (overlap > 0) sec += overlap / 1000;
    }
    sec = Math.min(sec, b.downSec); // never more than the downtime recorded in that hour
    return sec ? { ...b, plannedSec: b.plannedSec - sec, downSec: b.downSec - sec, plannedStopSec: (b.plannedStopSec ?? 0) + sec } : b;
  });
}

export function oee(s) {
  const availability = s.plannedSec ? s.runSec / s.plannedSec : null;
  const performance = s.runSec ? Math.min(1, s.idealSec / s.runSec) : null;
  const quality = s.total ? (s.total - s.ng) / s.total : null;
  const value = availability === null ? null : availability * (performance ?? 0) * (quality ?? 1);
  return { availability, performance, quality, oee: value };
}

// Hourly buckets -> rows per hour, shift or day, each with its OEE.
export function groupBuckets(buckets, by) {
  const key = { hour: (t) => t, shift: (t) => currentShift(t).start, day: dayStart }[by];
  const groups = new Map();
  for (const b of buckets) {
    const k = key(b.start);
    groups.set(k, add(groups.get(k) ?? ZERO, b));
  }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([start, s]) => ({ start, ...s, ...oee(s) }));
}
