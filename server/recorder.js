// Turns one machine's tag readings into hourly OEE buckets and downtime events.
import { hourStart, ZERO } from './oee.js';

export const newRecorder = () => ({ hours: new Map(), open: null, dirty: new Set() });

// Counters are cumulative like a PLC's; a drop means the counter was reset, so the new value is the delta.
const delta = (cur, last) => (last === undefined ? 0 : cur >= last ? cur - last : cur);

// Returns { opened, closed } downtime events for this reading (either may be null).
export function record(r, tags, t, dt, idealCycleTime, onBreak) {
  const h = hourStart(t);
  let b = r.hours.get(h);
  if (!b) r.hours.set(h, (b = { start: h, ...ZERO }));
  r.dirty.add(h);

  const made = delta(tags.totalCount, r.lastTotal);
  b.total += made;
  b.ng += delta(tags.rejectCount, r.lastNg);
  b.idealSec += made * idealCycleTime;
  r.lastTotal = tags.totalCount;
  r.lastNg = tags.rejectCount;

  if (!onBreak) {
    b.plannedSec += dt;
    if (tags.runStatus) b.runSec += dt;
    else b.downSec += dt;
  }

  // A stop outside a planned break is downtime.
  const down = !tags.runStatus && !onBreak;
  let opened = null;
  let closed = null;
  if (down && !r.open) opened = r.open = { start: t, alarmCode: tags.alarmCode };
  else if (!down && r.open) {
    closed = { ...r.open, end: t, durationSec: (t - r.open.start) / 1000 };
    r.open = null;
  }
  return { opened, closed };
}
