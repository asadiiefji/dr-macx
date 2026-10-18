// The Machine Soul: a kiosk next to each press where the press speaks for itself.
// Messages live in machines/{id}/soul: { at, kind, text, lang, emotion, data, i18n, needsAnswer, answered }.
import { soulAsk, soulExplain, soulOptions, soulChat, translateTexts, explain, LANGUAGES } from './ai.js';
import { speak } from './tts.js';
import { hourlyTrend } from './bq.js';
import { nodeNominal, pressDefaults } from './sensors.js';
import { badId } from './validate.js';

export const langOf = (l) => (LANGUAGES[l] ? l : 'en');
const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);

export function soulRoutes(app, { db, live, list, resolve, eventsSince, repeatWindowMs }) {
  const messages = (id) => db.collection(`machines/${id}/soul`);

  // The press says something (stored for the kiosk history; the kiosk speaks new ones aloud).
  async function say(id, msg) {
    const doc = { at: Date.now(), lang: 'en', emotion: 'calm', needsAnswer: false, ...msg };
    const ref = await messages(id).add(doc);
    return { id: ref.id, ...doc };
  }

  // Everything the press knows about itself right now, for Gemini.
  async function context(id) {
    const snap = live.snapshot();
    const row = snap.machines.find((m) => m.id === id);
    const doc = await db.doc(`machines/${id}`).get();
    if (!doc.exists) return null;
    const m = pressDefaults({ id, ...doc.data() });
    const now = Date.now();
    const [pendingRaw, recentRaw, trend, said, reasons] = await Promise.all([
      Promise.resolve(live.pending(id)),
      eventsSince(db.doc(`machines/${id}`), now - repeatWindowMs),
      hourlyTrend(id, 24).catch((e) => (console.error('bigquery trend failed:', e.message), null)),
      messages(id).orderBy('at', 'desc').limit(5).get(),
      list('reasons'),
    ]);
    const recent = await resolve(recentRaw);
    const byReason = {};
    for (const e of recent) {
      const r = (byReason[e.reason] ??= { reason: e.reason, type: e.type, stops: 0, minutes: 0 });
      r.stops++;
      r.minutes = Math.round((r.minutes + e.minutes) * 10) / 10;
    }
    const waiting = (await resolve(pendingRaw)).slice(0, 5);
    return {
      press: {
        code: m.code, name: m.name, setup: m.setup, frameType: m.frameType, ratedTonnage: m.ratedTonnage,
        nodes: m.nodes, nominalPerNodeT: nodeNominal(m), nodeTolerancePct: m.nodeTolerancePct, idealCycleTimeSec: m.idealCycleTime,
      },
      shift: { name: snap.shift.name, minutesLeft: Math.round((snap.shift.end - now) / 60e3) },
      now: row && {
        status: row.status, motor: row.motor, sensors: row.readings, sensorStatus: row.sensorStatus,
        oeePct: pct(row.oee), availabilityPct: pct(row.availability), performancePct: pct(row.performance), qualityPct: pct(row.quality),
        targetsPct: row.targets, good: row.total - row.ng, total: row.total, nc: row.ng,
        // the same shift numbers the kiosk shows: quote these, never other totals
        shiftForecast: row.forecast && {
          goodSoFar: row.forecast.good, dueByNow: row.forecast.toNow, gapToPlan: row.forecast.gap, schedulePlan: row.forecast.plan,
          target: row.forecast.target, projectedEndOfShift: row.forecast.projected, bestStillPossible: row.forecast.best, targetReachable: row.forecast.reachable,
        },
      },
      openItems: {
        stopsWaitingThisShift: pendingRaw.filter((e) => e.start >= snap.shift.start).length,
        stopsWaitingFromEarlierShifts: pendingRaw.filter((e) => e.start < snap.shift.start).length,
        note: 'Talk about this shift. Do not call the shift smooth while stops wait for a reason or the target is short.',
      },
      waitingForReason: waiting.map((e) => ({ at: new Date(e.start).toISOString(), minutes: Math.round(e.minutes * 10) / 10, alarmCode: e.alarmCode, suggested: e.reason, repeatedIn24h: e.repeatCount })),
      stopsLast24h: Object.values(byReason).sort((a, b) => b.minutes - a.minutes),
      sensorTrendLast24h: trend ?? 'not available (BigQuery off)',
      recentlySaid: said.docs.map((d) => d.data().text),
      reasons: reasons.map((r) => ({ code: r.code, name: r.name, category: r.category, type: r.type })),
    };
  }

  const fail = (res, what) => (e) => {
    console.error(`soul ${what} failed:`, e.message);
    res.status(e.status === 503 ? 503 : 502).json({ error: explain(e) ?? `I could not ${what} just now. Try again.` });
  };

  // Kiosk login: the employee number must be active and able to run this press (skill 2+).
  app.post('/api/soul/verify', async (req, res) => {
    const { machineId } = req.body ?? {};
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (badId(machineId) || !code) return res.status(400).json({ error: 'Pick a machine and enter your employee number.' });
    const machine = await db.doc(`machines/${machineId}`).get();
    if (!machine.exists || machine.data().active === false) return res.status(404).json({ error: 'This machine is not active in Dr. Macx.' });
    const ops = await db.collection('operators').where('code', '==', code).get();
    const op = ops.docs[0];
    if (!op || op.data().active === false) return res.status(403).json({ error: `Employee number ${code} is not an active operator.` });
    const skill = await db.doc(`skills/${op.id}__${machineId}`).get();
    if ((skill.data()?.level ?? 0) < 2) return res.status(403).json({ error: `${op.data().name} is not yet cleared to run ${machine.data().code} (needs skill level 2 "Can run").` });
    res.json({ operator: { id: op.id, code: op.data().code, name: op.data().name }, machine: { id: machine.id, code: machine.data().code, name: machine.data().name } });
  });

  // What the press has said, newest first, in the kiosk language (translated once, then cached on the message).
  const translatePause = new Map(); // lang -> no translation attempt before this time (after a failure)
  app.get('/api/machines/:id/soul', async (req, res) => {
    const lang = langOf(req.query.lang);
    const limit = Math.min(200, Number(req.query.limit) || 40);
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    // optional time range (history popup): messages in [from, to)
    let q = messages(req.params.id);
    if (Number.isFinite(from) && Number.isFinite(to)) q = q.where('at', '>=', from).where('at', '<', to);
    const snap = await q.orderBy('at', 'desc').limit(limit).get();
    const docs = snap.docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }));
    const missing = docs.filter((d) => d.lang !== lang && !d.i18n?.[lang]);
    if (missing.length && Date.now() >= (translatePause.get(lang) ?? 0)) {
      try {
        const out = await translateTexts(missing.map((d) => d.text), lang);
        await Promise.all(missing.map((d, i) => ((d.i18n = { ...d.i18n, [lang]: out[i] }), d.ref.update({ [`i18n.${lang}`]: out[i] }))));
      } catch (e) {
        console.error('soul translation failed:', e.message); // fall back to the original language
        translatePause.set(lang, Date.now() + 60e3); // and let Gemini rest a minute: kiosks poll every few seconds
      }
    }
    res.json(docs.map(({ ref, i18n, ...d }) => ({ ...d, text: d.lang === lang ? d.text : i18n?.[lang] ?? d.text })));
  });

  // "Ask Gemini": the press reads its sensors, its sensor trend and stops, and says what is going on.
  app.post('/api/machines/:id/soul/ask', async (req, res) => {
    const lang = langOf(req.body?.lang);
    const ctx = await context(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Machine not found.' });
    try {
      const out = await soulAsk(ctx, lang);
      const emotion = Object.values(ctx.now?.sensorStatus ?? {}).includes('alarm') ? 'worried' : 'calm';
      res.json(await say(req.params.id, { kind: 'advice', text: out.say, lang, emotion, data: { findings: out.findings, actions: out.actions, part: out.part || null, node: out.node || null } }));
    } catch (e) {
      fail(res, 'read my sensors')(e);
    }
  });

  // "Explain by voice": the operator tells what happened; the press checks it against its data and replies.
  app.post('/api/machines/:id/soul/explain', async (req, res) => {
    const lang = langOf(req.body?.lang);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
    const operatorId = typeof req.body?.operatorId === 'string' ? req.body.operatorId.slice(0, 64) : null;
    const replyTo = typeof req.body?.replyTo === 'string' ? req.body.replyTo.slice(0, 64) : null;
    if (!text) return res.status(400).json({ error: 'Say or type what happened first.' });
    const ctx = await context(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Machine not found.' });
    try {
      const out = await soulExplain(ctx, text, lang);
      const operatorMsg = await say(req.params.id, { kind: 'operator', text, lang, operatorId, emotion: 'listening', data: { replyTo } });
      const reply = await say(req.params.id, {
        kind: 'report', text: out.say, lang, emotion: 'calm', operatorId,
        data: { summary: out.summary, likelyCause: out.likelyCause, actions: out.actions, part: out.part || null, node: out.node || null, reasonCode: out.reasonCode || null, replyTo },
      });
      if (replyTo) await messages(req.params.id).doc(replyTo).update({ answered: true, answeredBy: operatorId }).catch(() => {});
      res.json({ operator: operatorMsg, reply });
    } catch (e) {
      fail(res, 'understand that')(e);
    }
  });

  // Kiosk user-interface labels in the kiosk language (Gemini, cached in memory per language and text).
  // ponytail: in-memory cache, refilled after a restart (the kiosk also keeps its own copy).
  const uiCache = new Map();
  app.post('/api/translate', async (req, res) => {
    const lang = langOf(req.body?.lang);
    const texts = Array.isArray(req.body?.texts) ? req.body.texts.filter((x) => typeof x === 'string' && x.length <= 600).slice(0, 300) : [];
    if (lang === 'en' || !texts.length) return res.json(Object.fromEntries(texts.map((x) => [x, x])));
    const key = (x) => `${lang}\u0000${x}`;
    const missing = [...new Set(texts.filter((x) => !uiCache.has(key(x))))];
    try {
      for (let i = 0; i < missing.length; i += 80) {
        const part = missing.slice(i, i + 80);
        const out = await translateTexts(part, lang, 'ui');
        // a translation that lost a {placeholder} is unusable: keep the English
        const kept = (x, y) => y && (x.match(/\{\w+\}/g) ?? []).every((p) => y.includes(p));
        part.forEach((x, j) => uiCache.set(key(x), kept(x, out[j]) ? out[j] : x));
      }
      if (uiCache.size > 20000) uiCache.clear();
      res.json(Object.fromEntries(texts.map((x) => [x, uiCache.get(key(x)) ?? x])));
    } catch (e) {
      fail(res, 'translate the screen')(e);
    }
  });

  // Tap options for "Explain by voice or text": what Gemini thinks most likely happened (cached 2 min per press).
  const optionCache = new Map();
  app.post('/api/machines/:id/soul/options', async (req, res) => {
    const lang = langOf(req.body?.lang);
    const key = `${req.params.id}:${lang}`;
    const hit = optionCache.get(key);
    if (hit && Date.now() - hit.at < 120e3) return res.json({ options: hit.options });
    const ctx = await context(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Machine not found.' });
    try {
      const options = await soulOptions(ctx, lang);
      optionCache.set(key, { at: Date.now(), options });
      res.json({ options });
    } catch (e) {
      fail(res, 'suggest answers')(e);
    }
  });

  // The kiosk chat with the press (Gemini, grounded in the same context as "Ask Dr. Macx").
  app.post('/api/machines/:id/soul/chat', async (req, res) => {
    const lang = langOf(req.body?.lang);
    const msgs = req.body?.messages;
    const ok = Array.isArray(msgs) && msgs.length && msgs.length <= 30 && msgs.at(-1).role === 'user' &&
      msgs.every((m) => ['user', 'model'].includes(m?.role) && typeof m.text === 'string' && m.text.trim() && m.text.length <= 2000);
    if (!ok) return res.status(400).json({ error: 'Send up to 30 messages, the last one from you.' });
    const ctx = await context(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Machine not found.' });
    try {
      res.json({ text: await soulChat(ctx, msgs, lang) });
    } catch (e) {
      fail(res, 'answer')(e);
    }
  });

  // The press's voice (Google Cloud Text-to-Speech), MP3.
  app.post('/api/tts', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 800) return res.status(400).json({ error: 'Text must be 1–800 characters.' });
    try {
      const audio = await speak(text, langOf(req.body?.lang));
      res.set('Content-Type', 'audio/mpeg').send(audio);
    } catch (e) {
      console.error('tts failed:', e.message);
      res.status(502).json({ error: 'The voice is not available right now; the text is still shown.' });
    }
  });

  return { say, context };
}
