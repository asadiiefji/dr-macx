import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentShift, oee, onBreak, breakIn, touchesBreak, groupBuckets, excludePlanned, ZERO } from './oee.js';
import { newRecorder, record } from './recorder.js';
import { withReasons, markRepeats, downtimeStats, pointsFor } from './analysis.js';
import { parseJson } from './ai.js';

const at = (h, m = 0, d = 15) => new Date(2026, 9, d, h, m).getTime();

test('shift wraps past midnight', () => {
  const s = currentShift(at(3, 20));
  assert.equal(s.name, 'Shift 3');
  assert.equal(s.start, at(23, 0, 14));
  assert.equal(s.end - s.start, 8 * 3600e3);
  assert.equal(currentShift(at(7)).name, 'Shift 1');
  assert.equal(currentShift(at(23, 59)).name, 'Shift 3');
});

test('planned breaks', () => {
  const breaks = [{ name: 'Lunch', start: '12:00', end: '12:30' }];
  assert.equal(onBreak(at(12, 15), breaks), true);
  assert.equal(onBreak(at(12, 30), breaks), false);
  assert.equal(onBreak(at(11, 59), breaks), false);
  assert.equal(breakIn(at(11, 57), breaks), 180);
  // operator-break reason fits an early stop or a late return, not a random stop
  assert.equal(touchesBreak(at(11, 55), at(12, 0), breaks), true);
  assert.equal(touchesBreak(at(12, 30), at(12, 33), breaks), true);
  assert.equal(touchesBreak(at(10, 0), at(10, 5), breaks), false);
});

test('OEE = A × P × Q', () => {
  // 100 s planned, 80 s running, 60 made at ideal 1 s, 6 NC
  const r = oee({ ...ZERO, plannedSec: 100, runSec: 80, total: 60, ng: 6, idealSec: 60 });
  assert.equal(r.availability, 0.8);
  assert.equal(r.performance, 0.75);
  assert.equal(r.quality, 0.9);
  assert.ok(Math.abs(r.oee - 0.54) < 1e-9);
  assert.equal(oee({ ...ZERO, plannedSec: 10 }).oee, 0);
  assert.equal(oee(ZERO).oee, null);
});

test('recorder: counter deltas, PLC counter reset, breaks and downtime events', () => {
  const r = newRecorder();
  const tags = (run, total, ng, alarm = 0) => ({ runStatus: run, totalCount: total, rejectCount: ng, alarmCode: alarm });
  const t0 = at(10);
  record(r, tags(1, 500, 10), t0, 1, 2, false); // baseline only
  record(r, tags(1, 510, 11), t0 + 1e3, 1, 2, false);
  const s = record(r, tags(0, 510, 11, 310), t0 + 2e3, 1, 2, false);
  assert.deepEqual(s.opened, { start: t0 + 2e3, alarmCode: 310 });
  record(r, tags(0, 510, 11, 310), t0 + 3e3, 1, 2, true); // break starts: stop ends, time not planned
  const e = record(r, tags(1, 3, 0), t0 + 4e3, 1, 2, false); // PLC counter reset -> +3
  const b = r.hours.get(at(10));
  assert.deepEqual([b.total, b.ng, b.idealSec, b.runSec, b.downSec, b.plannedSec], [13, 1, 26, 3, 1, 4]);
  assert.equal(e.closed, null); // already closed when the break started
  assert.equal(r.open, null);
});

test('groupBuckets sums hours into days', () => {
  const h = (t, total) => ({ ...ZERO, start: t, plannedSec: 3600, runSec: 3600, total, idealSec: total });
  const rows = groupBuckets([h(at(10), 100), h(at(11), 200), h(at(10, 0, 16), 50)], 'day');
  assert.deepEqual(rows.map((r) => r.total), [300, 50]);
});

test('downtime stats: Pareto, MTBF, trend, confirmed vs suggested reasons', () => {
  const from = at(0, 0, 1);
  const to = at(0, 0, 15);
  const ev = (d, code, min, extra) => ({ start: at(10, 0, d), alarmCode: code, durationSec: min * 60, ...extra });
  const events = withReasons(
    [ev(2, 310, 20), ev(10, 310, 30), ev(12, 310, 10, { confirmed: false }), ev(3, 101, 1), ev(4, 101, 1, { reasonCode: 'MT-COIL' })],
    [
      { code: 'BD-HYD', name: 'Hydraulic pressure low', category: 'Breakdown', alarmCode: 310 },
      { code: 'MS-JAM', name: 'Jam', category: 'Minor stop', alarmCode: 101 },
      { code: 'MT-COIL', name: 'Coil shortage', category: 'Material', alarmCode: null },
    ],
  );
  assert.equal(events[2].confirmed, false);
  assert.equal(events[2].suggested, 'BD-HYD');
  const s = downtimeStats(events, { ...ZERO, runSec: 100 * 3600 }, [], from, to, to);
  assert.equal(s.stops, 5);
  assert.equal(s.unconfirmedStops, 1);
  assert.equal(s.reasons[0].reason, 'Hydraulic pressure low');
  assert.equal(s.reasons[0].minutes, 60);
  assert.equal(s.reasons[0].mtbfRunHours, 33.3);
  assert.equal(s.reasons[0].trend, 1); // 1 stop in first half, 2 in second
  assert.deepEqual(s.reasons[0].weeklyCounts, [1, 2]);
  assert.ok(s.reasons.some((r) => r.reason === 'Coil shortage'));
});

test('simulation modes move OEE the right way', async () => {
  const { newDummy, dummyStep } = await import('./dummy.js');
  const { newRecorder, record } = await import('./recorder.js');
  const run = (mode) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gen = { ...newDummy(), mode };
    const rec = newRecorder();
    for (let t = at(8); t < at(14); t += 1000) record(rec, dummyStep(gen, { idealCycleTime: 6 }, 1, { rnd }), t, 1, 6, false);
    return oee([...rec.hours.values()].reduce((a, b) => ({ ...a, ...Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k] + b[k]])) }), ZERO)).oee;
  };
  const [worse, normal, better] = ['worse', 'normal', 'better'].map(run);
  assert.ok(worse < normal && normal < better, `${worse} < ${normal} < ${better}`);
});

test('planned stops leave planned time, so they do not lower OEE', () => {
  const b = [{ ...ZERO, start: at(10), plannedSec: 3600, runSec: 3000, downSec: 600, total: 500, idealSec: 2500 }];
  const [x] = excludePlanned(b, [{ start: at(10, 10), end: at(10, 15), planned: true }, { start: at(10, 20), end: at(10, 22) }]);
  assert.deepEqual([x.plannedSec, x.downSec, x.plannedStopSec], [3300, 300, 300]);
  assert.ok(oee(x).availability > oee(b[0]).availability);
});

test('repeated case = same reason 3+ times within 24 h', () => {
  const e = (h, code) => ({ start: at(h), code });
  const evs = markRepeats([e(1, 'A'), e(5, 'A'), e(9, 'B'), e(20, 'A'), e(23, 'A')]);
  assert.deepEqual(evs.map((x) => x.repeatCount), [1, 2, 1, 3, 4]);
  assert.deepEqual(evs.map((x) => x.repeated), [false, false, false, true, true]);
  // older than 24 h no longer counts
  assert.equal(markRepeats([{ start: at(1, 0, 10), code: 'A' }, { start: at(1, 0, 12), code: 'A' }, { start: at(2, 0, 12), code: 'A' }])[2].repeatCount, 2);
});

test('Gemma reply JSON is found inside prose or a code fence', () => {
  assert.deepEqual(parseJson('Sure!\n```json\n{"reasonCode":"BD-HYD","confidence":0.8}\n```'), { reasonCode: 'BD-HYD', confidence: 0.8 });
  assert.equal(parseJson('no json here'), null);
});

test('points: +10 within 5 min of the stop starting, +5 later', () => {
  assert.equal(pointsFor(at(10), at(10, 5)), 10);
  assert.equal(pointsFor(at(10), at(10, 6)), 5);
});

test('break reason tolerance, schedule plan and shift timeline', async () => {
  const { schedulePlan, buildTimeline } = await import('./oee.js');
  const breaks = [{ name: 'Tea', start: '09:00', end: '09:15' }, { name: 'Lunch', start: '12:00', end: '12:45' }];
  // ±5 min around a break may take an operator-break reason
  assert.equal(touchesBreak(at(8, 56), at(8, 58), breaks), true);
  assert.equal(touchesBreak(at(8, 50), at(8, 54), breaks), false);
  assert.equal(touchesBreak(at(12, 49), at(12, 52), breaks), true);
  assert.equal(touchesBreak(at(12, 51), at(12, 55), breaks), false);
  assert.equal(touchesBreak(at(8, 50), at(8, 54), breaks, 10 * 60e3), true);
  // 07:00–10:00 = 180 min − 15 min tea = 165 min at 6 s/piece; whole shift 480 − 60 min of breaks
  assert.deepEqual(schedulePlan(currentShift(at(10)), at(10), breaks, 0, 6), { toNow: 1650, shift: 4200 });
  const segs = buildTimeline(
    at(7), at(10),
    [{ id: 'a', start: at(7), end: at(7, 45), planned: false, reason: 'Material setup' }, { id: 'b', start: at(9, 30), end: null, planned: true, reason: 'QC' }],
    breaks, new Set([at(7), at(8), at(9)]),
  );
  assert.deepEqual(segs.map((s) => [s.kind, (s.end - s.start) / 60e3]), [['unplanned', 45], ['run', 75], ['break', 15], ['run', 15], ['planned', 30]]);
});

test('Google AI errors are explained: depleted credits (402) before rate limit (429)', async () => {
  const { explain } = await import('./ai.js');
  const err = (status, message) => Object.assign(new Error(message), { status });
  assert.match(explain(err(402, 'Your prepayment credits are depleted. RESOURCE_EXHAUSTED')), /credits .* used up/);
  assert.match(explain(err(429, 'RESOURCE_EXHAUSTED')), /rate limit/);
  assert.equal(explain(err(500, 'boom')), null);
});

test('AI calls retry a busy (429) answer twice, then give up', async () => {
  const { track } = await import('./ai.js');
  const busy = Object.assign(new Error('Resource exhausted'), { status: 429 });
  const waits = [];
  let n = 0;
  assert.equal(await track('gemma', async () => (++n < 3 ? Promise.reject(busy) : 'ok'), async (ms) => waits.push(ms)), 'ok');
  assert.deepEqual(waits, [1000, 3000]);
  await assert.rejects(track('gemma', async () => Promise.reject(busy), async () => {}), { status: 429 });
});
