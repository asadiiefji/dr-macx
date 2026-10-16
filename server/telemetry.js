// Per-minute sensor summaries: one row per press per minute, streamed to BigQuery (see bq.js).
import { motorState } from './sensors.js';

export const minuteOf = (t) => Math.floor(t / 60e3) * 60e3;

export function newMinute(start, nodes) {
  return {
    start, runSec: 0, idleSec: 0, offSec: 0, breakSec: 0, parts: 0, nc: 0, alarms: new Set(),
    ampsSum: 0, ampsMax: 0, secs: 0, strokes: 0,
    tonSum: Array(nodes).fill(0), tonMax: Array(nodes).fill(0),
    vibMotor: 0, vibGearbox: 0, vibSecs: 0, tempMotor: 0, tempGearbox: 0, tempLube: 0, acousticMax: 0, ioFaults: 0,
  };
}

// One reading of dt seconds. ncDelta = new NC pieces (vision or operator) in this reading.
export function addReading(a, m, r, dt, onBreak, ncDelta) {
  const st = onBreak ? 'break' : motorState(r.motorCurrent, m.motorFla);
  a[{ running: 'runSec', idle: 'idleSec', off: 'offSec', break: 'breakSec' }[st]] += dt;
  a.parts += r.made;
  a.nc += ncDelta;
  if (r.alarm) a.alarms.add(r.alarm);
  a.ampsSum += r.motorCurrent * dt;
  a.ampsMax = Math.max(a.ampsMax, r.motorCurrent);
  a.secs += dt;
  if (r.made > 0) {
    a.strokes += r.made;
    r.tonnage.forEach((v, i) => ((a.tonSum[i] += v * r.made), (a.tonMax[i] = Math.max(a.tonMax[i], v))));
  }
  if (st === 'running') {
    a.vibMotor += r.vibMotor * dt;
    a.vibGearbox += r.vibGearbox * dt;
    a.vibSecs += dt;
  }
  a.tempMotor = Math.max(a.tempMotor, r.tempMotor);
  a.tempGearbox = Math.max(a.tempGearbox, r.tempGearbox);
  a.tempLube = Math.max(a.tempLube, r.tempLube);
  a.acousticMax = Math.max(a.acousticMax, r.acoustic);
  a.ioFaults = Math.max(a.ioFaults, r.ioFaults);
}

const r2 = (v) => Math.round(v * 100) / 100;

// BigQuery row (schema in bq.js). Premium-only columns are null on Essential presses.
export function minuteRow(a, m, mode) {
  const premium = m.setup === 'premium';
  return {
    machine_id: m.id,
    machine_code: m.code,
    setup: m.setup,
    minute: new Date(a.start).toISOString(),
    run_sec: r2(a.runSec),
    idle_sec: r2(a.idleSec),
    off_sec: r2(a.offSec),
    break_sec: r2(a.breakSec),
    parts: a.parts,
    nc: a.nc,
    alarm_codes: [...a.alarms],
    current_avg: a.secs ? r2(a.ampsSum / a.secs) : 0,
    current_max: r2(a.ampsMax),
    tonnage_avg: premium && a.strokes ? a.tonSum.map((v) => r2(v / a.strokes)) : [],
    tonnage_max: premium && a.strokes ? a.tonMax.map(r2) : [],
    vib_motor: premium && a.vibSecs ? r2(a.vibMotor / a.vibSecs) : null,
    vib_gearbox: premium && a.vibSecs ? r2(a.vibGearbox / a.vibSecs) : null,
    temp_motor: premium ? r2(a.tempMotor) : null,
    temp_gearbox: premium ? r2(a.tempGearbox) : null,
    temp_lube: premium ? r2(a.tempLube) : null,
    acoustic_max: premium ? r2(a.acousticMax) : null,
    io_faults: premium ? a.ioFaults : null,
    sim_mode: mode ?? null,
  };
}
