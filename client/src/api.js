import { useCallback, useEffect, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
  return data;
}

// GET a path; refetches when the path changes. path null = skip.
export function useGet(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(0); // server unreachable or erroring (no status, or 5xx)
  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    return api(path)
      .then(
        (d) => (setData(d), setError('')),
        (e) => (setError(e.message), (!e.status || e.status >= 500) && setFailed((n) => n + 1)),
      )
      .finally(() => setLoading(false));
  }, [path]);
  useEffect(() => void reload(), [reload]);
  // Nothing loaded yet because the server is not answering (e.g. still starting while npm run dev fills the
  // history): try again every 3 s instead of leaving the page empty until a reload.
  useEffect(() => {
    if (!failed || data) return undefined;
    const id = setTimeout(reload, 3000);
    return () => clearTimeout(id);
  }, [failed, data, reload]);
  return { data, error, loading, reload };
}

export function useCollection(col) {
  const { data, error, reload } = useGet(`/${col}`);
  return { rows: data ?? [], error, reload };
}

// ponytail: 2 s polling; switch to SSE if many viewers or sub-second updates are needed.
export function useLive() {
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const tick = () => api('/live').then((d) => alive && (setLive(d), setError('')), (e) => alive && setError(e.message));
    tick();
    const t = setInterval(tick, 2000);
    return () => ((alive = false), clearInterval(t));
  }, []);
  return { live, error };
}
