import express from 'express';
import { Firestore } from '@google-cloud/firestore';
import { fileURLToPath } from 'node:url';
import { schemas } from './validate.js';
import { startLive } from './live.js';

const db = new Firestore({ ignoreUndefinedProperties: true });
const live = startLive(db);
const app = express();
app.use(express.json({ limit: '100kb' }));

const list = async (col) => (await db.collection(col).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

app.get('/api/live', (req, res) => res.json(live()));

// --- Skill matrix: one doc per operator × machine, level 0–3 (0 = no doc) ---
app.get('/api/skills', async (req, res) => res.json(await list('skills')));

app.put('/api/skills', async (req, res) => {
  const { operatorId, machineId } = req.body ?? {};
  const level = Number(req.body?.level);
  if (![0, 1, 2, 3].includes(level)) return res.status(400).json({ error: 'Skill level must be 0, 1, 2 or 3.' });
  if (typeof operatorId !== 'string' || typeof machineId !== 'string' || !operatorId || !machineId)
    return res.status(400).json({ error: 'operatorId and machineId are required.' });
  const [op, mc] = await Promise.all([db.doc(`operators/${operatorId}`).get(), db.doc(`machines/${machineId}`).get()]);
  if (!op.exists || !mc.exists) return res.status(404).json({ error: 'Operator or machine not found.' });
  const ref = db.doc(`skills/${operatorId}__${machineId}`);
  await (level ? ref.set({ operatorId, machineId, level }) : ref.delete());
  res.json({ operatorId, machineId, level });
});

// --- Master data CRUD: machines, operators, users ---
app.use('/api/:col', (req, res, next) => (schemas[req.params.col] ? next() : res.status(404).json({ error: 'Not found.' })));

app.get('/api/:col', async (req, res) => res.json(await list(req.params.col)));

async function save(req, res, id) {
  const { col } = req.params;
  const schema = schemas[col];
  const { value, error } = schema.parse(req.body ?? {});
  if (error) return res.status(400).json({ error });
  const ref = id ? db.doc(`${col}/${id}`) : db.collection(col).doc();
  const key = schema.unique;
  // ponytail: unique check is read-then-write; use a transaction if two admins edit at once.
  const dup = await db.collection(col).where(key, '==', value[key]).get();
  if (dup.docs.some((d) => d.id !== ref.id)) return res.status(409).json({ error: `${schema.label} "${value[key]}" already exists.` });
  if (id && !(await ref.get()).exists) return res.status(404).json({ error: 'Not found.' });
  await ref.set({ ...value, updatedAt: Date.now() });
  res.status(id ? 200 : 201).json({ id: ref.id, ...value });
}

app.post('/api/:col', (req, res) => save(req, res));
app.put('/api/:col/:id', (req, res) => save(req, res, req.params.id));

app.delete('/api/:col/:id', async (req, res) => {
  const { col, id } = req.params;
  const batch = db.batch();
  batch.delete(db.doc(`${col}/${id}`));
  const field = { machines: 'machineId', operators: 'operatorId' }[col];
  if (field) (await db.collection('skills').where(field, '==', id).get()).forEach((d) => batch.delete(d.ref));
  await batch.commit();
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// --- React build (production) ---
const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
app.use(express.static(dist));
app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error. Check the server log.' });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Dr. Macx server on :${port}`));
