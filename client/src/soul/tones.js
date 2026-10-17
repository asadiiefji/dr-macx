// Short tones before the press speaks, so people on a loud floor can tell what kind of message it is without
// reading it. Synthesised with Web Audio (no sound files): advice = a soft rising chime, a stop or breakdown =
// alarm beeps, a sensor alert or target risk = a two-tone warning, a question = a gentle ping.
let ctx;

function play(notes) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume(); // browsers start audio only after a tap on the page
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, start, len, type = 'sine', vol = 0.2] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + len + 0.05);
    }
  } catch {
    /* no audio on this device: the message is still shown and spoken */
  }
}

// [frequency Hz, start s, length s, wave, volume]
const TONES = {
  advice: [[784, 0, 0.35], [1047, 0.18, 0.5]],
  stop: [[880, 0, 0.14, 'square', 0.1], [880, 0.22, 0.14, 'square', 0.1], [880, 0.44, 0.14, 'square', 0.1], [622, 0.66, 0.32, 'square', 0.1]],
  warning: [[740, 0, 0.2, 'triangle', 0.22], [554, 0.24, 0.32, 'triangle', 0.22]],
  question: [[660, 0, 0.16], [990, 0.2, 0.28]],
};
const KIND_TONE = { advice: 'advice', report: 'advice', handover: 'advice', cycle: 'advice', anomaly: 'warning', risk: 'warning', question: 'question', stop: 'stop' };

// The tone for a kind of message (or 'stop' for a new stop); returns how long it lasts, to start speaking after it.
export function tone(kind) {
  const name = KIND_TONE[kind] ?? kind;
  if (!TONES[name]) return 0;
  play(TONES[name]);
  return Math.max(...TONES[name].map(([, s, l]) => s + l)) * 1000;
}
