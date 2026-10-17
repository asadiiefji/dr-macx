// Shift handover: when a shift ends, each press summarises it (Gemini) into machines/{id}/handovers/{shiftStart}
// and tells the incoming shift through the Machine Soul. The shift start as doc id makes it once per shift.
import { handoverSummary } from './ai.js';
import { currentShift, oee, schedulePlan, shiftForecast } from './oee.js';
import { downtimeStats } from './analysis.js';
import { DEFAULT_TARGETS } from './validate.js';

const pct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

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
    const { events: raw, buckets, sum } = await shiftData(id, shift);
    if (!sum.plannedSec) return; // the press did not run this shift
    // only the minutes inside this shift count (a stop still open, or running over the shift end, is cut)
    const events = raw.map((e) => ({ ...e, minutes: Math.max(0, (Math.min(e.end ?? shift.end, shift.end) - Math.max(e.start, shift.start)) / 60e3) }));
    const k = oee(sum);
    const stats = downtimeStats(events, sum, buckets, shift.start, shift.end);
    const targets = m.targets ?? DEFAULT_TARGETS;
    const plan = schedulePlan(shift, shift.end, live.settings().breaks, sum.plannedStopSec, m.idealCycleTime).shift;
    const f = shiftForecast({ good: sum.total - sum.ng, plannedSec: sum.plannedSec, plan: { toNow: plan, shift: plan }, idealCycleTime: m.idealCycleTime, oeeTarget: targets.oee.target });
    const said = (await db.collection(`machines/${id}/soul`).where('at', '>=', shift.start).where('at', '<', shift.end).get()).docs.map((d) => d.data());
    const nextShift = currentShift(shift.end).name;
    const top = stats.reasons.find((r) => r.type !== 'planned');
    const warnings = said.filter((x) => x.kind === 'anomaly');
    const unanswered = said.filter((x) => x.needsAnswer && !x.answered).length;

    // The numbers are written here, from the same data as the history page; Gemini only adds advice (no numbers).
    const summary =
      `${shift.name}: OEE ${pct(k.oee)}% (target ${targets.oee.target}%). ${fmt(f.good)} good pieces of the ${fmt(f.target)} target ` +
      `(${fmt(plan)} planned at the ideal cycle). ${stats.stops} stops, ${Math.round(stats.unplannedMin)} min unplanned` +
      (top ? `; most time lost to ${top.reason} (${top.count}×, ${Math.round(top.minutes)} min).` : '.');
    const highlights = [
      stats.unconfirmedStops ? `${stats.unconfirmedStops} stops still wait for a reason.` : null,
      warnings.length ? `${warnings.length} sensor warnings, the last: ${warnings.sort((a, b) => b.at - a.at)[0].text}` : null,
      unanswered ? `${unanswered} of my questions are still unanswered.` : null,
    ].filter(Boolean);
    let advice = [];
    let ai = true;
    try {
      advice = (await handoverSummary({
        press: { code: m.code, setup: m.setup }, shift: shift.name, nextShift, summary, highlights,
        topLosses: stats.reasons.slice(0, 3).map(({ reason, type, count, minutes }) => ({ reason, type, count, minutes: Math.round(minutes) })),
      })).advice ?? [];
    } catch (e) {
      console.error(`handover ${m.code} AI failed:`, e.message);
      ai = false;
    }
    const out = { summary, highlights, advice, say: [`Hello ${nextShift}. Here is how the last shift went.`, summary, ...highlights.slice(0, 1), advice[0]].filter(Boolean).join(' ') };
    const doc = {
      shift: shift.name, start: shift.start, end: shift.end, at: Date.now(), ai,
      ...k, good: f.good, nc: sum.ng, plan, target: f.target, stops: stats.stops, unplannedMin: Math.round(stats.unplannedMin),
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
