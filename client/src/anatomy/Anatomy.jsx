// Press anatomy: an isometric drawing (anatomy-figure conventions: one 30° camera, four tones, exactly one lit part,
// readouts in the card corners, no labels in the drawing) with a 3D view of the same parts.
// m = live row (frameType, nodes, setup, readings, sensorStatus, status, ratedTonnage, nodeTolerancePct).
// lit = { part, node } to light (else the worst sensor). The readout comes from the same live readings.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, Chip, LinearProgress, ListItemText, Menu, MenuItem, Stack, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery } from '@mui/material';
import ListIcon from '@mui/icons-material/SensorsRounded';
import AlertIcon from '@mui/icons-material/ErrorRounded';
import { C, LEVELS } from '../theme.js';
import { num } from '../ui.jsx';
import { useT } from '../i18n.jsx';
import { sensorsFor, useSensorCatalog, valueOf } from '../sensors.js';
import { TONES, findPart, pressParts, worstPart } from './pressParts.js';

const Press3D = lazy(() => import('./Press3D.jsx'));

const ACCENT = '#F97316'; // the part you hover or select
const FAULT = '#DC2626'; // the sensor that raised the problem: stays red while you look at other parts
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
function Shape({ p, color, dy }) {
  const t = tones(color ?? TONES[p.tone]);
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
      <polyline points={pts(p.points)} fill="none" stroke={color ?? TONES[p.tone]} strokeWidth={color ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" />
      {ends.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill={color ?? TONES[p.tone]} />)}
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

function Drawing({ parts, litPart, faultPart, running, reduced, onFocus, onPick }) {
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
    <svg viewBox={box.join(' ')} width="100%" height="100%" role="img" aria-label="Isometric drawing of the machine with its sensors">
      {sorted.map((p) => {
        const sensorPart = !!p.part;
        return (
          <g
            key={p.id}
            onMouseEnter={() => sensorPart && onFocus(p.id)}
            onClick={() => sensorPart && onPick(p.id)}
            style={{ cursor: sensorPart ? 'pointer' : 'default' }}
          >
            <Shape p={p} color={colorOf(p, litPart, faultPart)} dy={p.moves ? dy : 0} />
          </g>
        );
      })}
      {/* the problem part and the selected part again on top, x-ray style, so a part at the back is never hidden */}
      {faultPart && (
        <g opacity={0.92} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 6px rgba(220,38,38,0.8))' }}>
          <Shape p={faultPart} color={FAULT} dy={faultPart.moves ? dy : 0} />
        </g>
      )}
      {litPart && litPart.id !== faultPart?.id && (
        <g opacity={0.92} pointerEvents="none" style={{ filter: 'drop-shadow(0 0 6px rgba(249,115,22,0.8))' }}>
          <Shape p={litPart} color={ACCENT} dy={litPart.moves ? dy : 0} />
        </g>
      )}
      {/* a dot on every part that carries a sensor, with a wide invisible ring so it is easy to hover, click or Tab to */}
      {parts.filter((p) => p.part).map((p) => {
        const [x, y] = iso(top(p));
        const lit = litPart?.id === p.id;
        const color = colorOf(p, litPart, faultPart) ?? C.blue;
        return (
          <g
            key={`dot-${p.id}`} role="button" tabIndex={0} aria-label={p.name} aria-pressed={lit}
            onMouseEnter={() => onFocus(p.id)} onFocus={() => onFocus(p.id)} onClick={() => onPick(p.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(p.id))}
            style={{ cursor: 'pointer', outline: 'none' }}
          >
            <circle cx={x} cy={y - 8} r={18} fill="transparent" />
            <circle cx={x} cy={y - 8} r={color === C.blue ? 6 : 8} fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
}

const FRAME = { 'straight-side': 'Straight-side', 'c-frame': 'C-frame' };
// red for the problem part (always), orange for the part being looked at, else the part's own tone
const colorOf = (p, litPart, faultPart) => (p.id === faultPart?.id ? FAULT : p.id === litPart?.id ? ACCENT : null);

// lit = a part to point at (e.g. "View part"); fault = the sensor that raised the problem (red, stays while you
// hover other parts; defaults to a sensor in alarm). height = the drawing's height: the text below adds to it.
// overview = the event popup's look: no figure number, no sensor list or readout; a callout names the suspected area
// and the colour key sits beside the drawing.
export default function Anatomy({ m, lit, fault, title = 'Machine anatomy', number = 1, height = 320, overview }) {
  const t = useT();
  const catalog = useSensorCatalog();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [view, setView] = useState('drawing');
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null); // a part chosen from the list or by a click: stays lit
  const [menu, setMenu] = useState(null);
  const [tour, setTour] = useState(0);
  const parts = useMemo(() => pressParts(m), [m.frameType, m.nodes, m.setup]); // eslint-disable-line react-hooks/exhaustive-deps
  const sensors = sensorsFor(m, catalog);
  const live = worstPart(m, sensors);
  const worst = lit ?? fault ?? live;
  const faultRef = fault ?? (live?.state === 'alarm' ? live : null);
  const sensorParts = parts.filter((p) => p.part);

  useEffect(() => setPicked(null), [lit?.part, lit?.node]); // a new event to show: back to what it points at

  // idle tour through the sensor parts when nothing is wrong and nobody is pointing
  useEffect(() => {
    if (worst || hover || picked || reduced) return;
    const t = setInterval(() => setTour((i) => i + 1), 2600);
    return () => clearInterval(t);
  }, [worst, hover, picked, reduced]);

  const chosen = hover ?? picked;
  const faultPart = findPart(parts, faultRef);
  const litPart = chosen ? parts.find((p) => p.id === chosen) : findPart(parts, worst) ?? sensorParts[tour % Math.max(1, sensorParts.length)];
  const sensorsOn = (p) => sensors.filter((s) => (p.part === 'loadCell' ? s.node === p.node : s.part === p.part));
  const stateOf = (p) => sensorsOn(p).map((s) => m.sensorStatus?.[s.id]).sort((a, b) => ['alarm', 'warn'].indexOf(b) - ['alarm', 'warn'].indexOf(a))[0];
  const onPart = litPart && sensorsOn(litPart);

  const alarmColor = litPart && litPart.id === faultPart?.id ? FAULT : worst?.state === 'warn' && !chosen ? LEVELS.near.color : C.ink;
  // Header, drawing and readout are stacked (no text over the drawing), so every label stays readable.
  return (
    <Card sx={{ p: 0, overflow: 'hidden', bgcolor: '#FBFDFF', display: 'flex', flexDirection: 'column', borderRadius: '12px', flex: 'none' }} onMouseLeave={() => setHover(null)}>
      <Stack direction="row" alignItems="flex-start" gap={1} sx={{ px: 1.75, pt: 1.25, pb: 0.5 }}>
        <Box flex={1} minWidth={0}>
          {!overview && <Typography variant="overline" component="div" lineHeight={1.2}>FIG. {number}</Typography>}
          <Typography fontWeight={800} noWrap fontSize={overview ? 17 : undefined}>{title}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">{m.ratedTonnage} t {t(FRAME[m.frameType] ?? m.frameType)} · {t(m.setup === 'premium' ? 'Premium sensors' : 'Essential sensors')}</Typography>
        </Box>
        <Stack alignItems="flex-end" gap={0.75} flex="none">
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(e, v) => v && setView(v)} aria-label={t('Anatomy view')} sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1.25 } }}>
            <ToggleButton value="drawing">{t('Drawing')}</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>
          {!overview && (
            <Button size="small" variant="outlined" startIcon={<ListIcon />} onClick={(e) => setMenu(e.currentTarget)} aria-haspopup="menu" sx={{ minHeight: 28, py: 0, bgcolor: '#fff', borderRadius: '8px' }}>
              {t('Sensors')} ({sensorParts.length})
            </Button>
          )}
        </Stack>
      </Stack>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} slotProps={{ paper: { sx: { maxHeight: 360 } } }}>
        {sensorParts.map((p) => {
          const st = stateOf(p);
          return (
            <MenuItem key={p.id} selected={litPart?.id === p.id} onClick={() => (setPicked(p.id), setMenu(null))} dense>
              <ListItemText primary={t(p.name)} secondary={sensorsOn(p).map((s) => `${t(s.short)}: ${num(valueOf(m.readings, s))} ${s.unit}`).join(' · ') || t('No reading')} />
              {st && st !== 'ok' && <Chip size="small" label={t(st === 'alarm' ? 'Alarm' : 'Warning')} sx={{ ml: 1, bgcolor: st === 'alarm' ? LEVELS.below.bg : LEVELS.near.bg, color: st === 'alarm' ? LEVELS.below.color : LEVELS.near.color }} />}
            </MenuItem>
          );
        })}
        {picked && <MenuItem onClick={() => (setPicked(null), setMenu(null))} dense sx={{ color: C.blue, fontWeight: 700 }}>{t('Back to the live problem part')}</MenuItem>}
      </Menu>
      <Box sx={{ height, flex: 'none', display: 'flex', minWidth: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {view === 'drawing' ? (
            <Drawing parts={parts} litPart={litPart} faultPart={faultPart} running={m.status === 'running'} reduced={reduced} onFocus={setHover} onPick={setPicked} />
          ) : (
            <Suspense fallback={<LinearProgress />}>
              <Press3D parts={parts} litId={litPart?.id} faultId={faultPart?.id} running={m.status === 'running'} reduced={reduced} onHover={setHover} onPick={setPicked} />
            </Suspense>
          )}
          {overview && faultPart && (
            <Stack direction="row" gap={1} alignItems="center" sx={{ position: 'absolute', top: 8, right: 8, px: 1.25, py: 0.75, bgcolor: '#FFFFFF', border: `1.5px solid ${FAULT}`, borderRadius: '8px', boxShadow: '0 4px 12px rgba(15,23,42,0.12)', maxWidth: '60%', pointerEvents: 'none' }}>
              <AlertIcon sx={{ color: FAULT, fontSize: 22, flex: 'none' }} />
              <Box minWidth={0}>
                <Typography fontWeight={700} fontSize={13} sx={{ color: FAULT }} noWrap>{t('Suspected area')}</Typography>
                <Typography fontSize={13} noWrap>{t(faultPart.name)}</Typography>
              </Box>
            </Stack>
          )}
        </Box>
        {overview && (
          <Stack justifyContent="center" gap={1.25} sx={{ width: 150, flex: 'none', pr: 1.5, display: { xs: 'none', sm: 'flex' } }}>
            {[[FAULT, 'Suspected area'], [C.blue, 'Sensor point'], [ACCENT, 'Selected part']].map(([color, label]) => (
              <Stack key={label} direction="row" alignItems="center" gap={1}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, flex: 'none' }} />
                <Typography fontSize={13} color="text.secondary">{t(label)}</Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
      {/* readout of the highlighted part, from the same live readings, below the drawing */}
      <Box sx={{ display: overview ? 'none' : 'block', px: 1.75, py: 1, borderTop: `1px solid ${C.line}`, bgcolor: '#FFFFFF' }} aria-live="polite">
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography fontWeight={800} noWrap flex={1} minWidth={0} sx={{ color: alarmColor }}>{litPart ? t(litPart.name) : '—'}</Typography>
        </Stack>
        {/* legend: what each colour means */}
        <Stack direction="row" columnGap={1.5} rowGap={0.25} flexWrap="wrap" mt={0.25} mb={0.5}>
          <Typography variant="caption" sx={{ color: C.blue, fontWeight: 700 }}>● {t('Sensor point')}</Typography>
          {faultPart && <Typography variant="caption" sx={{ color: FAULT, fontWeight: 700 }}>■ {t('Sensor that raised the problem')}</Typography>}
          <Typography variant="caption" sx={{ color: ACCENT, fontWeight: 700 }}>■ {t('Selected part')}</Typography>
        </Stack>
        <Stack direction="row" columnGap={1.5} rowGap={0.25} flexWrap="wrap">
          {onPart?.length ? (
            onPart.map((s) => (
              <Typography key={s.id} variant="body2" sx={{ fontSize: 13 }}>
                {t(s.short)}: <b>{num(valueOf(m.readings, s))} {s.unit}</b>
                {s.node ? ` (${t('nominal')} ${Math.round(m.ratedTonnage / m.nodes)} t ±${m.nodeTolerancePct}%)` : ''}
                {m.sensorStatus?.[s.id] && m.sensorStatus[s.id] !== 'ok' ? ` · ${t(m.sensorStatus[s.id] === 'alarm' ? 'Alarm' : 'Warning').toUpperCase()}` : ''}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>{t('No sensor on this part.')}</Typography>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">{t(view === '3d' ? 'Drag to turn · click a part' : 'Hover or click a dot')}</Typography>
      </Box>
    </Card>
  );
}
