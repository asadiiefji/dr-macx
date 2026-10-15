// Downtime statistics (deterministic). The AI in ai.js reasons over these numbers.
import { currentShift, hourStart } from './oee.js';

const WEEK = 7 * 86400e3;
const round = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// Effective reason per event: the confirmed reason, else the one suggested by the stop's PLC alarm code.
export function withReasons(events, reasons, now = Date.now()) {
  const byCode = new Map(reasons.map((r) => [r.code, r]));
  const byAlarm = new Map(reasons.filter((r) => r.alarmCode != null).map((r) => [r.alarmCode, r]));
  return events.map((e) => {
    const r = (e.reasonCode && byCode.get(e.reasonCode)) || byAlarm.get(e.alarmCode);
    return {
      ...e,
      confirmed: e.confirmed !== false,
      code: r?.code ?? (e.alarmCode ? `ALARM-${e.alarmCode}` : 'NOT-GIVEN'),
      reason: r?.name ?? (e.alarmCode ? `Unmapped alarm ${e.alarmCode}` : 'Reason not given yet'),
      category: r?.category ?? 'Other',
      type: r?.type ?? 'unplanned',
      planned: e.planned === true, // set when the stop is confirmed with a planned reason; only then it leaves OEE
      suggested: !e.reasonCode && r ? r.code : null, // pre-filled for the operator to confirm
      shift: currentShift(e.start).name,
      minutes: (e.durationSec ?? (now - e.start) / 1000) / 60, // still-open stop counts up to now
    };
  });
}

// Points for giving a stop its reason: fast answers keep the downtime record honest.
export const POINTS = { fast: 10, late: 5, fastWithinMs: 5 * 60e3 };
export const pointsFor = (stopStart, confirmedAt) => (confirmedAt - stopStart <= POINTS.fastWithinMs ? POINTS.fast : POINTS.late);

// A case is "repeated" when the same reason hit the same machine 3+ times within 24 h (this stop included).
export const REPEAT = { windowMs: 24 * 3600e3, min: 3 };
export function markRepeats(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const byCode = new Map();
  for (const e of sorted) {
    const prev = (byCode.get(e.code) ?? []).filter((t) => t > e.start - REPEAT.windowMs);
    prev.push(e.start);
    byCode.set(e.code, prev);
    e.repeatCount = prev.length;
    e.repeated = prev.length >= REPEAT.min;
  }
  return events;
}

// events: output of withReasons (+ markRepeats). sum: summed hour buckets of the same range. buckets: those hours.
export function downtimeStats(events, sum, buckets, from, to, now = Date.now()) {
  const end = Math.min(to, now);
  const mid = from + (end - from) / 2;
  const runHours = sum.runSec / 3600;
  const groups = new Map();
  for (const e of events) {
    const g = groups.get(e.code) ?? { code: e.code, reason: e.reason, category: e.category, type: e.type, count: 0, repeated: 0, minutes: 0, firstHalf: 0, secondHalf: 0, last: 0, byShift: {}, weekly: [] };
    g.count++;
    if (e.repeated) g.repeated++;
    g.minutes += e.minutes;
    e.start < mid ? g.firstHalf++ : g.secondHalf++;
    g.last = Math.max(g.last, e.start);
    g.byShift[e.shift] = (g.byShift[e.shift] ?? 0) + 1;
    const w = Math.floor((end - e.start) / WEEK); // 0 = the last 7 days
    g.weekly[w] = (g.weekly[w] ?? 0) + 1;
    groups.set(e.code, g);
  }
  const totalMin = events.reduce((a, e) => a + e.minutes, 0);
  const plannedMin = events.filter((e) => e.planned).reduce((a, e) => a + e.minutes, 0);
  const weeks = Math.max(1, Math.ceil((end - from) / WEEK));
  const reasons = [...groups.values()]
    .map((g) => ({
      code: g.code,
      reason: g.reason,
      category: g.category,
      type: g.type,
      count: g.count,
      repeatedStops: g.repeated, // stops that were the 3rd+ of this reason within 24 h
      minutes: round(g.minutes),
      share: round(g.minutes / totalMin, 3),
      mttrMin: round(g.minutes / g.count),
      mtbfRunHours: round(runHours / g.count),
      hoursSinceLast: round((now - g.last) / 3600e3),
      // change in stop count between the first and second half of the range
      trend: g.firstHalf ? round((g.secondHalf - g.firstHalf) / g.firstHalf, 2) : null,
      byShift: g.byShift,
      weeklyCounts: Array.from({ length: weeks }, (_, i) => g.weekly[weeks - 1 - i] ?? 0), // oldest first
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // NC (non-conformance) rate in hours with a changeover vs other hours: tells whether setups hurt quality.
  const changeHours = new Set(events.filter((e) => e.category === 'Changeover').map((e) => hourStart(e.start)));
  const ng = (pick) => {
    const bs = buckets.filter(pick);
    const total = bs.reduce((a, b) => a + b.total, 0);
    return total ? round(bs.reduce((a, b) => a + b.ng, 0) / total, 4) : null;
  };

  return {
    stops: events.length,
    unconfirmedStops: events.filter((e) => !e.confirmed).length,
    downtimeMin: round(totalMin),
    plannedMin: round(plannedMin), // confirmed planned stops: not counted against OEE
    unplannedMin: round(totalMin - plannedMin),
    repeatedStops: events.filter((e) => e.repeated).length,
    mttrMin: events.length ? round(totalMin / events.length) : null,
    mtbfRunHours: events.length ? round(runHours / events.length) : null,
    reasons,
    ngRateChangeoverHours: ng((b) => changeHours.has(b.start)),
    ngRateOtherHours: ng((b) => !changeHours.has(b.start)),
  };
}

