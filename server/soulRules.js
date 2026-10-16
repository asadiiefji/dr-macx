// When and what the Machine Soul says on its own (pure rules; brain.js runs them).
import { NODE_PLACE, sensorsFor, valueOf } from './sensors.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const dur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

// Target risk: at my current pace, will I reach the shift target (shift plan × OEE target) by shift end?
// row = live row (total, ng, plannedSec, plan {toNow, shift}, idealCycleTime, targets).
export function targetRisk(row) {
  const good = row.total - row.ng;
  const target = Math.ceil((row.plan.shift * (row.targets?.oee?.target ?? 85)) / 100);
  const remainingSec = Math.max(0, (row.plan.shift - row.plan.toNow) * row.idealCycleTime);
  if (!row.plannedSec || row.plannedSec < 1800 || remainingSec < 1200 || good >= target) return null; // too early, too late, or done
  const rate = good / row.plannedSec; // good pieces per planned second so far
  const projected = Math.round(good + rate * remainingSec);
  if (projected >= target) return { atRisk: false, good, target, projected };
  const needed = target - good;
  return {
    atRisk: true, good, target, projected, short: target - projected, needed,
    remainingSec, paceSec: rate ? 1 / rate : null, neededPaceSec: remainingSec / needed,
  };
}

export function riskText(r, idealCycleTime) {
  return (
    `With ${dur(r.remainingSec)} of planned time left, I need ${fmt(r.needed)} more good pieces to reach my target of ${fmt(r.target)}. ` +
    `At my current pace of one good piece every ${r.paceSec ? r.paceSec.toFixed(1) : '—'} seconds I will make about ${fmt(r.projected)}, about ${fmt(r.short)} short. ` +
    `I need one good piece every ${r.neededPaceSec.toFixed(1)} seconds; my ideal cycle is ${idealCycleTime} seconds, so fewer and shorter stops matter now.`
  );
}

// Surprise: did the hour just finished fall below 85 % of what my own recent rate predicted?
// hour / previous = hour buckets ({ plannedSec, total, ng }); previous = the hours before it (any order).
export const SURPRISE = { below: 0.85, minExpected: 20, minHistorySec: 3600 };
export function surpriseCheck(hour, previous) {
  const hist = previous.filter((b) => b.plannedSec > 0);
  const histSec = hist.reduce((a, b) => a + b.plannedSec, 0);
  if (!hour || hour.plannedSec < 1200 || histSec < SURPRISE.minHistorySec) return null;
  const rate = hist.reduce((a, b) => a + b.total - b.ng, 0) / histSec;
  const expected = Math.round(rate * hour.plannedSec);
  const actual = hour.total - hour.ng;
  return { expected, actual, surprise: expected >= SURPRISE.minExpected && actual < expected * SURPRISE.below };
}

// Sensors out of limits for 30 s, said once per 30 min (sooner if a warning becomes an alarm).
// mem = { since: {}, spoke: {} }, kept per press between calls. row = live row (sensorStatus, readings, press fields).
export const ANOMALY = { holdMs: 30e3, repeatMs: 30 * 60e3 };
export function anomalies(row, mem, now) {
  const out = [];
  for (const sensor of sensorsFor(row)) {
    const state = row.sensorStatus?.[sensor.id];
    if (state !== 'warn' && state !== 'alarm') {
      delete mem.since[sensor.id];
      continue;
    }
    mem.since[sensor.id] ??= now;
    const last = mem.spoke[sensor.id];
    if (now - mem.since[sensor.id] < ANOMALY.holdMs) continue;
    if (last && now - last.at < ANOMALY.repeatMs && !(state === 'alarm' && last.state === 'warn')) continue;
    mem.spoke[sensor.id] = { at: now, state };
    out.push({ sensor, state, value: valueOf(row.readings, sensor) });
  }
  return out;
}

const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const surpriseText = (start, s) =>
  `Between ${hm(start)} and ${hm(start + 3600e3)} I expected about ${fmt(s.expected)} good pieces, but I made ${fmt(s.actual)}. What happened? Press the mic and tell me.`;

// A sensor out of its limits, in my own words. sensor = catalog entry (sensors.js), value = reading.
export function anomalyText(m, sensor, value, state) {
  const sev = state === 'alarm' ? 'Please check it now.' : 'Keep an eye on it.';
  if (sensor.node) {
    const nominal = m.ratedTonnage / m.nodes;
    const dev = ((value - nominal) / nominal) * 100;
    return `My tonnage node ${sensor.node} (${NODE_PLACE[sensor.node] ?? ''}) reads ${value.toFixed(1)} tons, ${Math.abs(dev).toFixed(0)} percent ${dev > 0 ? 'above' : 'below'} its ${fmt(nominal)} ton share. That corner of my frame is out of its ${m.nodeTolerancePct} percent tolerance: check the tie rod, gib and die seating there. ${sev}`;
  }
  switch (sensor.id) {
    case 'vibMotor':
    case 'vibGearbox':
      return `My ${sensor.id === 'vibMotor' ? 'main motor' : 'gearbox'} vibration is ${value.toFixed(1)} millimetres per second, above the ${state === 'alarm' ? sensor.alarm : sensor.warn} limit. A bearing or mounting may be wearing. ${sev}`;
    case 'tempMotor':
    case 'tempGearbox':
    case 'tempLube':
      return `My ${{ tempMotor: 'main motor', tempGearbox: 'gearbox', tempLube: 'lubrication line' }[sensor.id]} is ${value.toFixed(0)} degrees, above the ${state === 'alarm' ? sensor.alarm : sensor.warn} degree limit. ${sensor.id === 'tempLube' ? 'Check the oil level and the lube pump.' : 'Check cooling and load.'} ${sev}`;
    case 'acoustic':
      return `The sound of my stroke changed ${value.toFixed(1)} times from normal: a part may be sticking to the die. Check the die and stripper before it jams. ${sev}`;
    case 'ioFaults':
      return `One of my proximity sensors stopped switching; my network I/O module flags it. An engineer can check it remotely on the module's web page. Expect part-sensor misreads until it is fixed.`;
    default:
      return `My ${sensor.short.toLowerCase()} reads ${value} ${sensor.unit}, outside its limit. ${sev}`;
  }
}

export const stopFallback = (start, alarmCode, alarmName) =>
  `I stopped at ${hm(start)}${alarmCode ? ` with alarm ${alarmCode}${alarmName ? `, ${alarmName}` : ''}` : ' without an alarm'}. Please check me and give this stop its reason.`;
