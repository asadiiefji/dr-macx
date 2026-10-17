import { Link as RouterLink } from 'react-router';
import {
  Alert, Box, Button, Card, CardActionArea, CardActions, CardContent, Divider, Grid, Stack, Typography,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/QueryStatsOutlined';
import { useLive } from '../api.js';
import { PageHeader, StatusChip, FactorBar, LevelChip, Mono, pct, num, duration } from '../ui.jsx';
import { C, FACTORS, LEVELS, level } from '../theme.js';
import { ShiftLine } from './Dashboard.jsx';

export default function Monitoring() {
  const { live, error } = useLive();
  return (
    <>
      <PageHeader overline="OVERVIEW" title="Monitoring" tour="monitoring">{live && <ShiftLine live={live} />}</PageHeader>
      {error && <Alert severity="error" sx={{ mb: 2 }}>Live data unavailable: {error}</Alert>}
      {live && !live.machines.length && <Typography color="text.secondary">No machines yet. Add them under Master data › Machines.</Typography>}
      <Grid container spacing={2}>
        {live?.machines.map((m) => (
          <Grid key={m.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
            <MachineCard m={m} now={live.now} />
          </Grid>
        ))}
      </Grid>
    </>
  );
}

function MachineCard({ m, now }) {
  const off = m.status === 'disconnected' || m.status === 'inactive';
  const k = level(m.oee, m.targets.oee);
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: off ? 0.8 : 1, borderTop: `4px solid ${k ? LEVELS[k].bar : C.line}` }}>
      <CardActionArea component={RouterLink} to={`/monitoring/${m.id}`} sx={{ flex: 1, alignItems: 'stretch' }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
            <Box minWidth={0}>
              <Typography sx={{ fontWeight: 800, fontSize: 18 }}>{m.code}</Typography>
              <Typography noWrap>{m.name}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>{[m.line, m.area].filter(Boolean).join(' · ') || '—'}</Typography>
            </Box>
            <StatusChip status={m.status} />
          </Stack>

          <Stack direction="row" alignItems="center" gap={1.5} mt={2} flexWrap="wrap">
            <Typography sx={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em', color: k ? LEVELS[k].color : C.ink, lineHeight: 1 }}>{pct(m.oee)}</Typography>
            <Box>
              <Typography variant="body2" color="text.secondary">OEE · target {m.targets.oee.target}%</Typography>
              <LevelChip value={m.oee} target={m.targets.oee} />
            </Box>
          </Stack>
          <Typography variant="body2" color="text.secondary" mt={1}>
            {m.status === 'running' && `Running for ${duration(now - m.since)}`}
            {m.status === 'stopped' && <>Alarm <Mono fontWeight={700} color="#B23C00">{m.tags.alarmCode || 'none'}</Mono> · stopped for {duration(now - m.since)}</>}
            {m.status === 'disconnected' && 'No data. Check the Kepware endpoint and tags.'}
            {m.status === 'inactive' && 'Monitoring is switched off for this machine.'}
            {m.status === 'break' && `Planned break · ${duration(now - m.since)}`}
          </Typography>

          <Stack spacing={1.25} mt={2}>
            {FACTORS.map((f) => <FactorBar key={f.key} label={f.label} value={m[f.key]} target={m.targets[f.key]} />)}
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Stack direction="row" justifyContent="space-between" textAlign="center">
            {[['Total', num(m.total)], ['Good', num(m.total - m.ng)], ['NC', num(m.ng)], ['Run time', duration(m.runSec * 1000)]].map(([label, v]) => (
              <Box key={label}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography sx={{ fontWeight: 700 }}>{v}</Typography>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </CardActionArea>

      <CardActions sx={{ px: 2, pb: 2, pt: 1.5, borderTop: `1px solid ${C.line}` }}>
        <Button fullWidth variant="outlined" startIcon={<HistoryIcon />} component={RouterLink} to={`/monitoring/${m.id}?tab=history`}>History analysis</Button>
      </CardActions>
    </Card>
  );
}
