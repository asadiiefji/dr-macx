// Shift handover: when a shift ends, each press summarises it (Gemini) into machines/{id}/handovers/{shiftStart}
// and tells the incoming shift through the Machine Soul. The shift start as doc id makes it once per shift.
import { handoverSummary } from './ai.js';
import { currentShift, oee, schedulePlan } from './oee.js';
import { downtimeStats } from './analysis.js';
import { DEFAULT_TARGETS } from './validate.js';

const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
const iso = (t) => new Date(t).toISOString();

export function handoverRoutes(app, { db, live, say, shiftData }) {
  const handovers = (id) => db.collection(`machines/${id}/handovers`);
  const done = new Set(); // `${id}:${shiftStart}` already written or skipped (saves a read a minute)

  async function make(id, shift) {
    const key = `${id}:${shift.start}`;
    done.add(key);
    const ref = handovers(id).doc(String(shift.start));
    if ((await ref.get()).exists) return;
    const mdoc = await db.doc(`machines/${id}`).get();
    const m = mdoc.data();
    const { events, buckets, sum } = await shiftData(id, shift);
    if (!sum.plannedSec) return; // the press did not run this shift
    const k = oee(sum);
    const stats = downtimeStats(events, sum, buckets, shift.start, shift.end);
    const targets = m.targets ?? DEFAULT_TARGETS;
    const plan = schedulePlan(shift, shift.end, live.settings().breaks, sum.plannedStopSec, m.idealCycleTime).shift;
    const said = (await db.collection(`machines/${id}/soul`).where('at', '>=', shift.start).where('at', '<', shift.end).get()).docs.map((d) => d.data());
    const facts = {
      press: { code: m.code, name: m.name, setup: m.setup },
      shift: { name: shift.name, from: iso(shift.start), to: iso(shift.end) },
      nextShift: currentShift(shift.end).name,
      oeePct: { oee: pct(k.oee), availability: pct(k.availability), performance: pct(k.performance), quality: pct(k.quality) },
      targetsPct: targets,
      output: { good: sum.total - sum.ng, nc: sum.ng, total: sum.total, plan },
      downtime: {
        stops: stats.stops, waitingForReason: stats.unconfirmedStops, unplannedMin: stats.unplannedMin, plannedMin: stats.plannedMin, repeatedStops: stats.repeatedStops,
        top: stats.reasons.slice(0, 5).map(({ code, reason, type, count, minutes, repeatedStops }) => ({ code, reason, type, count, minutes, repeatedStops })),
      },
      sensorWarnings: said.filter((x) => x.kind === 'anomaly').map((x) => x.text).slice(0, 8),
      unansweredQuestions: said.filter((x) => x.needsAnswer && !x.answered).map((x) => x.text),
    };
    let out;
    let ai = true;
    try {
      out = await handoverSummary(facts);
    } catch (e) {
      console.error(`handover ${m.code} AI failed:`, e.message);
      ai = false;
      const top = facts.downtime.top[0];
      out = {
        summary: `${shift.name}: OEE ${facts.oeePct.oee}% (target ${targets.oee.target}%), ${facts.output.good} good of ${plan} planned, ${stats.stops} stops${top ? `, mostly ${top.reason} (${top.minutes} min)` : ''}.`,
        highlights: [stats.unconfirmedStops ? `${stats.unconfirmedStops} stops still wait for a reason.` : null, ...facts.sensorWarnings.slice(0, 2)].filter(Boolean),
        advice: [],
      };
      out.say = `Hello ${facts.nextShift}. ${out.summary} ${out.highlights.join(' ')}`;
    }
    const doc = {
      shift: shift.name, start: shift.start, end: shift.end, at: Date.now(), ai,
      ...k, good: facts.output.good, nc: sum.ng, plan, stops: stats.stops, unplannedMin: stats.unplannedMin,
      summary: out.summary, highlights: out.highlights, advice: out.advice, say: out.say,
    };
    await ref.set(doc);
    await say(id, { kind: 'handover', text: out.say, emotion: k.oee * 100 >= targets.oee.target ? 'happy' : 'worried', data: { handover: String(shift.start) } });
  }

  // Every minute: hand over the shift that just ended (also right after a start, for the last shift).
  const busy = new Set();
  setInterval(() => {
    const prev = currentShift(currentShift().start - 1);
    for (const r of live.snapshot().machines) {
      const key = `${r.id}:${prev.start}`;
      if (r.status === 'inactive' || done.has(key) || busy.has(key)) continue;
      busy.add(key);
      make(r.id, prev)
        .catch((e) => (console.error(`handover ${r.code} failed:`, e.message), done.delete(key)))
        .finally(() => busy.delete(key));
    }
  }, 60e3);

  app.get('/api/machines/:id/handovers', async (req, res) => {
    const limit = Math.min(50, Number(req.query.limit) || 10);
    const snap = await handovers(req.params.id).orderBy('start', 'desc').limit(limit).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
