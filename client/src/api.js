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

export function useCollection(col) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const reload = useCallback(
    () => api(`/${col}`).then((r) => (setRows(r), setError('')), (e) => setError(e.message)),
    [col],
  );
  useEffect(() => void reload(), [reload]);
  return { rows, error, reload };
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
