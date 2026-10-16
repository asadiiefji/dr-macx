// Google Cloud Text-to-Speech for the Machine Soul's voice. Returns MP3 audio; small in-memory cache.
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

const PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
// Kiosk language -> TTS language code (Google picks its default voice for the language).
const VOICE = { en: 'en-US', id: 'id-ID', ms: 'ms-MY', vi: 'vi-VN', th: 'th-TH', fil: 'fil-PH', ja: 'ja-JP', ko: 'ko-KR', zh: 'cmn-CN', hi: 'hi-IN' };

let client;
const cache = new Map(); // `${lang}|${text}` -> Buffer; ponytail: unbounded beyond the cap below, LRU if it grows
const CAP = 300;

export async function speak(text, lang) {
  const key = `${lang}|${text}`;
  if (cache.has(key)) return cache.get(key);
  client ??= new TextToSpeechClient({ projectId: PROJECT });
  const [res] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: VOICE[lang] ?? 'en-US', ssmlGender: 'FEMALE' },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 1.02 },
  });
  const audio = Buffer.from(res.audioContent);
  if (cache.size >= CAP) cache.delete(cache.keys().next().value);
  cache.set(key, audio);
  return audio;
}

export const TTS_LANGS = Object.keys(VOICE);
