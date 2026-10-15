import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { BarChart } from '@mui/x-charts/BarChart';
import { api, useGet } from '../api.js';
import { ConfirmDialog, fmtTime } from '../StopConfirm.jsx';
import { CategoryLabel, Mono, RepeatChip, TypeChip, categoryColor, duration, num } from '../ui.jsx';
import MachineChat from './MachineChat.jsx';
import { C, CATEGORIES, MONO } from '../theme.js';

const minutes = (v) => `${num(Math.round(v))} min`;

function Stat({ label, value, hint }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="overline" component="div">{label}</Typography>
        <Typography sx={{ fontFamily: MONO, fontWeight: 600, fontSize: 32, lineHeight: 1.1 }}>{value}</Typography>
        {hint && <Typography variant="body2" color="text.secondary" mt={0.5}>{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

export default function Downtime({ id, code, range }) {
  const q = `/machines/${id}/downtime?from=${range.from}&to=${range.to}&shift=${encodeURIComponent(range.shift)}`;
  const { data, error, loading, reload } = useGet(q);
  const [edit, setEdit] = useState(null);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <LinearProgress />;
  const { events, stats } = data;

  return (
    <Stack spacing={2} sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}><Stat label="STOPS" value={num(stats.stops)} hint={stats.unconfirmedStops ? `${stats.unconfirmedStops} to confirm` : 'All confirmed'} /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}><Stat label="UNPLANNED" value={duration((stats.unplannedMin ?? 0) * 60e3)} hint="Losses that lower OEE" /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}><Stat label="PLANNED" value={duration((stats.plannedMin ?? 0) * 60e3)} hint="Excluded from OEE" /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}><Stat label="REPEATED CASES" value={num(stats.repeatedStops)} hint="Same reason 3+ times in 24 h" /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}><Stat label="MTTR" value={stats.mttrMin == null ? '—' : `${stats.mttrMin} min`} hint="Mean time to repair" /></Grid>
        <Grid size={{ xs: 6, md: 4, lg: 2 }}><Stat label="MTBF" value={stats.mtbfRunHours == null ? '—' : `${stats.mtbfRunHours} h`} hint="Mean run time between stops" /></Grid>
      </Grid>

      {!events.length ? (
        <Typography color="text.secondary">No downtime recorded in this period.</Typography>
      ) : (
        <>
          <AiAnalysis id={id} range={range} stops={stats.stops} />
          <MachineChat id={id} code={code} range={range} />
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 6 }}><Pareto reasons={stats.reasons} /></Grid>
            <Grid size={{ xs: 12, lg: 6 }}><DowntimeTrend events={events} range={range} /></Grid>
          </Grid>
          <ReasonTable reasons={stats.reasons} />
          <EventLog events={events} onEdit={setEdit} />
        </>
      )}
      {edit && <ConfirmDialog machineId={id} event={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), reload())} />}
    </Stack>
  );
}

function CategoryLegend({ names }) {
  return (
    <Stack direction="row" flexWrap="wrap" gap={2} mb={1} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {names.map((n) => <li key={n}><Typography variant="body2" component="span"><CategoryLabel name={n} /></Typography></li>)}
    </Stack>
  );
}

// Pareto: reasons by minutes lost, biggest first, each bar in its category color with its value labelled.
function Pareto({ reasons }) {
  const top = reasons.slice(0, 8);
  const names = top.map((r) => r.reason);
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" component="h2">Where the time goes</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>Minutes lost per reason, biggest first.</Typography>
        <CategoryLegend names={[...new Set(top.map((r) => r.category))]} />
        <BarChart
          layout="horizontal"
          height={Math.max(200, top.length * 44 + 40)}
          yAxis={[{ scaleType: 'band', data: names, width: 170, colorMap: { type: 'ordinal', values: names, colors: top.map((r) => categoryColor(r.category)) } }]}
          xAxis={[{ max: Math.ceil(Math.max(...top.map((r) => r.minutes)) * 1.2) }]} // headroom for the outside labels
          series={[{ data: top.map((r) => Math.round(r.minutes)), label: 'Minutes lost', valueFormatter: (v) => minutes(v), barLabel: (item) => `${item.value} min`, barLabelPlacement: 'outside' }]}
          borderRadius={4}
          grid={{ vertical: true }}
          hideLegend
          margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
          sx={{ '& .MuiBarLabel-root': { fill: C.ink, fontFamily: MONO, fontSize: 12 }, '& .MuiChartsGrid-line': { stroke: '#E2E4E0' } }}
        />
      </CardContent>
    </Card>
  );
}

// Stacked downtime per day (or per hour for short ranges) by category.
function DowntimeTrend({ events, range }) {
  const hourly = range.to - range.from <= 2 * 86400e3;
  const key = (t) => (hourly ? new Date(t).setMinutes(0, 0, 0) : new Date(t).setHours(0, 0, 0, 0));
  const buckets = new Map();
  for (const e of events) {
    const k = key(e.start);
    const b = buckets.get(k) ?? {};
    b[e.category] = (b[e.category] ?? 0) + e.minutes;
    buckets.set(k, b);
  }
  const xs = [...buckets.keys()].sort((a, b) => a - b);
  const cats = CATEGORIES.filter((c) => xs.some((x) => buckets.get(x)[c.name]));
  const label = (t) =>
    hourly ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h6" component="h2">Downtime trend</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>Minutes per {hourly ? 'hour' : 'day'}, by category.</Typography>
        <CategoryLegend names={cats.map((c) => c.name)} />
        <BarChart
          height={300}
          xAxis={[{ scaleType: 'band', data: xs.map(label), categoryGapRatio: 0.3 }]}
          yAxis={[{ width: 40 }]}
          series={cats.map((c) => ({
            data: xs.map((x) => Math.round(buckets.get(x)[c.name] ?? 0)),
            label: c.name,
            color: c.color,
            stack: 'downtime',
            valueFormatter: (v) => minutes(v),
          }))}
          grid={{ horizontal: true }}
          hideLegend
          margin={{ left: 0, right: 8, top: 8, bottom: 8 }}
          sx={{ '& .MuiBarElement-root': { stroke: '#FFFFFF', strokeWidth: 1 }, '& .MuiChartsGrid-line': { stroke: '#E2E4E0' } }}
        />
      </CardContent>
    </Card>
  );
}

const trendText = (t) => (t == null ? '—' : `${t > 0 ? '▲' : t < 0 ? '▼' : ''} ${Math.abs(Math.round(t * 100))}%`);

function ReasonTable({ reasons }) {
  return (
    <Card>
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6" component="h2">By reason</Typography>
        <Typography variant="body2" color="text.secondary">Trend = change in stop count, first half of the period vs second half.</Typography>
      </CardContent>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell>Reason</TableCell><TableCell>Category</TableCell><TableCell>Type</TableCell><TableCell align="right">Stops</TableCell><TableCell align="right">Repeated</TableCell>
              <TableCell align="right">Minutes</TableCell><TableCell align="right">Share</TableCell><TableCell align="right">MTTR</TableCell>
              <TableCell align="right">MTBF</TableCell><TableCell align="right">Trend</TableCell><TableCell>By shift</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reasons.map((r) => (
              <TableRow key={r.code}>
                <TableCell><Mono fontWeight={600}>{r.code}</Mono> · {r.reason}</TableCell>
                <TableCell><CategoryLabel name={r.category} /></TableCell>
                <TableCell><TypeChip type={r.type} /></TableCell>
                <TableCell align="right"><Mono>{num(r.count)}</Mono></TableCell>
                <TableCell align="right"><Mono fontWeight={r.repeatedStops ? 700 : 400} color={r.repeatedStops ? '#C62828' : undefined}>{num(r.repeatedStops)}</Mono></TableCell>
                <TableCell align="right"><Mono>{num(Math.round(r.minutes))}</Mono></TableCell>
                <TableCell align="right"><Mono>{Math.round(r.share * 100)}%</Mono></TableCell>
                <TableCell align="right"><Mono>{r.mttrMin} min</Mono></TableCell>
                <TableCell align="right"><Mono>{r.mtbfRunHours} h</Mono></TableCell>
                <TableCell align="right"><Mono fontWeight={600}>{trendText(r.trend)}</Mono></TableCell>
                <TableCell><Mono>{['Shift 1', 'Shift 2', 'Shift 3'].map((s) => r.byShift[s] ?? 0).join(' / ')}</Mono></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Box px={2} py={1}><Typography variant="caption" color="text.secondary">By shift = stops in Shift 1 / Shift 2 / Shift 3. Repeated = stops that were the 3rd or later of the same reason within 24 h.</Typography></Box>
    </Card>
  );
}

function EventLog({ events, onEdit }) {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const pg = Math.min(page, Math.max(0, Math.ceil(events.length / perPage) - 1));
  return (
    <Card>
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6" component="h2">Downtime log</Typography>
        <Typography variant="body2" color="text.secondary">Every stop outside a planned break, newest first. A new stop waits for its reason to be confirmed; the PLC alarm pre-fills a suggestion.</Typography>
      </CardContent>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 900 }}>
          <TableHead>
            <TableRow>
              <TableCell>Started</TableCell><TableCell align="right">Duration</TableCell><TableCell align="right">Alarm</TableCell>
              <TableCell>Reason</TableCell><TableCell>Type</TableCell><TableCell>Status</TableCell><TableCell>Shift</TableCell><TableCell>Comment</TableCell><TableCell aria-label="Actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {events.slice(pg * perPage, pg * perPage + perPage).map((e) => (
              <TableRow key={e.id}>
                <TableCell sx={{ whiteSpace: 'nowrap' }}><Mono>{fmtTime(e.start)}</Mono></TableCell>
                <TableCell align="right"><Mono>{e.end ? duration(e.minutes * 60e3) : 'ongoing'}</Mono></TableCell>
                <TableCell align="right"><Mono>{e.alarmCode}</Mono></TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                    <CategoryLabel name={e.category} />
                    <span>· {e.reason}</span>
                    <RepeatChip event={e} />
                  </Stack>
                </TableCell>
                <TableCell><TypeChip type={e.type} /></TableCell>
                <TableCell>
                  {e.confirmed ? (
                    <Chip size="small" label="Confirmed" sx={{ bgcolor: '#E8F5E9', color: '#2E7D32' }} />
                  ) : (
                    <Chip size="small" label={e.suggested ? 'Suggested · to confirm' : 'To confirm'} sx={{ bgcolor: '#FFF8E1', color: '#8A5300' }} />
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{e.shift}</TableCell>
                <TableCell sx={{ maxWidth: 280 }}>{e.comment || <Typography variant="body2" color="text.secondary" component="span">—</Typography>}</TableCell>
                <TableCell align="right"><Button size="small" variant={e.confirmed ? 'text' : 'contained'} onClick={() => onEdit(e)}>{e.confirmed ? 'Change' : 'Confirm'}</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <TablePagination
        component="div"
        count={events.length}
        page={pg}
        onPageChange={(e, p) => setPage(p)}
        rowsPerPage={perPage}
        onRowsPerPageChange={(e) => (setPerPage(Number(e.target.value)), setPage(0))}
        rowsPerPageOptions={[10, 25, 50]}
      />
    </Card>
  );
}

const RISK = { high: { bg: '#FCE6DA', fg: '#C2410C' }, medium: { bg: '#FFF1CC', fg: '#8A5A00' }, low: { bg: '#E3E9F8', fg: '#1E40AF' } };
const Level = ({ value, word }) => (
  <Chip size="small" label={`${value} ${word}`} sx={{ bgcolor: RISK[value]?.bg, color: RISK[value]?.fg, fontWeight: 700, textTransform: 'capitalize' }} />
);

function AiAnalysis({ id, range, stops }) {
  const [state, setState] = useState({ loading: false, result: null, error: '' });
  const run = () => {
    setState({ loading: true, result: null, error: '' });
    api(`/machines/${id}/analysis`, { method: 'POST', body: { from: range.from, to: range.to, shift: range.shift } }).then(
      (result) => setState({ loading: false, result, error: '' }),
      (e) => setState({ loading: false, result: null, error: e.message }),
    );
  };
  const r = state.result;
  return (
    <Card sx={{ borderTop: `4px solid ${C.sky}` }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h6" component="h2">AI downtime analysis</Typography>
            <Typography variant="body2" color="text.secondary">
              Gemini reviews the {num(stops)} stops in this period: why they happen, how to prevent them, and what is likely next.
            </Typography>
          </Box>
          <Button variant="contained" color="secondary" onClick={run} disabled={state.loading} startIcon={state.loading ? <CircularProgress size={18} /> : <AutoAwesomeIcon />}>
            {state.loading ? 'Analysing…' : r ? 'Analyse again' : 'Analyse with Gemini'}
          </Button>
        </Stack>
        {state.error && <Alert severity="error" sx={{ mt: 2 }}>{state.error}</Alert>}
        {r && (
          <Stack spacing={3} mt={3}>
            <Typography sx={{ fontSize: 17, lineHeight: 1.6 }}>{r.summary}</Typography>

            <Box>
              <Typography variant="overline" component="h3">WHY IT HAPPENS</Typography>
              <Stack spacing={1.5} mt={1}>
                {r.causes.map((c, i) => (
                  <Box key={i}>
                    <Typography fontWeight={700}>{c.reason}</Typography>
                    <Typography>{c.why}</Typography>
                    <Typography variant="body2" color="text.secondary">Evidence: {c.evidence}</Typography>
                  </Box>
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="overline" component="h3">HOW TO PREVENT IT</Typography>
              <Stack spacing={1.5} mt={1}>
                {r.prevention.map((p, i) => (
                  <Stack key={i} direction="row" gap={1.5} alignItems="flex-start">
                    <Level value={p.priority} word="priority" />
                    <Box>
                      <Typography fontWeight={600}>{p.action}</Typography>
                      <Typography variant="body2" color="text.secondary">{p.reason} · {p.expectedImpact}</Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="overline" component="h3">WHAT TO EXPECT</Typography>
              <Stack spacing={1.5} mt={1}>
                {r.predictions.map((p, i) => (
                  <Stack key={i} direction="row" gap={1.5} alignItems="flex-start">
                    <Level value={p.risk} word="risk" />
                    <Box>
                      <Typography fontWeight={600}>{p.reason}: {p.outlook}</Typography>
                      <Typography variant="body2" color="text.secondary">{p.rationale}</Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Generated by {r.model} from the recorded stops and OEE of this period. Check before acting.
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
