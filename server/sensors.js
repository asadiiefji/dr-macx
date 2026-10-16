// Stamping-press sensor catalog. Sensors are wired to the PLC; Kepware carries each one as a tag.
// Essential = the low-cost OEE kit; Premium = everything for maximum OEE optimisation.
// part = where the sensor sits on the press anatomy (client/src/anatomy).

export const SETUPS = ['essential', 'premium'];
export const FRAMES = ['c-frame', 'straight-side'];

export const SENSORS = [
  { id: 'laserEye', setup: 'essential', label: 'Laser eye (photoelectric) at exit chute', short: 'Part count', unit: 'pcs', part: 'laserEye', tag: 'LaserEye.PartCount', feeds: 'Performance' },
  { id: 'motorCurrent', setup: 'essential', label: 'Clip-on current sensor, main drive motor', short: 'Motor current', unit: 'A', part: 'motor', tag: 'Motor.Current', feeds: 'Availability' },
  { id: 'alarm', setup: 'essential', label: 'PLC alarm word', short: 'Alarm code', unit: '', part: 'plc', tag: 'PLC.AlarmCode', feeds: 'Stop reasons' },
  { id: 'tonnage', setup: 'premium', perNode: true, label: 'Tonnage monitor (load cell)', short: 'Tonnage', unit: 't', part: 'loadCell', tag: 'Tonnage.Node', feeds: 'Quality risk, maintenance' },
  { id: 'vibMotor', setup: 'premium', label: 'Vibration, main motor', short: 'Motor vibration', unit: 'mm/s', part: 'motor', tag: 'Vibration.Motor', warn: 4.5, alarm: 7.1 },
  { id: 'vibGearbox', setup: 'premium', label: 'Vibration, main gearbox', short: 'Gearbox vibration', unit: 'mm/s', part: 'gearbox', tag: 'Vibration.Gearbox', warn: 4.5, alarm: 7.1 },
  { id: 'tempMotor', setup: 'premium', label: 'Temperature, main motor', short: 'Motor temp', unit: '°C', part: 'motor', tag: 'Thermal.Motor', warn: 80, alarm: 95 },
  { id: 'tempGearbox', setup: 'premium', label: 'Temperature, main gearbox', short: 'Gearbox temp', unit: '°C', part: 'gearbox', tag: 'Thermal.Gearbox', warn: 70, alarm: 85 },
  { id: 'tempLube', setup: 'premium', label: 'Temperature, lubrication line', short: 'Lube line temp', unit: '°C', part: 'lubeLine', tag: 'Thermal.LubeLine', warn: 60, alarm: 75 },
  { id: 'visionNc', setup: 'premium', label: 'Vision camera at exit line (NC counter)', short: 'Vision NC', unit: 'pcs', part: 'camera', tag: 'Vision.NcCount', feeds: 'Quality' },
  { id: 'acoustic', setup: 'premium', label: 'Acoustic sensor (part sticking to die)', short: 'Stick score', unit: '×', part: 'microphone', tag: 'Acoustic.StickScore', warn: 2.5, alarm: 4 },
  { id: 'ioFaults', setup: 'premium', label: 'Network I/O module (proximity sensor health)', short: 'Proximity faults', unit: '', part: 'ioModule', tag: 'IO.ProximityFaults', warn: 1, alarm: 1 },
];

// Motor states from the clip-on current sensor (share of full-load amps).
export const CURRENT = { offBelowA: 1, runningFromFla: 0.3 };
export const motorState = (amps, fla) => (amps < CURRENT.offBelowA ? 'off' : amps < fla * CURRENT.runningFromFla ? 'idle' : 'running');

// The sensors one press has: its setup's list, with one tonnage channel per node.
export function sensorsFor(m) {
  const list = SENSORS.filter((s) => s.setup === 'essential' || m.setup === 'premium');
  return list.flatMap((s) =>
    s.perNode
      ? Array.from({ length: m.nodes }, (_, i) => ({ ...s, id: `tonnage${i + 1}`, node: i + 1, label: `${s.label}, node ${i + 1}`, short: `Node ${i + 1}`, tag: `${s.tag}${i + 1}` }))
      : [s],
  );
}

// Press fields with defaults, so a machine saved before the sensor model still works.
export function pressDefaults(m) {
  const frameType = FRAMES.includes(m.frameType) ? m.frameType : 'c-frame';
  const ratedTonnage = Number(m.ratedTonnage) || 160;
  return {
    ...m,
    setup: SETUPS.includes(m.setup) ? m.setup : 'essential',
    frameType,
    ratedTonnage,
    nodes: [2, 4].includes(Number(m.nodes)) ? Number(m.nodes) : frameType === 'straight-side' ? 4 : 2,
    nodeTolerancePct: Number(m.nodeTolerancePct) || 5,
    motorFla: Number(m.motorFla) || Math.round(ratedTonnage * 0.15 + 6), // ~30 A for 160 t, ~66 A for 400 t
  };
}

// Reading of one sensor (tonnage nodes are an array).
export const valueOf = (r, sensor) => (r ? (sensor.node ? r.tonnage?.[sensor.node - 1] : r[sensor.id]) : null);

// Only the readings this press's sensors provide (an Essential press has no tonnage, vibration, camera…).
export function ownReadings(m, r) {
  if (!r) return null;
  const ids = new Set(sensorsFor(m).map((s) => (s.node ? 'tonnage' : s.id)));
  return Object.fromEntries(Object.entries(r).filter(([k]) => ids.has(k)));
}

// Where each tonnage node sits, seen from the operator side.
export const NODE_PLACE = { 1: 'left front', 2: 'right front', 3: 'right rear', 4: 'left rear' };

// Nominal load per tonnage node, e.g. 400 t over 4 nodes = 100 t each.
export const nodeNominal = (m) => m.ratedTonnage / m.nodes;

// ok / warn / alarm for one reading. Tonnage nodes are judged against nominal ± tolerance.
export function judge(m, sensor, value) {
  if (value == null) return 'none';
  if (sensor.node) {
    const dev = Math.abs(value - nodeNominal(m)) / nodeNominal(m);
    return dev > (m.nodeTolerancePct / 100) * 1.5 ? 'alarm' : dev > m.nodeTolerancePct / 100 ? 'warn' : 'ok';
  }
  if (sensor.id === 'acoustic') return value >= sensor.alarm ? 'alarm' : value >= sensor.warn ? 'warn' : 'ok';
  if (sensor.warn == null) return 'ok';
  return value >= sensor.alarm ? 'alarm' : value >= sensor.warn ? 'warn' : 'ok';
}

// Readings → today's four OEE tags, so the OEE engine, downtime and history stay unchanged.
// Running = motor current says "running". NC = vision (Premium) or the operator's entries (Essential).
export function toOeeTags(m, r, manualNc) {
  return {
    runStatus: motorState(r.motorCurrent, m.motorFla) === 'running' ? 1 : 0,
    totalCount: r.laserEye,
    rejectCount: m.setup === 'premium' ? r.visionNc : manualNc,
    alarmCode: r.alarm,
  };
}

// Default PLC tag addresses for a press: Channel.Device.<sensor tag>.
export const defaultTags = (m, channel = 'Channel1', device = m.code?.replace(/[^\w]/g, '') || 'Press') =>
  Object.fromEntries(sensorsFor(m).map((s) => [s.id, `${channel}.${device}.${s.tag}`]));
