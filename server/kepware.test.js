import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest, kepwareReadings } from './kepware.js';
import { defaultTags, pressDefaults } from './sensors.js';

const press = (setup, device) => {
  const m = pressDefaults({ id: device, code: device, setup, frameType: 'straight-side', ratedTonnage: 400, nodes: 4 });
  return { ...m, sensorTags: defaultTags(m, 'Channel1', device) };
};
const push = (m, values, now) => ingest({ timestamp: now, values: Object.entries(values).map(([k, v]) => ({ id: m.sensorTags[k], v, q: true })) }, now);

test('ingest rejects a body without values', () => {
  assert.equal(ingest({}), null);
  assert.equal(ingest({ values: [{ id: 'x', v: 'abc' }, { id: 'y', v: 1, q: false }] }), 0);
});

test('Essential press: readings from its tags, parts made from the counter', () => {
  const m = press('essential', 'TestE');
  push(m, { laserEye: 1000, motorCurrent: 40, alarm: 0 }, 1000);
  const r1 = kepwareReadings(m, undefined, 1500);
  assert.equal(r1.laserEye, 1000);
  assert.equal(r1.made, 0); // first reading: nothing to compare with
  push(m, { laserEye: 1003, motorCurrent: 40, alarm: false }, 2000);
  const r2 = kepwareReadings(m, r1, 2000);
  assert.equal(r2.made, 3);
  assert.equal(r2.alarm, 0);
  push(m, { laserEye: 2, motorCurrent: 40, alarm: 0 }, 3000); // PLC counter reset
  assert.equal(kepwareReadings(m, r2, 3000).made, 2);
});

test('a needed tag missing or stale means disconnected; other sensors read null', () => {
  const m = press('premium', 'TestP');
  push(m, { laserEye: 5, motorCurrent: 60, alarm: 0 }, 1000);
  assert.equal(kepwareReadings(m, undefined, 1000), null); // Premium needs vision NC too
  push(m, { visionNc: 1, tonnage2: 98.5 }, 1000);
  const r = kepwareReadings(m, undefined, 1000);
  assert.equal(r.visionNc, 1);
  assert.equal(r.tonnage[1], 98.5);
  assert.equal(r.tonnage[0], null);
  assert.equal(r.vibMotor, null);
  assert.equal(kepwareReadings(m, undefined, 1000 + 10_001), null); // nothing for over 10 s
});
