// The Machine Soul's voice: speaks queued sentences one by one with Google Cloud Text-to-Speech (POST /api/tts),
// falling back to the browser's own voice if that is unavailable. talking = true while a sentence plays.
import { useCallback, useEffect, useRef, useState } from 'react';

// Kiosk language -> BCP-47 tag (browser voice and speech recognition).
export const BCP = { en: 'en-US', id: 'id-ID', ms: 'ms-MY', vi: 'vi-VN', th: 'th-TH', fil: 'fil-PH', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', hi: 'hi-IN' };

async function playTts(text, lang, onStart) {
  const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
  if (!res.ok) throw new Error('tts unavailable');
  const url = URL.createObjectURL(await res.blob());
  const audio = new Audio(url);
  try {
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = reject;
      audio.play().then(() => onStart(audio), reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function playBrowser(text, lang, onStart) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BCP[lang] ?? 'en-US';
    u.onstart = () => onStart(null);
    u.onend = u.onerror = resolve;
    window.speechSynthesis.speak(u);
  });
}

export function useVoice(lang, enabled) {
  const [talking, setTalking] = useState(false);
  const queue = useRef([]);
  const busy = useRef(false);
  const current = useRef(null);
  const settings = useRef({ lang, enabled });
  settings.current = { lang, enabled };

  const next = useCallback(async () => {
    if (busy.current || !queue.current.length) return;
    busy.current = true;
    const text = queue.current.shift();
    const started = (audio) => ((current.current = audio), setTalking(true));
    try {
      await playTts(text, settings.current.lang, started);
    } catch {
      await playBrowser(text, settings.current.lang, started);
    }
    current.current = null;
    setTalking(false);
    busy.current = false;
    next();
  }, []);

  const say = useCallback(
    (text) => {
      if (!settings.current.enabled || !text) return;
      queue.current.push(text);
      next();
    },
    [next],
  );

  const stop = useCallback(() => {
    queue.current = [];
    current.current?.pause();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    current.current = null;
    busy.current = false;
    setTalking(false);
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  return { say, stop, talking };
}
