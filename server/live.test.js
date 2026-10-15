import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentShift, accumulate, oee, plantOee } from './live.js';

test('shift wraps past midnight', () => {
  const s = currentShift(new Date(2026, 9, 15, 3, 20));
  assert.equal(s.name, 'Shift 3');
  assert.equal(s.start, new Date(2026, 9, 14, 23).getTime());
  assert.equal(s.end - s.start, 8 * 3600e3);
  assert.equal(currentShift(new Date(2026, 9, 15, 7, 0)).name, 'Shift 1');
  assert.equal(currentShift(new Date(2026, 9, 15, 23, 59)).name, 'Shift 3');
});

test('accumulate uses counter deltas, handles PLC counter reset and new shift', () => {
  const sh = { start: 1 };
  const acc = {};
  accumulate(acc, { runStatus: 1, totalCount: 500, rejectCount: 10 }, 1, sh); // baseline only
  accumulate(acc, { runStatus: 1, totalCount: 510, rejectCount: 11 }, 1, sh);
  accumulate(acc, { runStatus: 0, totalCount: 3, rejectCount: 0 }, 1, sh); // reset -> +3
  assert.deepEqual([acc.total, acc.ng, acc.runSec, acc.plannedSec], [13, 1, 2, 3]);
  accumulate(acc, { runStatus: 1, totalCount: 5, rejectCount: 0 }, 1, { start: 2 });
  assert.deepEqual([acc.total, acc.plannedSec], [2, 1]);
});

test('OEE = A × P × Q', () => {
  // 100 s planned, 80 s running, ideal 1 s, 60 made, 6 NG
  const r = oee({ plannedSec: 100, runSec: 80, total: 60, ng: 6 }, 1);
  assert.equal(r.availability, 0.8);
  assert.equal(r.performance, 0.75);
  assert.equal(r.quality, 0.9);
  assert.ok(Math.abs(r.oee - 0.54) < 1e-9);
  assert.equal(oee({ plannedSec: 10, runSec: 0, total: 0, ng: 0 }, 1).oee, 0);
  assert.equal(oee({ plannedSec: 0, runSec: 0, total: 0, ng: 0 }, 1).oee, null);
});

test('plant OEE matches A × P × Q of the summed machines', () => {
  const p = plantOee([
    { plannedSec: 100, runSec: 80, total: 60, ng: 6, idealCycleTime: 1 },
    { plannedSec: 0, runSec: 0, total: 0, ng: 0, idealCycleTime: 5 }, // disconnected
  ]);
  assert.ok(Math.abs(p.oee - 0.54) < 1e-9);
  assert.equal(p.good, 54);
});
