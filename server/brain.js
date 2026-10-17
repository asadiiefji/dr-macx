// The Machine Soul speaks on its own: every 10 s it looks at each press and says something on events
// (sensor out of limits, shift target at risk, unplanned stop, an hour that fell short). Stored in English;
// the kiosk gets each message translated into its language.
import { soulAsk } from './ai.js';
import { currentShift, hourStart } from './oee.js';
import { pressDefaults, stopSensor } from './sensors.js';
import { targetRisk, riskText, riskChanged, surpriseCheck, surpriseText, hourCauses, ANSWERS, anomalies, anomalyText, stopFallback, ANOMALY } from './soulRules.js';

const STOP_AFTER_MS = 60e3; // a stop is talked about once it lasts a minute
const RISK_EVERY_MS = 3600e3;

// ponytail: throttles are in memory (one Cloud Run instance); a restart may repeat a warning once.
export function startBrain({ db, live, say, context, resolve }) {
  const mem = new Map(); // id -> { since, spoke, riskAt, stops:Set, hour }
  const log = (what) => (e) => console.error(`soul ${what} failed:`, e.message);

  async function stopTalk(row, stop) {
    const [event] = await resolve(live.pending(row.id).filter((e) => e.id === stop.id));
    if (event?.type === 'planned') return;
    // what my sensors read 60, 30 and 5 s before I stopped
    const trail = live.trail(row.id);
    const before = Object.fromEntries([60, 30, 5].map((sec) => [`${sec}sBefore`, trail.findLast((t) => t.at <= stop.start - sec * 1e3) ?? null]));
    // the sensor that found the stop is what the anatomy lights (deterministic; Gemini's part is only advice)
    const found = stopSensor(pressDefaults(row), stop.alarmCode, [before['5sBefore'], before['30sBefore']]);
    const data = { stopId: stop.id, alarmCode: stop.alarmCode, sensorsBeforeStop: before, sensor: found?.id ?? null, part: found?.part ?? null, node: found?.node ?? null };
    let text = stopFallback(stop.start, stop.alarmCode, event?.reason);
    let extra = {};
    try {
      const ctx = await context(row.id);
      const out = await soulAsk(
        { ...ctx, justStopped: { at: new Date(stop.start).toISOString(), alarmCode: stop.alarmCode, alarmMeans: event?.reason, sensorsBeforeStop: before } },
        'en',
        'I have just stopped ("justStopped"). Say that I stopped and the most probable cause, using what my sensors read before the stop and my recent stops; ask the operator to give the stop its reason.',
      );
      text = out.say;
      extra = { findings: out.findings, actions: out.actions, aiPart: out.part || null };
    } catch (e) {
      log('stop analysis')(e);
    }
    await say(row.id, { kind: 'stop', text, emotion: 'shocked', data: { ...data, ...extra } });
  }

  // What I said lately (stored, so a restart does not make me repeat myself).
  async function said(id, kind, withinMs) {
    const snap = await db.collection(`machines/${id}/soul`).where('at', '>=', Date.now() - withinMs).get();
    return snap.docs.map((d) => d.data()).filter((m) => m.kind === kind).sort((a, b) => b.at - a.at);
  }

  async function surprise(row, hour) {
    const snap = await db.collection(`machines/${row.id}/hours`).where('start', '>=', hour - 3 * 3600e3).where('start', '<=', hour).get();
    const buckets = snap.docs.map((d) => d.data());
    const s = surpriseCheck(buckets.find((b) => b.start === hour), buckets.filter((b) => b.start < hour));
    if (!s?.surprise) return;
    if ((await said(row.id, 'question', 3 * 3600e3)).some((m) => m.data?.hour === hour)) return; // asked already
    // propose the stops I logged that hour as the cause
    const raw = (await db.collection(`machines/${row.id}/downtime`).where('start', '>=', hour - 2 * 3600e3).where('start', '<', hour + 3600e3).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const causes = hourCauses(await resolve(raw), hour);
    await say(row.id, {
      kind: 'question', text: surpriseText(hour, s, causes), emotion: 'worried', needsAnswer: true,
      data: { expected: s.expected, actual: s.actual, hour, causes, answers: causes.length ? ANSWERS.causes : ANSWERS.none },
    });
  }

  // Shift target: hourly at most, and only when the outlook changed since I last said it this shift.
  async function risk(row, r, st) {
    st.riskAt = Date.now();
    const last = (await said(row.id, 'risk', Date.now() - currentShift().start))[0];
    if (last && (Date.now() - last.at < RISK_EVERY_MS || !riskChanged(r, last.data))) return;
    await say(row.id, { kind: 'risk', text: riskText(r, row.idealCycleTime), emotion: r.reachable ? 'worried' : 'sad', data: r });
  }

  // Advice on a schedule (Settings › Dr. Macx Live, default hourly; 0 = off): what I would tell the operator now.
  async function advice(row, everyMs) {
    if ((await said(row.id, 'advice', everyMs)).length) return; // given recently (also by the Ask button)
    const ctx = await context(row.id);
    const out = await soulAsk(ctx, 'en');
    const emotion = Object.values(ctx.now?.sensorStatus ?? {}).includes('alarm') ? 'worried' : 'calm';
    await say(row.id, { kind: 'advice', text: out.say, emotion, data: { findings: out.findings, actions: out.actions, part: out.part || null, node: out.node || null, auto: true } });
  }

  // A sensor out of limits: not again within 30 min unless it got worse (also across restarts).
  async function anomaly(row, m, a) {
    const recent = (await said(row.id, 'anomaly', ANOMALY.repeatMs)).find((x) => x.data?.sensor === a.sensor.id);
    if (recent && !(a.state === 'alarm' && recent.data?.state === 'warn')) return;
    await say(row.id, { kind: 'anomaly', text: anomalyText(m, a.sensor, a.value, a.state), emotion: a.state === 'alarm' ? 'alarmed' : 'worried', data: { sensor: a.sensor.id, value: a.value, state: a.state, part: a.sensor.part, node: a.sensor.node ?? null } });
  }

  function tick() {
    const now = Date.now();
    for (const row of live.snapshot().machines) {
      if (!row.readings) continue; // inactive, disconnected or still loading
      const m = pressDefaults(row);
      const st = mem.get(row.id) ?? mem.set(row.id, { since: {}, spoke: {}, riskAt: 0, stops: new Set(), hour: hourStart(now) }).get(row.id);

      for (const a of anomalies(m, st, now)) anomaly(row, m, a).catch(log('anomaly'));

      const stop = row.openStop;
      if (stop && now - stop.start >= STOP_AFTER_MS && !st.stops.has(stop.id)) {
        st.stops.add(stop.id);
        stopTalk(row, stop).catch(log('stop'));
      }

      if (row.status !== 'break' && now - st.riskAt >= RISK_EVERY_MS) {
        const r = targetRisk(row);
        if (r?.atRisk) risk(row, r, st).catch(log('risk'));
      }

      const everyMs = (live.settings().adviceEveryMin ?? 60) * 60e3;
      if (everyMs && row.status !== 'break' && now - (st.adviceCheck ?? 0) >= 60e3) {
        st.adviceCheck = now; // look at most once a minute
        advice(row, everyMs).catch(log('advice'));
      }

      // hourly: the hour that just ended, once its bucket is written (flush runs every minute)
      const h = hourStart(now);
      if (h !== st.hour && now - h >= 90e3) {
        const done = st.hour;
        st.hour = h;
        surprise(row, done).catch(log('surprise'));
      }
    }
  }
  setInterval(tick, 10e3);
  return { tick };
}
