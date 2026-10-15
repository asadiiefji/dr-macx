import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, Typography,
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { useGet } from '../api.js';
import { LevelChip, Mono, num, pct } from '../ui.jsx';
import Timeline from './Timeline.jsx';
import { C, KPIS, LEVELS, MONO } from '../theme.js';
import { KpiRow } from './Dashboard.jsx';

const SHIFT_OF = { 7: 'Shift 1', 15: 'Shift 2', 23: 'Shift 3' };
export function periodLabel(t, by) {
  const d = new Date(t);
  const day = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (by === 'day') return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  if (by === 'shift') return `${day} · ${SHIFT_OF[d.getHours()] ?? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `${day} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const tickLabel = (t, by) =>
  by === 'hour' ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
const asPct = (v) => (v == null ? null : Math.round(v * 1000) / 10);
const fmtPct = (v) => (v == null ? '—' : `${v}%`);

// One series per chart (identity from the title); dashed lines mark the target and the red limit (target − tolerance).
function TrendChart({ rows, by, k, target, height }) {
  return (
    <LineChart
      height={height}
      xAxis={[{ data: rows.map((r) => r.start), scaleType: 'point', valueFormatter: (t, ctx) => (ctx.location === 'tick' ? tickLabel(t, by) : periodLabel(t, by)) }]}
      yAxis={[{ min: 0, max: 100, valueFormatter: (v) => `${v}%`, width: 48 }]}
      series={[{ data: rows.map((r) => asPct(r[k.key])), label: k.label, color: C.blue, showMark: rows.length <= 40, valueFormatter: fmtPct, connectNulls: false }]}
      grid={{ horizontal: true }}
      hideLegend
      margin={{ left: 8, right: 28, top: 16, bottom: 8 }}
      sx={{ '& .MuiLineElement-root': { strokeWidth: 2 }, '& .MuiChartsGrid-line': { stroke: '#E2E4E0' } }}
    >
      {target && (
        <ChartsReferenceLine y={target.target} label={height >= 250 ? `Target ${target.target}%` : undefined} labelAlign="end" lineStyle={{ stroke: LEVELS.good.color, strokeDasharray: '4 4', strokeWidth: 1.5 }} labelStyle={{ fontSize: 12, fill: LEVELS.good.color }} />
      )}
      {target?.margin > 0 && (
        <ChartsReferenceLine y={target.target - target.margin} label={height >= 250 ? `Limit ${target.target - target.margin}%` : undefined} labelAlign="start" lineStyle={{ stroke: LEVELS.below.color, strokeDasharray: '2 4', strokeWidth: 1.5 }} labelStyle={{ fontSize: 12, fill: LEVELS.below.color }} />
      )}
    </LineChart>
  );
}

export default function History({ id, range, onShift }) {
  const q = `/machines/${id}/history?from=${range.from}&to=${range.to}&by=${range.by}&shift=${encodeURIComponent(range.shift)}`;
  const { data, error, loading } = useGet(q);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <LinearProgress />;
  const { rows, shifts, total, targets } = data;
  const [oeeK, ...factors] = KPIS;
  const pg = Math.min(page, Math.max(0, Math.ceil(rows.length / perPage) - 1)); // range change can shrink the list

  return (
    <Box sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <Box mb={2}><Timeline id={id} /></Box>
      <KpiRow values={total} targets={targets} overline="SELECTED PERIOD" />
      {shifts.length > 0 && <ShiftSummary shifts={shifts} targets={targets} picked={range.shift} onShift={onShift} />}
      {!rows.length ? (
        <Typography color="text.secondary" mt={3}>No recorded data in this period.</Typography>
      ) : (
        <>
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="h6" component="h2">OEE trend</Typography>
              <Typography variant="body2" color="text.secondary">Per {range.by}. Green dashed line = target, red dashed line = limit (target − tolerance).</Typography>
              <TrendChart rows={rows} by={range.by} k={oeeK} target={targets.oee} height={300} />
            </CardContent>
          </Card>

          <Grid container spacing={2} mt={0}>
            {factors.map((k) => (
              <Grid key={k.key} size={{ xs: 12, md: 4 }}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" component="h3" fontSize={16}>{k.label}</Typography>
                    <Typography variant="caption" color="text.secondary">Target {targets[k.key].target}% · limit {targets[k.key].target - targets[k.key].margin}%</Typography>
                    <TrendChart rows={rows} by={range.by} k={k} target={targets[k.key]} height={180} />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Card sx={{ mt: 2 }}>
            <CardContent sx={{ pb: 0 }}>
              <Typography variant="h6" component="h2">History table</Typography>
            </CardContent>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 900, '& td': { fontFamily: MONO } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Period</TableCell>
                    <TableCell align="right">Planned (h)</TableCell><TableCell align="right">Run (h)</TableCell><TableCell align="right">Unplanned down (min)</TableCell><TableCell align="right">Planned stop (min)</TableCell>
                    <TableCell align="right">Total</TableCell><TableCell align="right"><abbr title="Non Conformance">NC</abbr></TableCell>
                    <TableCell align="right">A</TableCell><TableCell align="right">P</TableCell><TableCell align="right">Q</TableCell><TableCell align="right">OEE</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...rows].reverse().slice(pg * perPage, pg * perPage + perPage).map((r) => (
                    <TableRow key={r.start}>
                      <TableCell sx={{ fontFamily: 'inherit !important', whiteSpace: 'nowrap' }}>{periodLabel(r.start, range.by)}</TableCell>
                      <TableCell align="right">{(r.plannedSec / 3600).toFixed(1)}</TableCell>
                      <TableCell align="right">{(r.runSec / 3600).toFixed(1)}</TableCell>
                      <TableCell align="right">{Math.round(r.downSec / 60)}</TableCell>
                      <TableCell align="right">{Math.round((r.plannedStopSec ?? 0) / 60)}</TableCell>
                      <TableCell align="right">{num(r.total)}</TableCell>
                      <TableCell align="right">{num(r.ng)}</TableCell>
                      <TableCell align="right">{pct(r.availability)}</TableCell>
                      <TableCell align="right">{pct(r.performance)}</TableCell>
                      <TableCell align="right">{pct(r.quality)}</TableCell>
                      <TableCell align="right"><Mono fontWeight={700}>{pct(r.oee)}</Mono></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <TablePagination
              component="div"
              count={rows.length}
              page={pg}
              onPageChange={(e, p) => setPage(p)}
              rowsPerPage={perPage}
              onRowsPerPageChange={(e) => (setPerPage(Number(e.target.value)), setPage(0))}
              rowsPerPageOptions={[10, 25, 50]}
            />
          </Card>
        </>
      )}
    </Box>
  );
}

// One row per shift across the selected period, to compare Shift 1 / 2 / 3. Pick a row to filter everything to it.
function ShiftSummary({ shifts, targets, picked, onShift }) {
  return (
    <Card sx={{ mt: 2 }}>
      <CardContent sx={{ pb: 0 }}>
        <Typography variant="h6" component="h2">By shift</Typography>
        <Typography variant="body2" color="text.secondary">Same period, split by shift. Choose a shift to see only its data below.</Typography>
      </CardContent>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 980 }}>
          <TableHead>
            <TableRow>
              <TableCell>Shift</TableCell>
              <TableCell align="right">Planned (h)</TableCell><TableCell align="right">Run (h)</TableCell>
              <TableCell align="right">Unplanned down (min)</TableCell><TableCell align="right">Planned stop (min)</TableCell>
              <TableCell align="right">Total</TableCell><TableCell align="right">Good</TableCell><TableCell align="right"><abbr title="Non Conformance">NC</abbr></TableCell>
              <TableCell align="right">A</TableCell><TableCell align="right">P</TableCell><TableCell align="right">Q</TableCell><TableCell>OEE</TableCell><TableCell aria-label="Actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {shifts.map((s) => (
              <TableRow key={s.name} selected={picked === s.name}>
                <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{s.name}</TableCell>
                <TableCell align="right">{(s.plannedSec / 3600).toFixed(1)}</TableCell>
                <TableCell align="right">{(s.runSec / 3600).toFixed(1)}</TableCell>
                <TableCell align="right">{num(Math.round(s.downSec / 60))}</TableCell>
                <TableCell align="right">{num(Math.round(s.plannedStopSec / 60))}</TableCell>
                <TableCell align="right">{num(s.total)}</TableCell>
                <TableCell align="right">{num(s.total - s.ng)}</TableCell>
                <TableCell align="right">{num(s.ng)}</TableCell>
                <TableCell align="right">{pct(s.availability)}</TableCell>
                <TableCell align="right">{pct(s.performance)}</TableCell>
                <TableCell align="right">{pct(s.quality)}</TableCell>
                <TableCell><Stack direction="row" gap={1} alignItems="center"><b>{pct(s.oee)}</b><LevelChip value={s.oee} target={targets.oee} /></Stack></TableCell>
                <TableCell align="right">
                  {picked === s.name ? <Button size="small" onClick={() => onShift('')}>Show all shifts</Button> : <Button size="small" onClick={() => onShift(s.name)}>Only {s.name}</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Card>
  );
}
