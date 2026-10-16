// Stamping-press simulator: produces what the sensors would send through the PLC, second by second.
// Stops come from alarm profiles; each fault story also shows up in a sensor before or while it happens,
// so the Machine Soul has something real to detect.
// reason = the true downtime reason code (used for simulated history; live stops wait for an operator).
export const PROFILES = [
  { code: 101, reason: 'MS-JAM', perHour: 1.2, min: 20, max: 90 }, // material jam: frequent minor stop
  { code: 102, reason: 'MS-SENS', perHour: 0.5, min: 15, max: 60 }, // part sensor misread
  { code: 205, reason: 'CO-DIE', perHour: 1 / 8, min: 600, max: 1200 }, // die change: about once a shift
  { code: 310, reason: 'BD-HYD', perHour: (wear) => 0.02 + 0.3 * wear, min: 480, max: 1800 }, // hydraulic: rises as the pump wears
  { code: 412, reason: 'MT-COIL', perHour: 0.12, min: 300, max: 900, nightFactor: 3 }, // coil shortage: 3× more on nights
  { code: 0, reason: 'QC-INSP', perHour: 0.4, min: 180, max: 420 }, // operator stops for a QC inspection (no PLC alarm)
];

// Fault stories (per running hour): what goes wrong, and which sensor tells.
export const FAULTS = {
  looseNode: 0.04, // a tie rod / gib loosens: one tonnage node reads high until the next die change or breakdown repair
  stick: 0.6, // a part starts sticking to the die: acoustic score climbs, jams (101) follow
  ioFault: 0.05, // a proximity sensor fails: the I/O module flags it, sensor misreads (102) follow
};

// Simulation levels, switched per machine (all factors at once, or one OEE factor at a time):
// availability uses stops / longer, performance uses slow, quality uses ng. inject = start a fault story now.
export const MODES = {
  normal: { stops: 1, longer: 1, slow: [1.05, 1.3], ng: 0.015 },
  better: { stops: 0.25, longer: 0.7, slow: [1.0, 1.04], ng: 0.004 },
  worse: { stops: 5, longer: 1.5, slow: [1.4, 1.8], ng: 0.06 },
};
export const FACTORS = ['availability', 'performance', 'quality'];
export const INJECT = ['looseNode', 'stick', 'ioFault', 'overheat', 'breakdown'];
// The level one OEE factor runs at (st.levels overrides the all-factor st.mode).
export const levelOf = (st, factor) => (MODES[st.levels?.[factor]] ? st.levels[factor] : MODES[st.mode] ? st.mode : 'normal');

export const newDummy = () => ({
  run: true, total: 0, ng: 0, alarm: 0, reason: null, stopLeft: 0, partial: 0, sinceChange: Infinity, mode: 'normal',
  node: null, // { node, factor, target }
  stickLeft: 0,
  ioFault: false,
  heat: 0, // extra °C on the lube line (overheat story)
  temp: { motor: 45, gearbox: 40, lube: 38 },
  tonnage: null,
  amps: 0,
});

const stop = (st, alarm, reason, seconds) => Object.assign(st, { run: false, alarm, reason, stopLeft: seconds });
const noise = (rnd, size) => (rnd() - 0.5) * 2 * size;

// Start a fault story (random parts chosen by rnd). Used by the simulator and by the "inject" demo control.
export function injectFault(st, m, kind, rnd = Math.random) {
  if (kind === 'looseNode') st.node = { node: 1 + Math.floor(rnd() * m.nodes), factor: 1, target: 1.09 + rnd() * 0.05 };
  if (kind === 'stick') st.stickLeft = 40 + rnd() * 80;
  if (kind === 'ioFault') st.ioFault = true;
  if (kind === 'overheat') st.heat = 18;
  // a hydraulic breakdown right now (repair also re-seats a loose node)
  if (kind === 'breakdown' && st.run) Object.assign(stop(st, 310, 'BD-HYD', 600 + rnd() * 900), { node: null });
}

// wear 0..1 drives the hydraulic fault rate and vibration; hour 0..23 drives night-shift effects;
// breakIn = seconds until the next planned break starts (Infinity if none soon).
// Returns the sensor readings (see sensors.js).
export function dummyStep(st, m, dt, { rnd = Math.random, wear = 0.8, hour = 12, onBreak = false, breakIn = Infinity } = {}) {
  const A = MODES[levelOf(st, 'availability')];
  const P = MODES[levelOf(st, 'performance')];
  const Q = MODES[levelOf(st, 'quality')];
  let made = 0;
  if (!onBreak) {
    if (st.run) {
      // fault stories start while the press runs
      for (const [kind, perHour] of Object.entries(FAULTS)) {
        const active = kind === 'looseNode' ? st.node : kind === 'stick' ? st.stickLeft > 0 : st.ioFault;
        if (!active && rnd() < (perHour * A.stops * dt) / 3600) injectFault(st, m, kind, rnd);
      }
      const night = hour >= 23 || hour < 7;
      const hit = PROFILES.find((p) => {
        let rate = typeof p.perHour === 'function' ? p.perHour(wear) : p.perHour;
        if (p.code === 101 && st.stickLeft > 0) rate *= 15; // a sticking part ends in a jam
        if (p.code === 102 && st.ioFault) rate *= 6; // a failing proximity sensor misreads
        return rnd() < (rate * A.stops * (night ? p.nightFactor ?? 1 : 1) * dt) / 3600;
      });
      if (hit) {
        stop(st, hit.code, hit.reason, (hit.min + rnd() * (hit.max - hit.min)) * A.longer);
        if (hit.code === 205) Object.assign(st, { sinceChange: 0, node: null }); // die change re-sets the die and gibs
        if (hit.code === 310) st.node = null; // breakdown repair also fixes the loose node
        if (hit.code === 101) st.stickLeft = 0; // jam cleared, die cleaned
        if (hit.code === 102 && rnd() < 0.5) st.ioFault = false; // sensor replaced half the time
      } else if (breakIn <= 300 && rnd() < 0.003 * dt) {
        // crew stops early for the break and is sometimes back late (the stop pauses during the break)
        stop(st, 0, 'BRK-OP', breakIn + rnd() * 240);
      } else {
        const [lo, hi] = P.slow;
        st.partial += dt / (m.idealCycleTime * (lo + rnd() * (hi - lo)));
        st.sinceChange += dt;
        // more NC after a die change, with a loose node (uneven load) or a sticking part
        const ngRate = (st.sinceChange < 600 ? Q.ng * 4 : Q.ng) + (st.node ? 0.02 : 0) + (st.stickLeft > 0 ? 0.03 : 0);
        while (st.partial >= 1) {
          st.partial--;
          st.total++;
          made++;
          if (rnd() < ngRate) st.ng++;
        }
        if (st.stickLeft > 0) st.stickLeft -= dt;
        if (st.node && st.node.factor < st.node.target) st.node.factor = Math.min(st.node.target, st.node.factor + 0.002 * dt); // works loose over ~1 min
      }
    } else if ((st.stopLeft -= dt) <= 0) {
      Object.assign(st, { run: true, alarm: 0, reason: null });
    }
  }
  const running = st.run && !onBreak;

  // Motor current: stroking ≈ 55–75 % of full load; idle while stopped; off on breaks and during a die change.
  const fla = m.motorFla;
  const motorOff = onBreak || st.alarm === 205;
  st.amps = running ? fla * (0.64 + noise(rnd, 0.08)) : motorOff ? 0.2 * rnd() : fla * (0.14 + noise(rnd, 0.02));

  // Tonnage: each stroke's peak per node (nominal = rated ÷ nodes), the loose node reads high.
  if (made > 0) {
    const nominal = m.ratedTonnage / m.nodes;
    st.tonnage = Array.from({ length: m.nodes }, (_, i) => {
      const f = st.node?.node === i + 1 ? st.node.factor : 1;
      return Math.round(nominal * f * (1 + noise(rnd, 0.015)) * 10) / 10;
    });
  }

  // Temperatures settle toward a target (warmer when running, with wear, and in the overheat story).
  const settle = (key, target) => (st.temp[key] += ((target - st.temp[key]) * dt) / 600);
  settle('motor', running ? 62 + 8 * wear : 38);
  settle('gearbox', running ? 52 + 10 * wear : 36);
  settle('lube', (running ? 44 + 8 * wear : 34) + st.heat);
  if (st.heat > 0) st.heat = Math.max(0, st.heat - dt / 1800); // cools down over ~9 h unless fixed

  return {
    laserEye: st.total,
    motorCurrent: Math.max(0, Math.round(st.amps * 10) / 10),
    alarm: onBreak ? 0 : st.alarm,
    tonnage: st.tonnage ?? Array(m.nodes).fill(0),
    vibMotor: running ? Math.round((1.4 + 1.6 * wear + noise(rnd, 0.25)) * 100) / 100 : 0.2,
    vibGearbox: running ? Math.round((1.8 + 2.6 * wear + (st.node ? 1.2 : 0) + noise(rnd, 0.3)) * 100) / 100 : 0.2,
    tempMotor: Math.round(st.temp.motor * 10) / 10,
    tempGearbox: Math.round(st.temp.gearbox * 10) / 10,
    tempLube: Math.round(st.temp.lube * 10) / 10,
    visionNc: st.ng,
    acoustic: Math.round((running ? (st.stickLeft > 0 ? 2.2 + 2.5 * (1 - st.stickLeft / 120) : 1) + noise(rnd, 0.15) : 0) * 100) / 100,
    ioFaults: st.ioFault ? 1 : 0,
    made, // pieces this step (for per-minute telemetry)
  };
}
