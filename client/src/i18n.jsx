// The kiosk's language for every label on the Machine Soul screen. Labels are English in the code; t(text)
// returns the translation (Gemini via POST /api/translate, asked in batches on first use, then cached per language
// in this browser) or the English until it arrives. Outside the kiosk there is no provider: English as written.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { api } from './api.js';

const I18n = createContext(null);
const KEY = (lang) => `drmacx.i18n.${lang}`;
const read = (lang) => {
  try {
    return JSON.parse(localStorage.getItem(KEY(lang))) ?? {};
  } catch {
    return {};
  }
};

export function I18nProvider({ lang = 'en', children }) {
  const [dict, setDict] = useState(() => read(lang));
  const queue = useRef(new Set()); // asked for, not yet sent
  const asked = useRef(new Set()); // sent (or failed): not asked again in this language
  const timer = useRef(null);
  useEffect(() => {
    setDict(read(lang));
    queue.current.clear();
    asked.current.clear();
  }, [lang]);

  const flush = useRef(null);
  flush.current = () => {
    timer.current = null;
    const texts = [...queue.current];
    queue.current.clear();
    if (!texts.length) return;
    texts.forEach((x) => asked.current.add(x));
    api('/translate', { method: 'POST', body: { lang, texts } }).then(
      (out) =>
        setDict((d) => {
          const next = { ...d, ...out };
          try {
            localStorage.setItem(KEY(lang), JSON.stringify(next));
          } catch {
            /* storage full or blocked: keep it for this visit only */
          }
          return next;
        }),
      () => {}, // offline or AI busy: the English stays
    );
  };

  const t = useCallback(
    (text) => {
      if (lang === 'en' || typeof text !== 'string' || !text.trim()) return text;
      if (dict[text]) return dict[text];
      if (!asked.current.has(text) && !queue.current.has(text)) {
        queue.current.add(text);
        timer.current ??= setTimeout(() => flush.current(), 200);
      }
      return text;
    },
    [lang, dict],
  );
  const value = useMemo(() => ({ t, lang }), [t, lang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

const same = (x) => x;
export const useT = () => useContext(I18n)?.t ?? same;
export const useLang = () => useContext(I18n)?.lang ?? 'en';

// An OEE term in the kiosk language with the English beside it, smaller: "Performa | Performance".
export function Dual({ en }) {
  const t = useT();
  const local = t(en);
  if (local === en) return en;
  return (
    <>
      {local}
      <Box component="span" sx={{ fontSize: '0.78em', fontWeight: 500, color: 'text.secondary', ml: 0.5 }}>| {en}</Box>
    </>
  );
}
