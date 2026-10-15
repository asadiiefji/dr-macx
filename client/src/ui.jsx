import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import { MONO, STATUS, SKILLS, C } from './theme.js';

export const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
export const num = (v) => (v == null ? '—' : v.toLocaleString());

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

export const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Logo({ size = 30 }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25}>
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="10" fill={C.amber} />
        <path d="M6 26h9l4-10 6 18 4-12 3 4h10" fill="none" stroke={C.ink} strokeWidth="4" strokeLinecap="square" />
      </svg>
      <Typography component="span" sx={{ fontSize: 20, fontStretch: '125%' }}>
        <b style={{ fontWeight: 800 }}>Dr.</b> <span style={{ fontWeight: 500 }}>Macx</span>
      </Typography>
    </Stack>
  );
}

export function PageHeader({ overline, title, children }) {
  return (
    <Stack direction="row" flexWrap="wrap" justifyContent="space-between" alignItems="flex-end" gap={2} mb={3}>
      <Box>
        <Typography variant="overline" component="div">{overline}</Typography>
        <Typography variant="h4" component="h1">{title}</Typography>
      </Box>
      {children}
    </Stack>
  );
}

export function StatusChip({ status }) {
  const s = STATUS[status] ?? STATUS.disconnected;
  return (
    <Chip
      size="small"
      label={s.label}
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

export function FactorBar({ label, value, color }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="body2" sx={{ fontFamily: MONO, fontWeight: 600 }}>{pct(value)}</Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, (value ?? 0) * 100)}
        aria-label={`${label} ${pct(value)}`}
        sx={{ height: 8, borderRadius: 4, bgcolor: '#E2E4E0', '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 4 } }}
      />
    </Box>
  );
}

export const Mono = (props) => <Box component="span" sx={{ fontFamily: MONO }} {...props} />;
