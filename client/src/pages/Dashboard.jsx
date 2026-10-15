import { Link as RouterLink } from 'react-router';
import { Alert, Box, Card, CardContent, Grid, Link, Stack, Typography } from '@mui/material';
import { useLive } from '../api.js';
import { PageHeader, StatusChip, FactorBar, LevelChip, Mono, pct, num, duration, time } from '../ui.jsx';
import { C, FACTORS, KPIS, LEVELS, MONO, STATUS, level } from '../theme.js';

export function ShiftLine({ live }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {live.shift.name} · {time(live.shift.start)}–{time(live.shift.end)} · updated <Mono>{new Date(live.now).toLocaleTimeString()}</Mono>
    </Typography>
  );
}

// value is a 0..1 ratio; target = { target, margin } in % from the machine's master data (none = no judgement).
export function Kpi({ label, value, big, target }) {
  const k = level(value, target);
  const gap = k ? value * 100 - target.target : null;
  return (
    <Card sx={{ height: '100%', borderTop: `4px solid ${k ? LEVELS[k].bar : C.blue}` }}>
      <CardContent>
        <Typography variant="overline" component="div">{label}</Typography>
        <Typography sx={{ fontWeight: 800, fontSize: big ? 42 : 32, lineHeight: 1.1, letterSpacing: '-0.02em', color: k ? LEVELS[k].color : C.ink }}>{pct(value)}</Typography>
        {k && <Box mt={1}><LevelChip value={value} target={target} /></Box>}
        {target && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Target {target.target}% · tolerance {target.margin} pts{gap != null && <> · <b>{gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(1)} pts</b></>}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function KpiRow({ values, targets, overline }) {
  return (
    <Grid container spacing={2}>
      {KPIS.map((k, i) => (
        <Grid key={k.key} size={{ xs: 12, sm: 6, md: 3 }}>
          <Kpi big={i === 0} label={`${k.label.toUpperCase()}${i === 0 && overline ? ` · ${overline}` : ''}`} value={values?.[k.key]} target={targets?.[k.key]} />
        </Grid>
      ))}
    </Grid>
  );
}

export default function Dashboard() {
  const { live, error } = useLive();
  if (error && !live) return <Alert severity="error">Live data unavailable: {error}</Alert>;
  if (!live) return null;

  const { plant, machines, now } = live;
  const count = (s) => machines.filter((m) => m.status === s).length;
  const ranked = machines.filter((m) => m.oee != null).sort((a, b) => a.oee - b.oee);
  const stopped = machines.filter((m) => m.status === 'stopped').sort((a, b) => a.since - b.since);

  return (
    <>
      <PageHeader overline="OVERVIEW" title="Dashboard"><ShiftLine live={live} /></PageHeader>
      {!machines.length && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No machines yet. <Link component={RouterLink} to="/machines">Add a machine</Link> with the dummy generator to see live OEE.
        </Alert>
      )}

      <Box mb={2}><KpiRow values={plant} overline="PLANT · THIS SHIFT" /></Box>

      <Grid container spacing={2} mb={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" component="h2" mb={2}>Machine status</Typography>
              <Grid container spacing={2}>
                {Object.keys(STATUS).map((s) => (
                  <Grid key={s} size={{ xs: 6, sm: 3, md: 6, xl: 3 }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: 32, fontWeight: 600 }}>{count(s)}</Typography>
                    <StatusChip status={s} />
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" component="h2" mb={2}>Output · this shift</Typography>
              <Stack direction="row" spacing={4} flexWrap="wrap">
                {[['Total', plant.total], ['Good', plant.good], ['NC', plant.ng]].map(([l, v]) => (
                  <Box key={l}>
                    <Typography variant="overline" component="div">{l.toUpperCase()}</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 32, fontWeight: 600 }}>{num(v)}</Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="h2">OEE by machine</Typography>
              <Typography variant="body2" color="text.secondary" mb={2}>Lowest first — where to look now.</Typography>
              {!ranked.length && <Typography color="text.secondary">No OEE yet this shift.</Typography>}
              <Stack spacing={2.5}>
                {ranked.map((m) => (
                  <Box key={m.id}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} gap={1} flexWrap="wrap">
                      <Box><Mono fontWeight={600}>{m.code}</Mono> · {m.name}</Box>
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <StatusChip status={m.status} />
                        <LevelChip value={m.oee} target={m.targets.oee} />
                        <Typography sx={{ fontWeight: 800, minWidth: 64, textAlign: 'right' }}>OEE {pct(m.oee)}</Typography>
                      </Stack>
                    </Stack>
                    <Grid container spacing={2}>
                      {FACTORS.map((f) => (
                        <Grid key={f.key} size={{ xs: 12, sm: 4 }}><FactorBar label={f.label} value={m[f.key]} target={m.targets[f.key]} /></Grid>
                      ))}
                    </Grid>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="h2" mb={2}>Stopped now</Typography>
              {!stopped.length && <Typography color="text.secondary">No machine is stopped.</Typography>}
              <Stack spacing={1.5}>
                {stopped.map((m) => (
                  <Stack key={m.id} direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Mono fontWeight={600}>{m.code}</Mono>
                      <Typography variant="body2" color="text.secondary">Alarm <Mono fontWeight={700} color="#C2410C">{m.tags.alarmCode}</Mono></Typography>
                    </Box>
                    <Mono>{duration(now - m.since)}</Mono>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
