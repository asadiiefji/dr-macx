import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/CheckCircleOutlined';
import NearIcon from '@mui/icons-material/ReportProblemOutlined';
import BelowIcon from '@mui/icons-material/ErrorOutlined';
import { MONO, STATUS, SKILLS, C, CATEGORIES, LEVELS, level } from './theme.js';
import { useT } from './i18n.jsx';
import { TourButton } from './Tour.jsx';

export const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
export const num = (v) => (v == null ? '—' : v.toLocaleString());

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// The D with a pulse that draws the M (Dr. Macx). Icon = the D in a rounded square; DX = the D beside an X.
const D_PATH = 'M14 10H64A46 46 0 0 1 110 56V64A46 46 0 0 1 64 110H14A4 4 0 0 1 10 106V14A4 4 0 0 1 14 10Z';
const PULSE = 'M10 66H28L40 38L53 84L66 38L78 66H110';

export function LogoIcon({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect width="120" height="120" rx="26" fill={C.blue} />
      <g transform="translate(23 23) scale(0.62)">
        <path d={D_PATH} fill="#FFFFFF" />
        <path d={PULSE} fill="none" stroke={C.blue} strokeWidth="10" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function LogoMark({ height = 44 }) {
  return (
    <svg height={height} viewBox="10 10 204 100" role="img" aria-label="Dr. Macx">
      <path d={D_PATH} fill={C.blue} />
      <path d={PULSE} fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinejoin="round" />
      <polygon points="122,10 146,10 214,110 190,110" fill={C.blue} />
      <polygon points="190,10 214,10 146,110 122,110" fill={C.blue} />
    </svg>
  );
}

export function Logo({ size = 30 }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25}>
      <LogoIcon size={size} />
      <Typography component="span" sx={{ fontSize: 19, letterSpacing: '-0.01em', color: C.ink }}>
        <b style={{ fontWeight: 800 }}>Dr.</b> <span style={{ fontWeight: 600, color: C.blue }}>Macx</span>
      </Typography>
    </Stack>
  );
}

// tour = the id of this page's guided tour (Tour.jsx): adds a "Tutorial" button at the top right.
export function PageHeader({ overline, title, tour, children }) {
  return (
    <Stack direction="row" flexWrap="wrap" justifyContent="space-between" alignItems="flex-end" gap={2} mb={3} data-tour="page-header">
      <Box>
        <Typography variant="overline" component="div">{overline}</Typography>
        <Typography variant="h4" component="h1">{title}</Typography>
      </Box>
      <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" data-tour="page-actions">
        {children}
        {tour && <TourButton id={tour} />}
      </Stack>
    </Stack>
  );
}

export function StatusChip({ status }) {
  const t = useT();
  const s = STATUS[status] ?? STATUS.disconnected;
  return (
    <Chip
      size="small"
      label={t(s.label)}
      icon={<Box component="span" sx={{ width: 10, height: 10, flex: 'none', ...s.dot }} />}
      sx={{ bgcolor: s.bg, color: s.fg, fontWeight: 600, pl: 0.75, '& .MuiChip-icon': { ml: 0, mr: 0 } }}
    />
  );
}

export function SkillChip({ level }) {
  const s = SKILLS[level] ?? SKILLS[0];
  return (
    <Chip size="small" label={`${s.level} · ${s.label}`} sx={{ bgcolor: s.bg, color: s.fg, border: `1px solid ${C.line}`, fontWeight: 600 }} />
  );
}

const LEVEL_ICON = { good: CheckIcon, near: NearIcon, below: BelowIcon };

// Green / yellow / red judgement against a target; never color alone (icon + label).
export function LevelChip({ value, target, size = 'small', short }) {
  const k = level(value, target);
  if (!k) return null;
  const L = LEVELS[k];
  const Icon = LEVEL_ICON[k];
  return (
    <Chip
      size={size}
      icon={<Icon sx={{ fontSize: 16, color: `${L.color} !important` }} />}
      label={short ? undefined : L.label}
      aria-label={L.label}
      sx={{ bgcolor: L.bg, color: L.color, fontWeight: 700, ...(short && { '& .MuiChip-label': { display: 'none' }, '& .MuiChip-icon': { mx: 0.5 } }) }}
    />
  );
}

// value 0..1; the bar takes the level color, the tick marks the target.
export function FactorBar({ label, value, target }) {
  const k = level(value, target);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Stack direction="row" alignItems="center" gap={0.75}>
          <LevelChip value={value} target={target} short />
          <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 48, textAlign: 'right' }}>{pct(value)}</Typography>
        </Stack>
      </Stack>
      <Box sx={{ position: 'relative', mt: 0.5 }}>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, (value ?? 0) * 100)}
          aria-label={`${label} ${pct(value)}${target ? `, target ${target.target}%` : ''}`}
          sx={{ height: 8, bgcolor: '#E2E8F0', '& .MuiLinearProgress-bar': { bgcolor: k ? LEVELS[k].bar : C.blue, borderRadius: 4 } }}
        />
        {target && <Box aria-hidden sx={{ position: 'absolute', top: -2, bottom: -2, left: `${target.target}%`, width: 2, bgcolor: C.ink, borderRadius: 1 }} />}
      </Box>
    </Box>
  );
}

export const Mono = (props) => <Box component="span" sx={{ fontFamily: MONO }} {...props} />;

export const categoryColor = (name) => CATEGORIES.find((c) => c.name === name)?.color ?? CATEGORIES.at(-1).color;

// A downtime category always shows its name next to its color.
export function CategoryLabel({ name, label = name }) {
  return (
    <Stack direction="row" alignItems="center" gap={1} component="span">
      <Box component="span" sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: categoryColor(name), flex: 'none' }} />
      {label}
    </Stack>
  );
}

// Planned stops are excluded from OEE; unplanned ones are losses.
export function TypeChip({ type }) {
  const t = useT();
  const planned = type === 'planned';
  return <Chip size="small" variant="outlined" label={t(planned ? 'Planned' : 'Unplanned')} sx={{ borderColor: planned ? '#90CAF9' : '#CBD5E1', color: planned ? '#0D47A1' : '#475569' }} />;
}

// A repeated case: the same reason 3+ times on this machine within 24 h.
export function RepeatChip({ event }) {
  const t = useT();
  if (!event.repeated) return null;
  return <Chip size="small" label={`${t('Repeated')} ×${event.repeatCount} · 24 h`} sx={{ bgcolor: '#FFEBEE', color: '#C62828' }} />;
}
