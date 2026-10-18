// When and what the Machine Soul says on its own (pure rules; brain.js runs them).
import { sensorsFor, valueOf } from './sensors.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const dur = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

// Target risk, from the shift forecast the dashboard shows (row.forecast, oee.js shiftForecast).
export function targetRisk(row) {
  const f = row.forecast;
  if (!f || !row.plannedSec || row.plannedSec < 1800 || f.remainingSec < 1200 || f.good >= f.target) return null; // too early, too late, or done
  if (f.projected >= f.target) return { atRisk: false, good: f.good, target: f.target, projected: f.projected };
  const needed = f.target - f.good;
  return { atRisk: true, good: f.good, target: f.target, projected: f.projected, short: f.target - f.projected, needed, best: f.best, reachable: f.reachable, remainingSec: f.remainingSec, paceSec: f.paceSec, neededPaceSec: f.remainingSec / needed };
}

export function riskText(r) {
  if (!r.reachable) return `My target of ${fmt(r.target)} is out of reach; I will make about ${fmt(r.projected)}.`;
  return `I need ${fmt(r.needed)} more good pieces in ${dur(r.remainingSec)}, one every ${r.neededPaceSec.toFixed(1)} seconds.`;
}

// Say it again only when something changed: an hour passed and the shortfall moved by 10 % of the target or more,
// or the target went from reachable to out of reach. last = the data of the last risk message this shift.
export const riskChanged = (r, last) => !last || last.reachable !== r.reachable || Math.abs((last.short ?? 0) - r.short) >= 0.1 * r.target;

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
// The stops logged in that hour, by reason (minutes inside the hour), biggest first: what I propose as the cause.
export function hourCauses(events, start) {
  const end = start + 3600e3;
  const by = new Map();
  for (const e of events) {
    const min = (Math.min(e.end ?? end, end) - Math.max(e.start, start)) / 60e3;
    if (min <= 0) continue;
    const c = by.get(e.reason) ?? by.set(e.reason, { reason: e.reason, count: 0, minutes: 0 }).get(e.reason);
    c.count++;
    c.minutes += min;
  }
  return [...by.values()].map((c) => ({ ...c, minutes: Math.round(c.minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, 3);
}

// I propose what I saw instead of only asking; the operator taps Yes / Partly / No (or says it).
export const ANSWERS = { causes: ['Yes', 'Partly', 'No, something else'], none: ['Slow material feed', 'Quality checks', 'Operator away', 'Something else'] };
export function surpriseText(start, s, causes = []) {
  const head = `I made ${fmt(s.actual)} of about ${fmt(s.expected)} good pieces from ${hm(start)} to ${hm(start + 3600e3)}`;
  return causes.length ? `${head}; was it ${causes[0].reason}?` : `${head}; what happened?`;
}

// A sensor out of its limits, in my own words. sensor = catalog entry (sensors.js), value = reading.
export function anomalyText(m, sensor, value, state) {
  const sev = state === 'alarm' ? 'please check it now.' : 'keep an eye on it.';
  if (sensor.node) {
    const nominal = m.ratedTonnage / m.nodes;
    const dev = ((value - nominal) / nominal) * 100;
    return `My tonnage node ${sensor.node} is ${Math.abs(dev).toFixed(0)} percent ${dev > 0 ? 'above' : 'below'} its share, ${sev}`;
  }
  switch (sensor.id) {
    case 'vibMotor':
    case 'vibGearbox':
      return `My ${sensor.id === 'vibMotor' ? 'motor' : 'gearbox'} is vibrating ${value.toFixed(1)} millimetres per second, ${sev}`;
    case 'tempMotor':
    case 'tempGearbox':
    case 'tempLube':
      return `My ${{ tempMotor: 'motor', tempGearbox: 'gearbox', tempLube: 'lube line' }[sensor.id]} is ${value.toFixed(0)} degrees, ${sev}`;
    case 'acoustic':
      return `A part may be sticking to my die, ${sev}`;
    case 'ioFaults':
      return 'One of my proximity sensors stopped switching, check the I/O module.';
    default:
      return `My ${sensor.short.toLowerCase()} reads ${value} ${sensor.unit}, ${sev}`;
  }
}

export const stopFallback = (start, alarmCode) =>
  `I stopped${alarmCode ? ` on alarm ${alarmCode}` : ''}, please give the stop its reason.`;
