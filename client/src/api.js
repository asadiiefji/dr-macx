import { useCallback, useEffect, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// GET a path; refetches when the path changes. path null = skip.
export function useGet(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    return api(path)
      .then((d) => (setData(d), setError('')), (e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);
  useEffect(() => void reload(), [reload]);
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
