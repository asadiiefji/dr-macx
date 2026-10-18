import { test } from 'node:test';
import { badId } from './validate.js';
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
  const { pressDefaults, toOeeTags } = await import('./sensors.js');
  const m = pressDefaults({ idealCycleTime: 6, setup: 'premium', frameType: 'straight-side', ratedTonnage: 400 });
  const run = (mode, levels = null) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gen = { ...newDummy(), mode, levels };
    const rec = newRecorder();
    for (let t = at(8); t < at(14); t += 1000) record(rec, toOeeTags(m, dummyStep(gen, m, 1, { rnd }), 0), t, 1, 6, false);
    return oee([...rec.hours.values()].reduce((a, b) => ({ ...a, ...Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k] + b[k]])) }), ZERO));
  };
  const [worse, normal, better] = ['worse', 'normal', 'better'].map((x) => run(x).oee);
  assert.ok(worse < normal && normal < better, `${worse} < ${normal} < ${better}`);
  // one factor at a time: only that factor drops (A = stops, P = stroke speed, Q = NC)
  const base = run('normal');
  for (const f of ['availability', 'performance', 'quality']) {
    const k = run('normal', { availability: 'normal', performance: 'normal', quality: 'normal', [f]: 'worse' });
    assert.ok(k[f] < base[f] - 0.02, `${f} lower: ${k[f]} < ${base[f]}`);
  }
});

test('simulated breakdown stops the press at once with the hydraulic alarm', async () => {
  const { newDummy, dummyStep, injectFault } = await import('./dummy.js');
  const { pressDefaults } = await import('./sensors.js');
  const m = pressDefaults({ idealCycleTime: 6 });
  const gen = newDummy();
  injectFault(gen, m, 'breakdown', () => 0.5);
  const r = dummyStep(gen, m, 1, { rnd: () => 0.99 });
  assert.equal(r.alarm, 310);
  assert.equal(r.made, 0);
  assert.ok(gen.stopLeft > 500);
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

test('AI reply JSON is found inside prose or a code fence', () => {
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
  assert.equal(await track('gemini', async () => (++n < 3 ? Promise.reject(busy) : 'ok'), async (ms) => waits.push(ms)), 'ok');
  assert.deepEqual(waits, [1000, 3000]);
  await assert.rejects(track('gemini', async () => Promise.reject(busy), async () => {}), { status: 429 });
});

test('sensors: motor states, tonnage nodes, Essential vs Premium, OEE adapter', async () => {
  const { motorState, sensorsFor, judge, nodeNominal, toOeeTags, pressDefaults } = await import('./sensors.js');
  const premium = pressDefaults({ setup: 'premium', frameType: 'straight-side', ratedTonnage: 400 });
  const essential = pressDefaults({ setup: 'essential', frameType: 'c-frame', ratedTonnage: 160 });
  assert.deepEqual([premium.nodes, essential.nodes], [4, 2]);
  assert.equal(sensorsFor(essential).length, 3); // laser eye, motor current, alarm word
  assert.equal(sensorsFor(premium).filter((s) => s.node).length, 4);
  // 400 t on 4 nodes = 100 t each; ±5 %: 104 ok, 110 out (your example)
  assert.equal(nodeNominal(premium), 100);
  const node = sensorsFor(premium).find((s) => s.node === 2);
  assert.equal(judge(premium, node, 104), 'ok');
  assert.equal(judge(premium, node, 110), 'alarm');
  assert.equal(judge(premium, node, 106), 'warn');
  // motor current: off < 1 A, idle < 30 % of full-load amps, else running
  assert.deepEqual([0.4, 10, 40].map((a) => motorState(a, premium.motorFla)), ['off', 'idle', 'running']);
  // NC: vision on Premium, operator entries on Essential
  const r = { motorCurrent: 40, laserEye: 120, visionNc: 3, alarm: 0 };
  assert.deepEqual(toOeeTags(premium, r, 9), { runStatus: 1, totalCount: 120, rejectCount: 3, alarmCode: 0 });
  assert.equal(toOeeTags(essential, { ...r, motorCurrent: 20 }, 9).rejectCount, 9);
});

test('fault stories show up in the sensors', async () => {
  const { newDummy, dummyStep, injectFault } = await import('./dummy.js');
  const { pressDefaults } = await import('./sensors.js');
  const m = pressDefaults({ idealCycleTime: 1, setup: 'premium', frameType: 'straight-side', ratedTonnage: 400 });
  const gen = newDummy();
  injectFault(gen, m, 'looseNode', () => 0); // node 1, target 1.09
  let r;
  for (let i = 0; i < 120; i++) r = dummyStep(gen, m, 1, { rnd: () => 0.5 });
  assert.ok(r.tonnage[0] > 105 && r.tonnage[1] < 102, `loose node ${r.tonnage}`);
  injectFault(gen, m, 'stick');
  r = dummyStep(gen, m, 1, { rnd: () => 0.5 });
  assert.ok(r.acoustic > 2, `stick score ${r.acoustic}`);
});

test('per-minute telemetry row for BigQuery', async () => {
  const { newMinute, addReading, minuteRow } = await import('./telemetry.js');
  const { pressDefaults } = await import('./sensors.js');
  const m = pressDefaults({ id: 'p', code: 'P', setup: 'essential', ratedTonnage: 160 });
  const a = newMinute(at(10), m.nodes);
  const r = (amps, made) => ({ motorCurrent: amps, laserEye: 0, alarm: 0, tonnage: [80, 80], made, vibMotor: 2, vibGearbox: 2, tempMotor: 50, tempGearbox: 45, tempLube: 40, visionNc: 0, acoustic: 1, ioFaults: 0 });
  for (let i = 0; i < 40; i++) addReading(a, m, r(25, 1), 1, false, 0);
  for (let i = 0; i < 20; i++) addReading(a, m, r(4, 0), 1, false, i === 0 ? 2 : 0);
  const row = minuteRow(a, m, 'normal');
  assert.deepEqual([row.run_sec, row.idle_sec, row.parts, row.nc, row.tonnage_avg.length, row.vib_motor], [40, 20, 40, 2, 0, null]);
});

test('soul: target risk, hourly surprise and sensor anomalies', async () => {
  const { targetRisk, riskText, riskChanged, surpriseCheck, surpriseText, hourCauses, anomalies, anomalyText } = await import('./soulRules.js');
  const { pressDefaults, sensorsFor } = await import('./sensors.js');
  const { shiftForecast } = await import('./oee.js');
  // 4 h in, 1,500 good of a 4,800 shift plan (85 % target = 4,080): at this pace ~3,000 by shift end.
  const shift = (good, plannedSec = 4 * 3600) => ({ plannedSec, idealCycleTime: 6, forecast: shiftForecast({ good, plannedSec, plan: { toNow: 2400, shift: 4800 }, idealCycleTime: 6, oeeTarget: 85 }) });
  const r = targetRisk(shift(1500));
  assert.equal(r.atRisk, true);
  assert.equal(r.target, 4080);
  assert.equal(r.projected, 3000);
  // even at the ideal 6 s with no more stops: 1,500 + 14,400 s / 6 = 3,900 < 4,080, so say so plainly
  assert.equal(r.best, 3900);
  assert.equal(r.reachable, false);
  assert.match(riskText(r, 6), /can't be reached .* about 3,900/);
  assert.doesNotMatch(riskText(r, 6), /every \d/); // no impossible pace asked for
  const ok = targetRisk(shift(2000)); // 2,000 + 2,400 = 4,400 possible: reachable, so the needed pace is fine
  assert.equal(ok.reachable, true);
  assert.ok(ok.neededPaceSec >= 6);
  assert.equal(targetRisk(shift(3000)).atRisk, false); // on pace for 6,000
  assert.equal(targetRisk(shift(1500, 600)), null); // too early in the shift to judge
  assert.equal(riskChanged(r, { reachable: false, short: r.short + 50 }), false); // same story: stay quiet
  assert.equal(riskChanged(r, { reachable: true, short: r.short }), true);
  // the hour's stops are proposed as the cause
  const at0 = at(5);
  const causes = hourCauses([{ start: at0 + 60e3, end: at0 + 300e3, reason: 'Material jam in feeder' }, { start: at0 + 600e3, end: at0 + 900e3, reason: 'Material jam in feeder' }, { start: at0 + 1200e3, end: at0 + 1740e3, reason: 'Coil shortage' }], at0);
  assert.deepEqual(causes.map((c) => [c.reason, c.count, c.minutes]), [['Material jam in feeder', 2, 9], ['Coil shortage', 1, 9]]);
  assert.match(surpriseText(at0, { expected: 400, actual: 310 }, causes), /I made 310 .* 2 × Material jam in feeder \(9 min\) and Coil shortage \(9 min\)\. Was that it\?/);

  const prev = [{ plannedSec: 3600, total: 500, ng: 0 }, { plannedSec: 3600, total: 520, ng: 20 }];
  assert.equal(surpriseCheck({ plannedSec: 3600, total: 310, ng: 0 }, prev).surprise, true); // expected 500, got 310
  assert.equal(surpriseCheck({ plannedSec: 3600, total: 450, ng: 0 }, prev).surprise, false); // 90 %
  assert.equal(surpriseCheck({ plannedSec: 3600, total: 10, ng: 0 }, []), null); // no history yet

  const m = pressDefaults({ setup: 'premium', frameType: 'straight-side', ratedTonnage: 400, nodes: 4, nodeTolerancePct: 5 });
  const status = Object.fromEntries(sensorsFor(m).map((s) => [s.id, 'ok']));
  const press = { ...m, readings: { tonnage: [100, 100, 100, 110] }, sensorStatus: { ...status, tonnage4: 'warn' } };
  const mem = { since: {}, spoke: {} };
  assert.equal(anomalies(press, mem, 0).length, 0); // must hold 30 s first
  const [a] = anomalies(press, mem, 31e3);
  assert.equal(a.sensor.node, 4);
  assert.equal(a.value, 110);
  assert.match(anomalyText(m, a.sensor, a.value, a.state), /node 4 \(left rear\) reads 110\.0 tons, 10 percent above/);
  assert.equal(anomalies(press, mem, 60e3).length, 0); // said already
  assert.equal(anomalies({ ...press, sensorStatus: { ...status, tonnage4: 'alarm' } }, mem, 90e3).length, 1); // escalated
  assert.equal(anomalies({ ...press, sensorStatus: status }, mem, 100e3).length, 0);
  const { judge } = await import('./sensors.js');
  assert.equal(judge(m, sensorsFor(m)[3], 0), 'none'); // no stroke yet: a load cell reading 0 is not an alarm
  assert.equal(mem.since.tonnage4, undefined); // back to ok resets the hold
});

test('cycle time learner: fastest stable 10 %, suggest when > 5 % off', async () => {
  const { bestCycleTime, suggestCycle } = await import('./cycle.js');
  // 100 full running minutes at 8.0 s/part, 10 at 7.0 s/part, plus partial minutes that must be ignored
  const mins = [...Array(100).fill({ runSec: 60, parts: 7.5 }), ...Array(10).fill({ runSec: 60, parts: 60 / 7 }), { runSec: 20, parts: 10 }, { runSec: 60, parts: 0 }];
  const best = bestCycleTime(mins, 60, 60);
  assert.deepEqual(best, { seconds: 7.1, samples: 110 }); // fastest 11 = ten at 7.0 + one at 8.0
  assert.equal(bestCycleTime(mins.slice(0, 10), 60, 60), null); // too few samples
  assert.equal(suggestCycle({ idealCycleTime: 7 }, best, 0), null); // within 5 %
  assert.deepEqual(suggestCycle({ idealCycleTime: 6 }, best, 0), { from: 6, to: 7.1, samples: 110, at: 0, status: 'pending' });
  assert.equal(suggestCycle({ idealCycleTime: 6, cycleSuggestion: { status: 'pending' } }, best, 0), null);
  assert.equal(suggestCycle({ idealCycleTime: 6, cycleSuggestion: { status: 'rejected', at: 0 } }, best, 86400e3), null); // rejected yesterday
  assert.ok(suggestCycle({ idealCycleTime: 6, cycleSuggestion: { status: 'rejected', at: 0 } }, best, 8 * 86400e3)); // a week later: again
});

test('last-15-min OEE and the sensor that found a stop', async () => {
  const { windowOee } = await import('./telemetry.js');
  const { stopSensor, pressDefaults } = await import('./sensors.js');
  const min = (runSec, parts, nc = 0, breakSec = 0) => ({ runSec, parts, nc, breakSec, secs: 60 });
  const w = windowOee([min(60, 10), min(30, 5, 1)], 6); // 90 s run of 120 s, 15 parts × 6 s = 90 s, 1 NC
  assert.equal(w.availability, 0.75);
  assert.equal(w.performance, 1);
  assert.equal(Math.round(w.quality * 100), 93);
  assert.equal(windowOee([min(0, 0, 0, 60)], 6), null); // a break: nothing to judge
  const premium = pressDefaults({ setup: 'premium', frameType: 'straight-side', ratedTonnage: 400, nodes: 4 });
  const essential = pressDefaults({ setup: 'essential' });
  assert.equal(stopSensor(premium, 101).id, 'acoustic'); // jam: the stick score saw it coming
  assert.equal(stopSensor(essential, 101).id, 'laserEye'); // no microphone: parts stopped coming
  assert.equal(stopSensor(premium, 0, [{ tonnage: [100, 100, 100, 112] }]).id, 'tonnage4'); // no alarm: the sensor out of limits
  assert.equal(stopSensor(premium, 0, [{ tonnage: [100, 100, 100, 100] }]).id, 'motorCurrent');
});

test('ids that would address another document are refused', () => {
  for (const ok of ['prs-03', 'op-001', 'BD-HYD', '1792250842828']) assert.equal(badId(ok), false, ok);
  for (const bad of ['prs-03/downtime/1', '.', '..', '', null, 42]) assert.equal(badId(bad), true, String(bad));
});
