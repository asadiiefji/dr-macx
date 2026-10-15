import { Alert, Box, Card, CardContent, Chip, Divider, Grid, Stack, Typography } from '@mui/material';
import { useLive } from '../api.js';
import { PageHeader, StatusChip, FactorBar, Mono, pct, num, duration } from '../ui.jsx';
import { FACTORS, MONO, OEE_COLOR } from '../theme.js';
import { ShiftLine } from './Dashboard.jsx';

export default function Monitoring() {
  const { live, error } = useLive();
  return (
    <>
      <PageHeader overline="OVERVIEW" title="Machine monitoring">{live && <ShiftLine live={live} />}</PageHeader>
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
  return (
    <Card sx={{ height: '100%', opacity: off ? 0.75 : 1 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
          <Box minWidth={0}>
            <Typography sx={{ fontFamily: MONO, fontWeight: 600, fontSize: 18 }}>{m.code}</Typography>
            <Typography noWrap>{m.name}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>{[m.line, m.area].filter(Boolean).join(' · ') || '—'}</Typography>
          </Box>
          <StatusChip status={m.status} />
        </Stack>

        <Stack direction="row" alignItems="baseline" spacing={1} mt={2}>
          <Typography sx={{ fontFamily: MONO, fontSize: 40, fontWeight: 600, color: OEE_COLOR, lineHeight: 1 }}>{pct(m.oee)}</Typography>
          <Typography color="text.secondary">OEE</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          {m.status === 'running' && `Running for ${duration(now - m.since)}`}
          {m.status === 'stopped' && <>Alarm <Mono fontWeight={700} color="#C2410C">{m.tags.alarmCode}</Mono> · stopped for {duration(now - m.since)}</>}
          {m.status === 'disconnected' && 'No data. Check the Kepware endpoint and tags.'}
          {m.status === 'inactive' && 'Monitoring is switched off for this machine.'}
        </Typography>

        <Stack spacing={1.25} mt={2}>
          {FACTORS.map((f) => <FactorBar key={f.key} label={f.label} value={m[f.key]} color={f.color} />)}
        </Stack>

        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between" textAlign="center">
          {[['Total', m.total], ['Good', m.total - m.ng], ['NG', m.ng], ['Run time', null]].map(([label, v]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography sx={{ fontFamily: MONO, fontWeight: 600 }}>{label === 'Run time' ? duration(m.runSec * 1000) : num(v)}</Typography>
            </Box>
          ))}
        </Stack>
        <Chip size="small" variant="outlined" label={m.source === 'dummy' ? 'Dummy generator' : 'Kepware (PLC)'} sx={{ mt: 2 }} />
      </CardContent>
    </Card>
  );
}
