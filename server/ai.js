// Google AI models: Gemma suggests a stop's reason (with the operator's spoken note, any language);
// Gemini analyses a machine's downtime and answers questions about it in a chat.
import { GoogleGenAI } from '@google/genai';

// GOOGLE_GENAI_USE_VERTEXAI=true: both models run on Vertex AI with the service account, billed to the Cloud account.
// Otherwise both use the AI Studio key (Gemini API). Both models are served on Vertex's global endpoint only.
const VERTEX = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true';
export const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Gemma 4 on Vertex is a managed (MaaS) model with its own ID.
export const GEMMA_MODEL = process.env.GEMMA_MODEL || (VERTEX ? 'gemma-4-26b-a4b-it-maas' : 'gemma-4-26b-a4b-it');
const VIA = VERTEX ? `Vertex AI (${VERTEX_LOCATION})` : 'Gemini API';
// GCP_PROJECT wins: local dev points GOOGLE_CLOUD_PROJECT at the Firestore emulator's demo project.
const PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

// Kiosk languages (Machine Soul): code -> name Gemini writes in.
export const LANGUAGES = {
  en: 'English', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu', vi: 'Tiếng Việt', th: 'Thai', fil: 'Filipino',
  ja: 'Japanese', ko: 'Korean', zh: 'Simplified Chinese', hi: 'Hindi',
};

function notConfigured(message) {
  const e = new Error(message);
  e.status = 503;
  return e;
}

// A Google AI error in words the plant team can act on (null = unknown, show a generic retry message).
// Google returns 402 for depleted AI Studio prepay credits; its text also says RESOURCE_EXHAUSTED, so check it first.
export function explain(e) {
  if (e.status === 503) return e.message; // not configured
  const m = String(e.message ?? '');
  if (e.status === 402 || /prepayment credits|billing/i.test(m)) return 'Google AI credits for this project are used up. Top up at https://ai.studio/projects, then try again.';
  if (e.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(m)) return 'Google AI rate limit reached. Wait a minute and try again.';
  if (e.status === 401 || e.status === 403 || /API key/i.test(m)) return 'The Google AI key was rejected. Check GEMINI_API_KEY.';
  if (e.status === 404) return 'This AI model is not available. Check GEMINI_MODEL / GEMMA_MODEL.';
  return null;
}

// Last outcome per model, for the sidebar status. ponytail: per instance, resets on restart.
const health = { gemini: {}, gemma: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Vertex's shared capacity can answer 429 for a moment: retry twice (after 1 s, then 3 s) before failing.
export async function track(name, call, wait = sleep) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await call();
      health[name] = { state: 'ok', at: Date.now() };
      return out;
    } catch (e) {
      if (e.status === 429 && attempt < 2) {
        await wait(1000 * 3 ** attempt);
        continue;
      }
      health[name] = { state: e.status === 503 ? 'off' : 'error', at: Date.now(), message: explain(e) ?? 'The last call failed.' };
      throw e;
    }
  }
}

export function aiStatus() {
  const configured = VERTEX || !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  return {
    gemini: { name: 'Gemini', model: MODEL, via: VIA, configured, ...health.gemini },
    gemma: { name: 'Gemma', model: GEMMA_MODEL, via: VIA, configured, ...health.gemma },
  };
}

// Project and location are passed explicitly: otherwise, with GEMINI_API_KEY also set, the SDK would call Vertex in
// "express mode" with that key, billed to the AI Studio prepay credit instead of the Cloud account.
function client(name) {
  if (VERTEX) return new GoogleGenAI({ vertexai: true, project: PROJECT, location: VERTEX_LOCATION });
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY)
    throw notConfigured(`${name} is not configured. Set GEMINI_API_KEY in .env, or GOOGLE_GENAI_USE_VERTEXAI=true on Cloud Run.`);
  return new GoogleGenAI({ vertexai: false });
}
const gemini = () => client('Gemini');
const gemma = () => client('Gemma');

// First {...} block in a model reply (Gemma may wrap JSON in prose or a code fence).
export function parseJson(text) {
  const m = /\{[\s\S]*\}/.exec(text ?? '');
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

const SYSTEM = `You are a manufacturing reliability engineer reviewing one machine's downtime for the plant team.
Use only the numbers in the input. Quote them (counts, minutes, MTBF, trend, shift splits, NC rates) as evidence.\nNC = non-conformance: a piece with an abnormal result (fields named ng / ngRate hold NC counts and rates).
Never invent alarms, parts or events that are not in the input. If the data is too thin for a conclusion, say so.
"trend" is the change in stop count from the first to the second half of the period (0.5 = +50%).
"weeklyCounts" are stops per 7-day block counted back from the period end, oldest first (only the oldest block may be partial). "hoursSinceLast" vs "mtbfRunHours" hints at what is due next.
Operator comments are field observations; use them when they explain a cause.
Unconfirmed stops carry the reason suggested by their PLC alarm; mention it if many stops are unconfirmed.
"type" planned = scheduled stops that do not count against OEE; focus losses on unplanned downtime.
"repeatedStops" = stops that were the 3rd or later of the same reason within 24 h: a repeated case that needs a permanent fix.
Write short, specific, calm sentences: machine first, then the fact, then what to do.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-3 sentences: the overall downtime picture and the biggest loss.' },
    causes: {
      type: 'array',
      description: 'Why the main downtime reasons happen, biggest loss first (max 4).',
      items: {
        type: 'object',
        properties: { reason: { type: 'string' }, why: { type: 'string' }, evidence: { type: 'string' } },
        required: ['reason', 'why', 'evidence'],
      },
    },
    prevention: {
      type: 'array',
      description: 'Concrete actions to prevent the downtime (max 5).',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          reason: { type: 'string', description: 'Downtime reason this addresses.' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          expectedImpact: { type: 'string' },
        },
        required: ['action', 'reason', 'priority', 'expectedImpact'],
      },
    },
    predictions: {
      type: 'array',
      description: 'What is likely to happen next if nothing changes (max 4).',
      items: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          risk: { type: 'string', enum: ['high', 'medium', 'low'] },
          outlook: { type: 'string', description: 'What to expect and roughly when.' },
          rationale: { type: 'string' },
        },
        required: ['reason', 'risk', 'outlook', 'rationale'],
      },
    },
  },
  required: ['summary', 'causes', 'prevention', 'predictions'],
};

export async function analyze(input) {
  const res = await track('gemini', () => gemini().models.generateContent({
    model: MODEL,
    contents: JSON.stringify(input),
    config: { systemInstruction: SYSTEM, responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0.3 },
  }));
  return { model: MODEL, ...JSON.parse(res.text) };
}

// --- Gemma: suggest one stop's reason; the operator still confirms it ---

const SUGGEST = `You help a machine operator classify one machine stop.
The operator note may be in any language (for example Indonesian, Vietnamese, Thai, Tagalog, Malay, Japanese, Korean, Chinese, Hindi). Translate it to English.
Pick exactly one reason code from "reasons". Weigh, in order: a specific operator note, the PLC alarm and the reason linked to it,
the stop duration, whether the stop touches a scheduled break, and repeats of the same reason in the last 24 h.
Reply with JSON only, no prose, in this shape:
{"translation": "English text of the note, or empty", "language": "language of the note, or empty",
 "reasonCode": "one code from reasons", "confidence": 0.0-1.0, "rationale": "one or two sentences",
 "machineCondition": "one sentence on the machine's current state from the data"}`;

export async function suggestReason(input) {
  const res = await track('gemma', () => gemma().models.generateContent({
    model: GEMMA_MODEL,
    contents: JSON.stringify(input),
    config: { systemInstruction: SUGGEST, temperature: 0.2 },
  }));
  const out = parseJson(res.text);
  if (!out) throw Object.assign(new Error('Gemma did not return a usable answer.'), { status: 502 });
  return out;
}

// --- Gemini chat about one machine, grounded in its data ---

const CHAT = `You are Dr. Macx, the plant team's assistant for one machine. People ask what happened to the machine,
the probable cause, the impact (lost minutes, OEE points, pieces), how to solve it, short-term and long-term actions,
how to stop repeated cases, and what is likely to happen next.
Ground every claim in the machine data given at the start; quote the numbers. Never invent alarms, parts or events.
If the data cannot answer, say what is missing. Planned stops do not count against OEE; losses are unplanned downtime.
"repeatedStops" are stops that were the 3rd or later of the same reason within 24 h.
Call rejected pieces NC (non-conformance), never NG. Answer in the user's language, short (at most about 150 words), plain text: short paragraphs and "- " bullets, no headings, no bold.`;

export async function chat(context, messages) {
  const res = await track('gemini', () => gemini().models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: `Machine data for this conversation (JSON):\n${JSON.stringify(context)}` }] },
      { role: 'model', parts: [{ text: 'Understood. I will answer from this data.' }] },
      ...messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    ],
    config: { systemInstruction: CHAT, temperature: 0.4 },
  }));
  return res.text;
}

// --- Machine Soul: the press speaks for itself, in the kiosk's language ---

const soulVoice = (lang) => `You are the soul of one stamping press, speaking to the operator standing next to it.
Speak in first person ("I", "my node 2", "my motor"), warm and calm, like a colleague. Write in ${LANGUAGES[lang] ?? 'English'}.
Use only the data given; quote real numbers (tonnage per node vs nominal, vibration, temperatures, counts, times).
Never invent sensors the press does not have: an Essential press only knows its part count, motor current and PLC alarm.
"sensorStatus" says ok / warn / alarm per sensor; tonnage nodes are judged against nominal ± tolerance.
"say" is spoken aloud by text-to-speech: 2-4 short sentences, plain text, no lists, no symbols that read badly aloud.`;

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'What I say aloud now: my condition and the most important advice.' },
    findings: {
      type: 'array',
      description: 'What the sensors and history show (max 4).',
      items: { type: 'object', properties: { part: { type: 'string', description: 'Press part, e.g. "tonnage node 2", "main motor", "lube line"' }, finding: { type: 'string' } }, required: ['part', 'finding'] },
    },
    actions: { type: 'array', items: { type: 'string' }, description: 'Concrete next steps for the operator or maintenance (max 4).' },
    part: { type: 'string', description: 'Anatomy part id most involved: motor, gearbox, lubeLine, loadCell, camera, microphone, ioModule, exitChute, controlPanel, or empty.' },
    node: { type: 'integer', description: 'Tonnage node number if one node is involved, else 0.' },
  },
  required: ['say', 'findings', 'actions'],
};

// "Ask Gemini" on the kiosk: read my sensors, recent sensor trend (BigQuery) and stops; tell what is going on.
// focus = an extra instruction for what to talk about (e.g. a stop that just happened).
export async function soulAsk(context, lang, focus) {
  const res = await track('gemini', () => gemini().models.generateContent({
    model: MODEL,
    contents: JSON.stringify(context),
    config: { systemInstruction: focus ? `${soulVoice(lang)}\n${focus}` : soulVoice(lang), responseMimeType: 'application/json', responseJsonSchema: ASK_SCHEMA, temperature: 0.4 },
  }));
  return JSON.parse(res.text);
}

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'My spoken reply to the operator: what I understood and what I think caused it.' },
    summary: { type: 'string', description: 'One-sentence report in English for the history.' },
    likelyCause: { type: 'string' },
    actions: { type: 'array', items: { type: 'string' } },
    part: { type: 'string', description: 'Anatomy part id most involved, or empty.' },
    node: { type: 'integer', description: 'Tonnage node number if one node is involved, else 0.' },
    reasonCode: { type: 'string', description: 'Downtime reason code from "reasons" that fits the latest stop, or empty.' },
  },
  required: ['say', 'summary', 'likelyCause', 'actions'],
};

// "Explain by voice": the operator tells what happened (any language); check it against my data.
export async function soulExplain(context, statement, lang) {
  const res = await track('gemini', () => gemini().models.generateContent({
    model: MODEL,
    contents: JSON.stringify({ ...context, operatorSays: statement }),
    config: {
      systemInstruction: `${soulVoice(lang)}\nThe operator just told you what happened ("operatorSays", may be in any language). Check it against your data, say whether the data agrees, and name the likely cause.`,
      responseMimeType: 'application/json',
      responseJsonSchema: EXPLAIN_SCHEMA,
      temperature: 0.3,
    },
  }));
  return JSON.parse(res.text);
}

// Translate my English messages for a kiosk in another language (kept short, spoken aloud).
export async function translateTexts(texts, lang) {
  if (!texts.length) return [];
  const res = await track('gemini', () => gemini().models.generateContent({
    model: MODEL,
    contents: JSON.stringify(texts),
    config: {
      systemInstruction: `Translate each string of the JSON array into ${LANGUAGES[lang]}. Keep numbers, units and codes. Keep the first-person voice of a machine talking to its operator. Return a JSON array of the same length.`,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'array', items: { type: 'string' } },
      temperature: 0.1,
    },
  }));
  const out = JSON.parse(res.text);
  return out.length === texts.length ? out : texts;
}
