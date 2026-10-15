// Google AI models: Gemma suggests a stop's reason (with the operator's spoken note, any language);
// Gemini analyses a machine's downtime and answers questions about it in a chat.
import { GoogleGenAI } from '@google/genai';

export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const GEMMA_MODEL = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';

function notConfigured(message) {
  const e = new Error(message);
  e.status = 503;
  return e;
}

// Gemini: Vertex AI when GOOGLE_GENAI_USE_VERTEXAI=true (Cloud Run service account), else the API key.
function gemini() {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY && process.env.GOOGLE_GENAI_USE_VERTEXAI !== 'true')
    throw notConfigured('Gemini is not configured. Set GEMINI_API_KEY in .env, or GOOGLE_GENAI_USE_VERTEXAI=true on Cloud Run.');
  return new GoogleGenAI({});
}

// Gemma is served by the Gemini API (AI Studio key), so it always uses the key.
function gemma() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw notConfigured('Gemma needs GEMINI_API_KEY (Google AI Studio key) in .env or as a Cloud Run secret.');
  return new GoogleGenAI({ apiKey, vertexai: false });
}

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
  const res = await gemini().models.generateContent({
    model: MODEL,
    contents: JSON.stringify(input),
    config: { systemInstruction: SYSTEM, responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0.3 },
  });
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
  const res = await gemma().models.generateContent({
    model: GEMMA_MODEL,
    contents: JSON.stringify(input),
    config: { systemInstruction: SUGGEST, temperature: 0.2 },
  });
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
  const res = await gemini().models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: `Machine data for this conversation (JSON):\n${JSON.stringify(context)}` }] },
      { role: 'model', parts: [{ text: 'Understood. I will answer from this data.' }] },
      ...messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    ],
    config: { systemInstruction: CHAT, temperature: 0.4 },
  });
  return res.text;
}
