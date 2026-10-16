// Press anatomy: an isometric drawing (anatomy-figure conventions: one 30° camera, four tones, exactly one lit part,
// readouts in the card corners, no labels in the drawing) with a 3D view of the same parts.
// m = live row (frameType, nodes, setup, readings, sensorStatus, status, ratedTonnage, nodeTolerancePct).
// lit = { part, node } to light (else the worst sensor). The readout comes from the same live readings.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Box, Card, Chip, LinearProgress, Stack, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery } from '@mui/material';
import { C, LEVELS } from '../theme.js';
import { num } from '../ui.jsx';
import { sensorsFor, useSensorCatalog, valueOf } from '../sensors.js';
import { NODE_PLACE, TONES, findPart, pressParts, worstPart } from './pressParts.js';

const Press3D = lazy(() => import('./Press3D.jsx'));

const ACCENT = '#F97316';
const COS = Math.cos(Math.PI / 6);
const S = 100; // px per metre
const iso = ([x, y, z]) => [(x - z) * COS * S, ((x + z) * 0.5 - y) * S];

// Four tones from one colour: top lighter, front base, right darker, edge darkest.
function tones(hex) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (f) => {
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f)));
    return `rgb(${ch.join(',')})`;
  };
  return { top: mix(0.28), front: mix(0), right: mix(-0.22), edge: mix(-0.45) };
}

const pts = (list) => list.map((p) => iso(p).map((v) => v.toFixed(1)).join(',')).join(' ');

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
const ring = (axis, c, r, at) =>
  Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return axis === 'x' ? [at, c[1] + r * Math.cos(a), c[2] + r * Math.sin(a)] : [c[0] + r * Math.cos(a), at, c[2] + r * Math.sin(a)];
  });

// Draw one part (dy = vertical offset for moving parts).
function Shape({ p, lit, dy }) {
  const t = tones(lit ? ACCENT : TONES[p.tone]);
  const sw = 1.2;
  if (p.kind === 'box') {
    const [x0, y, z0] = p.pos;
    const [w, h, d] = p.size;
    const [x1, y0, y1, z1] = [x0 + w, y + dy, y + h + dy, z0 + d];
    return (
      <g stroke={t.edge} strokeWidth={sw} strokeLinejoin="round">
        <polygon points={pts([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]])} fill={t.top} />
        <polygon points={pts([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])} fill={t.front} />
        <polygon points={pts([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]])} fill={t.right} />
      </g>
    );
  }
  if (p.kind === 'cylX' || p.kind === 'cylY') {
    const axis = p.kind === 'cylX' ? 'x' : 'y';
    const c = p.center;
    const lo = (axis === 'x' ? c[0] : c[1]) - p.len / 2;
    const hi = lo + p.len;
    const a = ring(axis, c, p.r, lo).map(iso);
    const capPts = ring(axis, c, p.r, hi);
    return (
      <g stroke={t.edge} strokeWidth={sw} strokeLinejoin="round">
        <polygon points={hull([...a, ...capPts.map(iso)]).map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ')} fill={axis === 'x' ? t.front : t.right} />
        <polygon points={pts(capPts)} fill={axis === 'x' ? t.right : t.top} />
      </g>
    );
  }
  // line: ends on dots
  const ends = [p.points[0], p.points.at(-1)].map(iso);
  return (
    <g>
      <polyline points={pts(p.points)} fill="none" stroke={lit ? ACCENT : TONES[p.tone]} strokeWidth={lit ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" />
      {ends.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill={lit ? ACCENT : TONES[p.tone]} />)}
    </g>
  );
}

const center = (p) =>
  p.kind === 'box' ? [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2] : p.kind === 'line' ? p.points[Math.floor(p.points.length / 2)] : p.center;
const depth = (p) => {
  const [x, y, z] = center(p);
  return x + z + y * 0.6;
};
const top = (p) => (p.kind === 'box' ? [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1], p.pos[2] + p.size[2] / 2] : p.kind === 'line' ? p.points.at(-1) : [p.center[0], p.center[1] + (p.r ?? 0), p.center[2]]);

function Drawing({ parts, litPart, running, reduced, onFocus }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!running || reduced) return;
    let raf;
    const tick = (t) => ((raf = requestAnimationFrame(tick)), setPhase(t / 1000));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, reduced]);
  const dy = running && !reduced ? -0.22 * (0.5 + 0.5 * Math.cos(phase * 4)) : 0; // the slide strokes while running
  const sorted = useMemo(() => [...parts].sort((a, b) => depth(a) - depth(b)), [parts]);
  const box = useMemo(() => {
    const all = parts.flatMap((p) =>
      p.kind === 'box'
        ? [[p.pos[0], p.pos[1], p.pos[2]], [p.pos[0] + p.size[0], p.pos[1] + p.size[1], p.pos[2] + p.size[2]], [p.pos[0], p.pos[1] + p.size[1], p.pos[2] + p.size[2]], [p.pos[0] + p.size[0], p.pos[1], p.pos[2]]]
        : p.kind === 'line' ? p.points : [[p.center[0] - 0.7, p.center[1] - 0.7, p.center[2] - 0.7], [p.center[0] + 0.7, p.center[1] + 0.7, p.center[2] + 0.7]],
    ).map(iso);
    const xs = all.map((q) => q[0]);
    const ys = all.map((q) => q[1]);
    return [Math.min(...xs) - 30, Math.min(...ys) - 30, Math.max(...xs) - Math.min(...xs) + 60, Math.max(...ys) - Math.min(...ys) + 60];
  }, [parts]);
  return (
    <svg viewBox={box.join(' ')} width="100%" height="100%" role="img" aria-label="Isometric drawing of the press with its sensors">
      {sorted.map((p) => {
        const sensorPart = !!p.part;
        return (
          <g
            key={p.id}
            tabIndex={sensorPart ? 0 : -1}
            aria-label={sensorPart ? p.name : undefined}
            onMouseEnter={() => sensorPart && onFocus(p.id)}
            onFocus={() => sensorPart && onFocus(p.id)}
            style={{ cursor: sensorPart ? 'pointer' : 'default', outline: 'none' }}
          >
            <Shape p={p} lit={litPart?.id === p.id} dy={p.moves ? dy : 0} />
          </g>
        );
      })}
      {/* the lit part again on top, x-ray style, so a part at the back is never hidden */}
      {litPart && (
        <g opacity={0.92} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,0.8))' }}>
          <Shape p={litPart} lit dy={litPart.moves ? dy : 0} />
        </g>
      )}
      {/* a dot on every part that carries a sensor */}
      {parts.filter((p) => p.part).map((p) => {
        const [x, y] = iso(top(p));
        const lit = litPart?.id === p.id;
        return <circle key={`dot-${p.id}`} cx={x} cy={y - 8} r={lit ? 7 : 5} fill={lit ? ACCENT : C.blue} stroke="#fff" strokeWidth={2} pointerEvents="none" />;
      })}
    </svg>
  );
}

export default function Anatomy({ m, lit, title = 'Press anatomy', number = 1, height = 420 }) {
  const catalog = useSensorCatalog();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [view, setView] = useState('drawing');
  const [hover, setHover] = useState(null);
  const [tour, setTour] = useState(0);
  const parts = useMemo(() => pressParts(m), [m.frameType, m.nodes, m.setup]); // eslint-disable-line react-hooks/exhaustive-deps
  const sensors = sensorsFor(m, catalog);
  const worst = lit ?? worstPart(m, sensors);
  const sensorParts = parts.filter((p) => p.part);

  // idle tour through the sensor parts when nothing is wrong and nobody is pointing
  useEffect(() => {
    if (worst || hover || reduced) return;
    const t = setInterval(() => setTour((i) => i + 1), 2600);
    return () => clearInterval(t);
  }, [worst, hover, reduced]);

  const litPart = hover ? parts.find((p) => p.id === hover) : findPart(parts, worst) ?? sensorParts[tour % Math.max(1, sensorParts.length)];
  const onPart = litPart && sensors.filter((s) => (litPart.part === 'loadCell' ? s.node === litPart.node : s.part === litPart.part));

  return (
    <Card sx={{ position: 'relative', height, p: 0, overflow: 'hidden', bgcolor: '#FBFDFF' }} onMouseLeave={() => setHover(null)}>
      {/* corner: number + title */}
      <Box sx={{ position: 'absolute', top: 12, left: 14, zIndex: 1 }}>
        <Typography variant="overline" component="div" lineHeight={1.2}>FIG. {number}</Typography>
        <Typography fontWeight={800}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">{m.ratedTonnage} t {m.frameType} · {m.setup === 'premium' ? 'Premium' : 'Essential'} sensors</Typography>
      </Box>
      {/* corner: hint + view toggle */}
      <Stack sx={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }} alignItems="flex-end" gap={0.5}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(e, v) => v && setView(v)} aria-label="Anatomy view">
          <ToggleButton value="drawing">Drawing</ToggleButton>
          <ToggleButton value="3d">3D</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">{view === '3d' ? 'Drag to turn · hover a part' : 'Hover or Tab to a dot'}</Typography>
      </Stack>
      <Box sx={{ position: 'absolute', inset: 0, pt: 7, pb: 9 }}>
        {view === 'drawing' ? (
          <Drawing parts={parts} litPart={litPart} running={m.status === 'running'} reduced={reduced} onFocus={setHover} />
        ) : (
          <Suspense fallback={<LinearProgress />}>
            <Press3D parts={parts} litId={litPart?.id} running={m.status === 'running'} reduced={reduced} onHover={setHover} />
          </Suspense>
        )}
      </Box>
      {/* corner: live readout for the lit part (from the same readings) */}
      <Box sx={{ position: 'absolute', left: 14, bottom: 12, right: 150, zIndex: 1 }} aria-live="polite">
        <Typography fontWeight={800} sx={{ color: worst && !hover ? (worst.state === 'alarm' ? LEVELS.below.color : LEVELS.near.color) : C.ink }}>
          {litPart?.name ?? '—'}
        </Typography>
        <Stack direction="row" gap={1.5} flexWrap="wrap">
          {onPart?.length ? (
            onPart.map((s) => (
              <Typography key={s.id} variant="body2">
                {s.short}: <b>{num(valueOf(m.readings, s))} {s.unit}</b>
                {s.node ? ` (nominal ${Math.round(m.ratedTonnage / m.nodes)} t ±${m.nodeTolerancePct}%, ${NODE_PLACE[s.node] ?? ''})` : ''}
                {m.sensorStatus?.[s.id] && m.sensorStatus[s.id] !== 'ok' ? ` · ${m.sensorStatus[s.id] === 'alarm' ? 'ALARM' : 'warning'}` : ''}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">No sensor on this part.</Typography>
          )}
        </Stack>
      </Box>
      {/* corner: legend */}
      <Stack sx={{ position: 'absolute', right: 12, bottom: 12, zIndex: 1 }} gap={0.5} alignItems="flex-end">
        <Chip size="small" label="● sensor" sx={{ bgcolor: '#fff', color: C.blue, border: `1px solid ${C.line}` }} />
        <Chip size="small" label="■ lit part" sx={{ bgcolor: '#fff', color: ACCENT, border: `1px solid ${C.line}` }} />
      </Stack>
    </Card>
  );
}
