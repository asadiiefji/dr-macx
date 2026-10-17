// Simulation controls for dummy-generator presses (demo mode on the kiosk): move each OEE factor lower / better,
// or break the press down now. m = live row (sim, simLevels, setup).
import { useState } from 'react';
import { Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import LowerIcon from '@mui/icons-material/RemoveRounded';
import BetterIcon from '@mui/icons-material/AddRounded';
import BreakdownIcon from '@mui/icons-material/BuildCircleOutlined';
import { api } from './api.js';
import { C, FACTORS, LEVELS } from './theme.js';
import { useT } from './i18n.jsx';

const STEPS = ['worse', 'normal', 'better'];
const LOOK = { worse: { ...LEVELS.below, label: 'Lower' }, normal: { label: 'Normal', color: C.blueDark, bg: C.light }, better: { ...LEVELS.good, label: 'Better' } };

export function useSim(m) {
  const [error, setError] = useState('');
  const send = (body) => api(`/machines/${m.id}/simulation`, { method: 'PUT', body }).then(() => setError(''), (x) => setError(x.message));
  const levels = m.simLevels ?? {};
  const step = (factor, dir) => {
    const i = STEPS.indexOf(levels[factor] ?? 'normal') + dir;
    if (i >= 0 && i < STEPS.length) send({ factor, level: STEPS[i] });
  };
  return { send, step, levels, error };
}

// − Normal + for one OEE factor.
export function FactorSim({ m, factor, sim }) {
  const t = useT();
  const name = t(FACTORS.find((f) => f.key === factor)?.label ?? factor);
  const lv = sim.levels[factor] ?? 'normal';
  const look = LOOK[lv];
  const btn = { width: 24, height: 24, border: `1px solid ${C.line}`, borderRadius: '6px' };
  return (
    <Stack direction="row" alignItems="center" gap={0.5} onClick={(e) => e.stopPropagation()}>
      <Tooltip describeChild title={`${t('Simulation')}: ${t('lower')} ${name}`}>
        <span><IconButton size="small" aria-label={`${t('Simulation')}: ${t('lower')} ${name} · ${m.code}`} disabled={lv === 'worse'} onClick={() => sim.step(factor, -1)} sx={btn}><LowerIcon sx={{ fontSize: 16 }} /></IconButton></span>
      </Tooltip>
      <Typography variant="caption" sx={{ minWidth: 48, textAlign: 'center', fontWeight: 700, borderRadius: '6px', bgcolor: look.bg, color: look.color, lineHeight: '22px', px: 0.5 }}>{t(look.label)}</Typography>
      <Tooltip describeChild title={`${t('Simulation')}: ${t('better')} ${name}`}>
        <span><IconButton size="small" aria-label={`${t('Simulation')}: ${t('better')} ${name} · ${m.code}`} disabled={lv === 'better'} onClick={() => sim.step(factor, 1)} sx={btn}><BetterIcon sx={{ fontSize: 16 }} /></IconButton></span>
      </Tooltip>
    </Stack>
  );
}

export function BreakdownButton({ sim, sx }) {
  const t = useT();
  return (
    <Tooltip title={t('Simulation: the machine breaks down now (hydraulic fault, alarm 310, 10–25 min)')}>
      <Button size="small" variant="outlined" color="error" startIcon={<BreakdownIcon />} onClick={() => sim.send({ inject: 'breakdown' })} sx={{ minHeight: 28, py: 0, px: 1.25, fontSize: 12.5, borderRadius: '6px', ...sx }}>
        {t('Breakdown')}
      </Button>
    </Tooltip>
  );
}
