// PLC-like dummy machine: cumulative counters, stops with alarm codes, NC (non-conformance) pieces.
// Each stop type has its own pattern so the downtime analysis has something real to find.
// reason = the true downtime reason code (used for simulated history; live stops wait for an operator).
export const PROFILES = [
  { code: 101, reason: 'MS-JAM', perHour: 1.2, min: 20, max: 90 }, // material jam: frequent minor stop
  { code: 102, reason: 'MS-SENS', perHour: 0.5, min: 15, max: 60 }, // part sensor misread
  { code: 205, reason: 'CO-DIE', perHour: 1 / 8, min: 600, max: 1200 }, // die change: about once a shift
  { code: 310, reason: 'BD-HYD', perHour: (wear) => 0.02 + 0.3 * wear, min: 480, max: 1800 }, // hydraulic: rises as the pump wears
  { code: 412, reason: 'MT-COIL', perHour: 0.12, min: 300, max: 900, nightFactor: 3 }, // coil shortage: 3× more on nights
  { code: 0, reason: 'QC-INSP', perHour: 0.4, min: 180, max: 420 }, // operator stops for a QC inspection (no PLC alarm)
];

// Simulation modes, switched per machine from the monitoring card.
export const MODES = {
  normal: { stops: 1, longer: 1, slow: [1.05, 1.3], ng: 0.015 },
  better: { stops: 0.25, longer: 0.7, slow: [1.0, 1.04], ng: 0.004 },
  worse: { stops: 5, longer: 1.5, slow: [1.4, 1.8], ng: 0.06 },
};

export const newDummy = () => ({ run: true, total: 0, ng: 0, alarm: 0, reason: null, stopLeft: 0, partial: 0, sinceChange: Infinity, mode: 'normal' });

const stop = (st, alarm, reason, seconds) => Object.assign(st, { run: false, alarm, reason, stopLeft: seconds });

// wear 0..1 drives the hydraulic fault rate; hour 0..23 drives night-shift effects;
// breakIn = seconds until the next planned break starts (Infinity if none soon).
export function dummyStep(st, m, dt, { rnd = Math.random, wear = 1, hour = 12, onBreak = false, breakIn = Infinity } = {}) {
  const mode = MODES[st.mode] ?? MODES.normal;
  if (!onBreak) {
    if (st.run) {
      const night = hour >= 23 || hour < 7;
      const hit = PROFILES.find((p) => {
        const rate = typeof p.perHour === 'function' ? p.perHour(wear) : p.perHour;
        return rnd() < (rate * mode.stops * (night ? p.nightFactor ?? 1 : 1) * dt) / 3600;
      });
      if (hit) {
        stop(st, hit.code, hit.reason, (hit.min + rnd() * (hit.max - hit.min)) * mode.longer);
        if (hit.code === 205) st.sinceChange = 0;
      } else if (breakIn <= 300 && rnd() < 0.003 * dt) {
        // crew stops early for the break and is sometimes back late (the stop pauses during the break)
        stop(st, 0, 'BRK-OP', breakIn + rnd() * 240);
      } else {
        const [lo, hi] = mode.slow;
        st.partial += dt / (m.idealCycleTime * (lo + rnd() * (hi - lo)));
        st.sinceChange += dt;
        const ngRate = st.sinceChange < 600 ? mode.ng * 4 : mode.ng; // more NC in the first 10 min after a die change
        while (st.partial >= 1) {
          st.partial--;
          st.total++;
          if (rnd() < ngRate) st.ng++;
        }
      }
    } else if ((st.stopLeft -= dt) <= 0) {
      Object.assign(st, { run: true, alarm: 0, reason: null });
    }
  }
  // On a planned break the crew is away: machine idle, no alarm, any stop waits.
  const running = st.run && !onBreak;
  return { runStatus: running ? 1 : 0, totalCount: st.total, rejectCount: st.ng, alarmCode: onBreak ? 0 : st.alarm };
}
