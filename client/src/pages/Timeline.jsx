// What the machine did during one shift: a horizontal time bar (run / stop with reason / break) and a list view.
import { useEffect, useState } from 'react';
import {
  Alert, Box, Card, CardContent, Chip, LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import BarIcon from '@mui/icons-material/ViewTimelineOutlined';
import ListIcon from '@mui/icons-material/ViewListOutlined';
import { useGet } from '../api.js';
import { CategoryLabel, duration } from '../ui.jsx';
import { C } from '../theme.js';

// State colours (always with a legend, a tooltip and the list view, never colour alone).
export const KINDS = {
  run: { label: 'Running', color: '#43A047' },
  unplanned: { label: 'Unplanned downtime', color: '#E53935' },
  planned: { label: 'Planned downtime', color: '#1E88E5' },
  break: { label: 'Planned break', color: '#90A4AE' },
  nodata: { label: 'No data', color: '#E2E8F0' },
};
const SHIFT_HOURS = { 'Shift 1': 7, 'Shift 2': 15, 'Shift 3': 23 };
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const pad = (n) => String(n).padStart(2, '0');
const dateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The shift running now: Shift 3 after midnight belongs to the previous day's date.
function currentPick() {
  const d = new Date();
  const h = d.getHours();
  if (h < 7) d.setDate(d.getDate() - 1);
  return { date: dateInput(d), shift: h >= 23 || h < 7 ? 'Shift 3' : h >= 15 ? 'Shift 2' : 'Shift 1' };
}
const shiftStart = ({ date, shift }) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, SHIFT_HOURS[shift]).getTime();
};

const bg = (s) =>
  s.kind === 'nodata'
    ? 'repeating-linear-gradient(45deg, #E2E8F0 0 6px, #F8FAFC 6px 12px)'
    : s.kind === 'unplanned' && !s.confirmed
      ? `repeating-linear-gradient(45deg, ${KINDS.unplanned.color} 0 6px, #EF9A9A 6px 12px)` // waiting for a confirmed reason
      : KINDS[s.kind].color;

function segmentText(s) {
  return `${hhmm(s.start)}–${hhmm(s.end)} · ${duration(s.end - s.start)} · ${KINDS[s.kind].label}${s.kind === 'run' || s.kind === 'nodata' ? '' : `: ${s.label}`}${s.kind === 'unplanned' && !s.confirmed ? ' (reason to confirm)' : ''}`;
}

function TimeBar({ shift, until, segments }) {
  const len = shift.end - shift.start;
  const at = (t) => `${((t - shift.start) / len) * 100}%`;
  const hours = Array.from({ length: Math.round(len / 3600e3) + 1 }, (_, i) => shift.start + i * 3600e3);
  return (
    <Box>
      <Box sx={{ position: 'relative', height: 52, borderRadius: 2, overflow: 'hidden', bgcolor: '#F8FAFC', border: `1px solid ${C.line}` }}>
        {segments.map((s) => {
          const w = ((s.end - s.start) / len) * 100;
          return (
            <Tooltip key={s.start} title={segmentText(s)} arrow>
              <Box
                tabIndex={0}
                aria-label={segmentText(s)}
                sx={{
                  position: 'absolute', top: 0, bottom: 0, left: at(s.start), width: `max(${w}%, 2px)`, background: bg(s),
                  borderRight: '1px solid #FFFFFF', display: 'flex', alignItems: 'center', px: 0.75, overflow: 'hidden',
                  color: s.kind === 'nodata' || s.kind === 'break' ? C.ink : '#FFFFFF', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                  outlineOffset: -2, '&:focus-visible': { outline: `2px solid ${C.ink}` },
                }}
              >
                {w > 7 && (s.kind === 'run' ? 'Running' : s.label)}
              </Box>
            </Tooltip>
          );
        })}
        {until < shift.end && <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: at(until), width: 2, bgcolor: C.ink }} />}
      </Box>
      <Box sx={{ position: 'relative', height: 22, mt: 0.5 }} aria-hidden>
        {hours.map((h, i) => (
          <Typography
            key={h}
            variant="caption"
            color="text.secondary"
            sx={{ position: 'absolute', left: at(h), transform: i === 0 ? 'none' : i === hours.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
          >
            {hhmm(h)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

function TimeList({ segments }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            <TableCell>From – to</TableCell><TableCell align="right">Duration</TableCell><TableCell>State</TableCell>
            <TableCell>Reason</TableCell><TableCell>Status</TableCell><TableCell>Comment</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {segments.map((s) => (
            <TableRow key={s.start}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{hhmm(s.start)} – {hhmm(s.end)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{duration(s.end - s.start)}</TableCell>
              <TableCell>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '3px', background: bg(s), flex: 'none' }} />
                  {KINDS[s.kind].label}
                </Stack>
              </TableCell>
              <TableCell>
                {s.kind === 'planned' || s.kind === 'unplanned' ? (
                  <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><CategoryLabel name={s.category} /><span>· {s.label}</span></Stack>
                ) : s.kind === 'break' ? s.label : '—'}
              </TableCell>
              <TableCell>
                {s.kind === 'unplanned' || s.kind === 'planned' ? (
                  s.confirmed ? <Chip size="small" label="Confirmed" sx={{ bgcolor: '#E8F5E9', color: '#2E7D32' }} /> : <Chip size="small" label="To confirm" sx={{ bgcolor: '#FFF8E1', color: '#8A5300' }} />
                ) : '—'}
              </TableCell>
              <TableCell sx={{ maxWidth: 260 }}>{s.comment || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export default function Timeline({ id }) {
  const [pick, setPick] = useState(currentPick);
  const [view, setView] = useState('bar');
  const start = shiftStart(pick);
  const { data, error, loading, reload } = useGet(`/machines/${id}/timeline?start=${start}`);
  const isNow = data && data.until < data.shift.end;
  useEffect(() => {
    if (!isNow) return;
    const t = setInterval(reload, 30000); // the shift in progress keeps filling in
    return () => clearInterval(t);
  }, [isNow, reload]);

  const totals = Object.fromEntries(Object.keys(KINDS).map((k) => [k, (data?.segments ?? []).filter((s) => s.kind === k).reduce((a, s) => a + s.end - s.start, 0)]));
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h6" component="h2">Shift timeline</Typography>
            <Typography variant="body2" color="text.secondary">What the machine did, minute by minute: running, stops with their reason, planned breaks.</Typography>
          </Box>
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            <TextField size="small" type="date" label="Date" value={pick.date} onChange={(e) => e.target.value && setPick({ ...pick, date: e.target.value })} />
            <TextField select size="small" label="Shift" value={pick.shift} onChange={(e) => setPick({ ...pick, shift: e.target.value })} sx={{ minWidth: 150 }}>
              {Object.entries(SHIFT_HOURS).map(([s, h]) => <MenuItem key={s} value={s}>{s} · {pad(h)}:00–{pad((h + 8) % 24)}:00</MenuItem>)}
            </TextField>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(e, v) => v && setView(v)} aria-label="Timeline view">
              <ToggleButton value="bar"><BarIcon fontSize="small" sx={{ mr: 0.5 }} />Bar</ToggleButton>
              <ToggleButton value="list"><ListIcon fontSize="small" sx={{ mr: 0.5 }} />List</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {loading && !data && <LinearProgress sx={{ mt: 2 }} />}
        {data && !data.segments.length && <Typography color="text.secondary" mt={2}>This shift has not started yet.</Typography>}
        {data && data.segments.length > 0 && (
          <Box mt={2.5}>
            <Stack direction="row" flexWrap="wrap" gap={2} mb={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {Object.entries(KINDS).map(([k, v]) => (
                <Stack key={k} component="li" direction="row" alignItems="center" gap={0.75}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '3px', background: bg({ kind: k, confirmed: true }) }} />
                  <Typography variant="body2">{v.label} <b>{duration(totals[k])}</b></Typography>
                </Stack>
              ))}
              <Stack component="li" direction="row" alignItems="center" gap={0.75}>
                <Box sx={{ width: 12, height: 12, borderRadius: '3px', background: bg({ kind: 'unplanned', confirmed: false }) }} />
                <Typography variant="body2">Striped = reason still to confirm</Typography>
              </Stack>
            </Stack>
            {view === 'bar' ? <TimeBar shift={data.shift} until={data.until} segments={data.segments} /> : <TimeList segments={data.segments} />}
            {isNow && <Typography variant="caption" color="text.secondary">Shift in progress, the black line is now. Updates every 30 s.</Typography>}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
