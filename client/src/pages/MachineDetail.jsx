import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  Alert, Box, Card, CardContent, Grid, Link, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs,
  TextField, Typography,
} from '@mui/material';
import { useCollection, useLive } from '../api.js';
import { PageHeader, StatusChip, Mono, num, duration } from '../ui.jsx';
import { MONO } from '../theme.js';
import { ShiftLine, KpiRow } from './Dashboard.jsx';
import SensorTable, { NcEntry } from '../SensorTable.jsx';
import { SETUP_TEXT } from '../sensors.js';
import History from './History.jsx';
import Anatomy from '../anatomy/Anatomy.jsx';
import Downtime from './Downtime.jsx';

const DAY = 86400e3;
const dateInput = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const today = () => new Date().setHours(0, 0, 0, 0);
const PRESETS = {
  today: { label: 'Today', from: () => today(), to: () => today() },
  yesterday: { label: 'Yesterday', from: () => today() - DAY, to: () => today() - DAY },
  '7d': { label: 'Last 7 days', from: () => today() - 6 * DAY, to: () => today() },
  '30d': { label: 'Last 30 days', from: () => today() - 29 * DAY, to: () => today() },
  custom: { label: 'Custom range' },
};

export default function MachineDetail() {
  const { id } = useParams();
  const { live, error } = useLive();
  const machines = useCollection('machines');
  const [tab, setTab] = useState(0);
  const [f, setF] = useState({ preset: '7d', from: dateInput(PRESETS['7d'].from()), to: dateInput(today()), shift: '', by: 'day' });

  const m = live?.machines.find((x) => x.id === id);
  const master = machines.rows.find((x) => x.id === id);
  if (live && !m) return <Alert severity="warning">Machine not found. <Link component={RouterLink} to="/monitoring">Back to monitoring</Link></Alert>;
  if (!m) return error ? <Alert severity="error">Live data unavailable: {error}</Alert> : null;

  const pickPreset = (preset) =>
    setF(preset === 'custom' ? { ...f, preset } : { ...f, preset, from: dateInput(PRESETS[preset].from()), to: dateInput(PRESETS[preset].to()) });
  // Whole local days: from 00:00 of the first day to 00:00 after the last day.
  const range = { from: parseDate(f.from), to: parseDate(f.to) + DAY, shift: f.shift, by: f.by };
  const badRange = !(range.from < range.to) || range.to - range.from > 92 * DAY;

  return (
    <>
      <Link component={RouterLink} to="/monitoring" underline="hover" sx={{ display: 'inline-block', mb: 1, fontWeight: 600 }}>← Machine monitoring</Link>
      <PageHeader overline={[m.line, m.area].filter(Boolean).join(' · ').toUpperCase() || 'MACHINE'} title={`${m.code} · ${m.name}`}>
        <Stack alignItems={{ sm: 'flex-end' }} gap={0.5}>
          <StatusChip status={m.status} />
          <ShiftLine live={live} />
        </Stack>
      </PageHeader>

      <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Live" />
        <Tab label="OEE history" />
        <Tab label="Downtime & AI analysis" />
        <Tab label="Anatomy" />
      </Tabs>

      {tab > 0 && tab < 3 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" flexWrap="wrap" gap={2} alignItems="center">
              <TextField select size="small" label="Period" value={f.preset} onChange={(e) => pickPreset(e.target.value)} sx={{ minWidth: 170 }}>
                {Object.entries(PRESETS).map(([k, p]) => <MenuItem key={k} value={k}>{p.label}</MenuItem>)}
              </TextField>
              <TextField size="small" type="date" label="From" value={f.from} onChange={(e) => setF({ ...f, preset: 'custom', from: e.target.value })} />
              <TextField size="small" type="date" label="To" value={f.to} onChange={(e) => setF({ ...f, preset: 'custom', to: e.target.value })} />
              <TextField select size="small" label="Shift" value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })} sx={{ minWidth: 140 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value="">All shifts</MenuItem>
                {['Shift 1', 'Shift 2', 'Shift 3'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              {tab === 1 && (
                <TextField select size="small" label="Group by" value={f.by} onChange={(e) => setF({ ...f, by: e.target.value })} sx={{ minWidth: 130 }}>
                  <MenuItem value="hour">Hour</MenuItem>
                  <MenuItem value="shift">Shift</MenuItem>
                  <MenuItem value="day">Day</MenuItem>
                </TextField>
              )}
            </Stack>
            {badRange && <Alert severity="warning" sx={{ mt: 2 }}>Pick a range where From is on or before To, up to 92 days.</Alert>}
          </CardContent>
        </Card>
      )}

      {tab === 0 && <LiveTab m={m} master={master} live={live} />}
      {tab === 1 && !badRange && <History id={id} range={range} onShift={(shift) => setF({ ...f, shift })} />}
      {tab === 3 && <Anatomy m={m} title={`${m.code} anatomy`} height={560} />}
      {tab === 2 && !badRange && <Downtime id={id} code={m.code} range={range} />}
    </>
  );
}

function LiveTab({ m, master, live }) {
  return (
    <Stack spacing={2}>
      <KpiRow values={m} targets={m.targets} overline="THIS SHIFT" />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" component="h2">Sensors · {SETUP_TEXT[m.setup]?.label} setup</Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>
                {m.ratedTonnage} t {m.frameType}, {m.nodes} tonnage nodes · {m.source === 'dummy' ? 'Simulated sensors (as the PLC would send them, every 1 s)' : 'Sensors via PLC / Kepware'}
              </Typography>
              <SensorTable m={m} master={master} />
              {m.setup === 'essential' && (
                <Box mt={2}>
                  <Typography variant="body2" color="text.secondary" mb={1}>No vision camera on this press: log the NC pieces you find so Quality is right.</Typography>
                  <NcEntry machineId={m.id} />
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" component="h2" mb={2}>This shift</Typography>
              <Grid container spacing={2}>
                {[
                  ['Total', num(m.total)],
                  ['Good', num(m.total - m.ng)],
                  ['NC (non-conformance)', num(m.ng)],
                  ['Run time', duration(m.runSec * 1000)],
                  ['Unplanned down', duration(m.downSec * 1000)],
                  ['Planned stop', duration(m.plannedStopSec * 1000)],
                ].map(([l, v]) => (
                  <Grid key={l} size={6}>
                    <Typography variant="overline" component="div">{l.toUpperCase()}</Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: 22, fontWeight: 600 }}>{v}</Typography>
                  </Grid>
                ))}
              </Grid>
              {m.status === 'stopped' && (
                <Alert severity="warning" sx={{ mt: 2 }}>Stopped with alarm <Mono fontWeight={700}>{m.tags.alarmCode}</Mono>. The stop is recorded as downtime.</Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
