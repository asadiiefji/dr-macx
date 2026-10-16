// Simulation controls for dummy-generator presses (demo only): move each OEE factor lower / better,
// start a fault story, or break the press down now. m = live row (sim, simLevels, setup).
import { useState } from 'react';
import { Box, Button, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import LowerIcon from '@mui/icons-material/RemoveRounded';
import BetterIcon from '@mui/icons-material/AddRounded';
import DownIcon from '@mui/icons-material/TrendingDownOutlined';
import UpIcon from '@mui/icons-material/TrendingUpOutlined';
import BreakdownIcon from '@mui/icons-material/BuildCircleOutlined';
import { api } from './api.js';
import { C, FACTORS, LEVELS } from './theme.js';

const STEPS = ['worse', 'normal', 'better'];
const LOOK = { worse: { ...LEVELS.below, label: 'Lower' }, normal: { label: 'Normal', color: C.blueDark, bg: C.light }, better: { ...LEVELS.good, label: 'Better' } };
const FAULTS = { looseNode: 'Loose node', stick: 'Sticking part', ioFault: 'Proximity sensor', overheat: 'Lube overheat' };

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
  const name = FACTORS.find((f) => f.key === factor)?.label ?? factor;
  const lv = sim.levels[factor] ?? 'normal';
  const look = LOOK[lv];
  const btn = { width: 24, height: 24, border: `1px solid ${C.line}`, borderRadius: '6px' };
  return (
    <Stack direction="row" alignItems="center" gap={0.5} onClick={(e) => e.stopPropagation()}>
      <Tooltip describeChild title={`Simulation: lower ${name}`}>
        <span><IconButton size="small" aria-label={`Simulation: lower ${name} on ${m.code}`} disabled={lv === 'worse'} onClick={() => sim.step(factor, -1)} sx={btn}><LowerIcon sx={{ fontSize: 16 }} /></IconButton></span>
      </Tooltip>
      <Typography variant="caption" sx={{ minWidth: 48, textAlign: 'center', fontWeight: 700, borderRadius: '6px', bgcolor: look.bg, color: look.color, lineHeight: '22px' }}>{look.label}</Typography>
      <Tooltip describeChild title={`Simulation: better ${name}`}>
        <span><IconButton size="small" aria-label={`Simulation: better ${name} on ${m.code}`} disabled={lv === 'better'} onClick={() => sim.step(factor, 1)} sx={btn}><BetterIcon sx={{ fontSize: 16 }} /></IconButton></span>
      </Tooltip>
    </Stack>
  );
}

export function BreakdownButton({ sim, sx }) {
  return (
    <Tooltip title="Simulation: the press breaks down now (hydraulic fault, alarm 310, 10–25 min)">
      <Button size="small" variant="outlined" color="error" startIcon={<BreakdownIcon />} onClick={() => sim.send({ inject: 'breakdown' })} sx={{ minHeight: 28, py: 0, px: 1.25, fontSize: 12.5, borderRadius: '6px', ...sx }}>
        Breakdown
      </Button>
    </Tooltip>
  );
}

// The full panel on a monitoring card: all factors at once, each factor, breakdown, fault stories.
export function Simulate({ m }) {
  const sim = useSim(m);
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" mb={0.5}>Simulate OEE (dummy generator)</Typography>
      <ToggleButtonGroup size="small" exclusive value={m.sim} onChange={(e, mode) => mode && sim.send({ mode })} aria-label={`Simulate OEE for ${m.code}`} fullWidth>
        <ToggleButton value="worse" sx={{ '&.Mui-selected, &.Mui-selected:hover': { bgcolor: LEVELS.below.bg, color: LEVELS.below.color } }}><DownIcon fontSize="small" sx={{ mr: 0.5 }} />Worse</ToggleButton>
        <ToggleButton value="normal" sx={{ '&.Mui-selected, &.Mui-selected:hover': { bgcolor: C.light, color: C.blueDark } }}>Normal</ToggleButton>
        <ToggleButton value="better" sx={{ '&.Mui-selected, &.Mui-selected:hover': { bgcolor: LEVELS.good.bg, color: LEVELS.good.color } }}><UpIcon fontSize="small" sx={{ mr: 0.5 }} />Better</ToggleButton>
      </ToggleButtonGroup>
      <Stack spacing={0.5} mt={1}>
        {FACTORS.map((f) => (
          <Stack key={f.key} direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="body2">{f.label}</Typography>
            <FactorSim m={m} factor={f.key} sim={sim} />
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" flexWrap="wrap" gap={0.75} mt={1}>
        <BreakdownButton sim={sim} />
        {m.setup === 'premium' && Object.entries(FAULTS).map(([k, label]) => (
          <Button key={k} size="small" variant="outlined" onClick={() => sim.send({ inject: k })} sx={{ minHeight: 28, py: 0, px: 1.25, fontSize: 12.5, borderRadius: '6px' }}>{label}</Button>
        ))}
      </Stack>
      {sim.error && <Typography variant="caption" color="error">{sim.error}</Typography>}
    </Box>
  );
}
