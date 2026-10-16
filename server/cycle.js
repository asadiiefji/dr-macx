// Self-correcting ideal cycle time: the press's best sustained stroke time over the last 3 shifts.
// When it is more than 5 % off the master data the press suggests it (and says so); a supervisor approves.
// Kept on the machine as cycleSuggestion { from, to, samples, source, at, status: pending|approved|rejected }.
import { bqEnabled, query } from './bq.js';

export const CYCLE = { offBy: 0.05, windowMs: 24 * 3600e3, rejectedForMs: 7 * 24 * 3600e3, everyMs: 24 * 3600e3 };

// samples = [{ runSec, parts }] of sampleSec each. Stable = the motor ran ≥ 90 % of the sample and parts came out.
// Best = mean seconds per part of the fastest 10 % of stable samples.
export function bestCycleTime(samples, sampleSec, minSamples) {
  const stable = samples.filter((s) => s.parts > 0 && s.runSec >= 0.9 * sampleSec).map((s) => s.runSec / s.parts).sort((a, b) => a - b);
  if (stable.length < minSamples) return null;
  const fast = stable.slice(0, Math.ceil(stable.length / 10));
  return { seconds: Math.round((fast.reduce((a, b) => a + b, 0) / fast.length) * 10) / 10, samples: stable.length };
}

// A new suggestion, or null (close enough, one already waiting, or rejected less than 7 days ago).
export function suggestCycle(m, best, now) {
  const prev = m.cycleSuggestion;
  if (!best || prev?.status === 'pending' || (prev?.status === 'rejected' && now - prev.at < CYCLE.rejectedForMs)) return null;
  if (Math.abs(best.seconds - m.idealCycleTime) / m.idealCycleTime <= CYCLE.offBy) return null;
  return { from: m.idealCycleTime, to: best.seconds, samples: best.samples, at: now, status: 'pending' };
}

export const cycleText = (s) =>
  `Over the last three shifts my best steady stroke was ${s.to} seconds per part, but my master data says ${s.from} seconds. ` +
  (s.to > s.from
    ? 'So my performance looks better on paper than I can really run. '
    : 'I can run faster than my master data says, so my performance is shown above what it really is. ') +
  'A supervisor can approve the new ideal cycle time on the Machines page.';

export function cycleRoutes(app, { db, live, say }) {
  // Minute rows from BigQuery; without BigQuery, the hour buckets (coarser, needs fewer samples).
  async function learn(id) {
    const ref = db.doc(`machines/${id}`);
    const doc = await ref.get();
    if (!doc.exists) return null;
    const m = { id, ...doc.data() };
    const now = Date.now();
    const from = now - CYCLE.windowMs;
    const best = bqEnabled
      ? bestCycleTime(await query('SELECT run_sec AS runSec, parts FROM `T` WHERE machine_id = @id AND minute >= TIMESTAMP_MILLIS(@from)', { id, from }), 60, 60)
      : bestCycleTime((await ref.collection('hours').where('start', '>=', from).get()).docs.map((d) => ({ runSec: d.data().runSec, parts: d.data().total })), 3600, 6);
    const suggestion = suggestCycle(m, best, now);
    if (suggestion) {
      suggestion.source = bqEnabled ? 'sensor minutes (BigQuery)' : 'hour buckets';
      await ref.update({ cycleSuggestion: suggestion });
      await say(id, { kind: 'cycle', text: cycleText(suggestion), emotion: 'calm', data: suggestion });
    }
    return { best, current: m.idealCycleTime, suggestion, pending: suggestion ? null : m.cycleSuggestion?.status === 'pending' ? m.cycleSuggestion : null };
  }

  // On demand ("Check now" on the Machines page).
  app.post('/api/machines/:id/cycle-time/learn', async (req, res) => {
    try {
      const out = await learn(req.params.id);
      out ? res.json(out) : res.status(404).json({ error: 'Machine not found.' });
    } catch (e) {
      console.error('cycle learn failed:', e.message);
      res.status(502).json({ error: 'Could not read the stroke history just now. Try again.' });
    }
  });

  // Supervisor decision. ponytail: no login yet, so anyone on the Machines page can approve.
  app.post('/api/machines/:id/cycle-time', async (req, res) => {
    const approve = req.body?.approve;
    if (typeof approve !== 'boolean') return res.status(400).json({ error: 'Approve or reject.' });
    const ref = db.doc(`machines/${req.params.id}`);
    const doc = await ref.get();
    const s = doc.data()?.cycleSuggestion;
    if (s?.status !== 'pending') return res.status(409).json({ error: 'There is no cycle time suggestion waiting.' });
    const decided = { ...s, status: approve ? 'approved' : 'rejected', at: Date.now() };
    await ref.update(approve ? { idealCycleTime: s.to, cycleSuggestion: decided } : { cycleSuggestion: decided });
    res.json(decided);
  });

  // Daily, and once shortly after start.
  const all = () => live.snapshot().machines.filter((r) => r.status !== 'inactive').forEach((r) => learn(r.id).catch((e) => console.error(`cycle learn ${r.code} failed:`, e.message)));
  setTimeout(all, 120e3);
  setInterval(all, CYCLE.everyMs);
}
