// "3D Floor": a gamified view of the production floor. Lazy-loaded (see main.jsx) so the 3D bundle
// only loads on this page. Keyboard / screen-reader users and browsers without WebGL get the list view.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, LinearProgress, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery,
} from '@mui/material';
import ViewInArIcon from '@mui/icons-material/ViewInArOutlined';
import ListIcon from '@mui/icons-material/ViewListOutlined';
import { api, useCollection, useGet, useLive } from '../api.js';
import { PageHeader, StatusChip, LevelChip, CategoryLabel, TypeChip, Mono, duration, num, pct, time } from '../ui.jsx';
import { C, CATEGORIES, LEVELS } from '../theme.js';
import FloorScene, { layout, overview, useNow, viewOfLine } from './FloorScene.jsx';

const STALE_MIN = 15; // a stop waiting longer than this for its reason turns the counter red
const BREAK = 'Operator break';

const hasWebGL = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
})();

export default function Floor() {
  const { live, error } = useLive();
  const machines = useCollection('machines');
  const operators = useCollection('operators');
  const skills = useCollection('skills');
  const reasons = useCollection('reasons');
  const points = useGet('/points');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [view, setView] = useState(hasWebGL ? '3d' : 'list');
  const [selected, setSelected] = useState(null);
  const [celebrate, setCelebrate] = useState({}); // machineId -> { key, points }
  const goal = useRef(null);
  const now = useNow(5000);

  useEffect(() => {
    const t = setInterval(points.reload, 10000);
    return () => clearInterval(t);
  }, [points.reload]);

  // Master data + live row + crew (operators at skill level 2 "Can run" or higher, as on the Machines page).
  const rows = useMemo(() => {
    const byId = new Map((live?.machines ?? []).map((x) => [x.id, x]));
    const ops = new Map(operators.rows.map((o) => [o.id, o]));
    const merged = machines.rows.map((m) => ({
      ...m,
      ...byId.get(m.id),
      crew: skills.rows
        .filter((s) => s.machineId === m.id && s.level >= 2)
        .map((s) => ops.get(s.operatorId))
        .filter((o) => o?.active !== false && o)
        .sort((a, b) => a.code.localeCompare(b.code)),
    }));
    return layout(merged);
  }, [live, machines.rows, operators.rows, skills.rows]);
  const all = rows.flatMap((r) => r.machines.map((x) => x.m));
  const alarmText = (code) => reasons.rows.find((r) => r.alarmCode === code && code)?.name;
  const waiting = all.reduce((a, m) => a + (m.pending ?? 0), 0);
  const oldest = Math.min(...all.map((m) => m.pendingSince ?? Infinity));
  const stale = waiting > 0 && now - oldest > STALE_MIN * 60e3;
  const sel = all.find((m) => m.id === selected);

  if (error && !live) return <Alert severity="error">Live data unavailable: {error}</Alert>;
  if (!live) return <LinearProgress />;

  return (
    <>
      <PageHeader overline="OVERVIEW" title="3D Floor">
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
          {view === '3d' && <Button onClick={() => (goal.current = overview(rows))}>Reset view</Button>}
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(e, v) => v && setView(v)} aria-label="View">
            <ToggleButton value="3d" disabled={!hasWebGL}><ViewInArIcon fontSize="small" sx={{ mr: 0.5 }} />3D view</ToggleButton>
            <ToggleButton value="list"><ListIcon fontSize="small" sx={{ mr: 0.5 }} />List view</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </PageHeader>
      {!hasWebGL && <Alert severity="info" sx={{ mb: 2 }}>This browser cannot show 3D graphics, so the floor is shown as a list.</Alert>}
      {!all.length && <Alert severity="info" sx={{ mb: 2 }}>No machines yet. Add them under Master data › Machines.</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: view === '3d' ? 9 : 12 }} order={{ xs: 2, lg: 1 }}>
          {view === '3d' ? (
            <Card sx={{ position: 'relative', height: { xs: 520, md: 'calc(100vh - 230px)' }, minHeight: 520, overflow: 'hidden' }}>
              <FloorScene rows={rows} alarmText={alarmText} reduced={reduced} onSelect={(m) => setSelected(m.id)} celebrate={celebrate} goal={goal} />
              {/* fly the camera to a line */}
              <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" sx={{ position: 'absolute', top: 12, left: 12, right: 12, pointerEvents: 'none' }}>
                {rows.map((row) => (
                  <Button key={row.name} size="small" variant="contained" onClick={() => (goal.current = viewOfLine(row))} sx={{ pointerEvents: 'auto', minHeight: 34 }}>
                    {row.name}
                  </Button>
                ))}
              </Stack>
            </Card>
          ) : (
            <FloorList machines={all} now={live.now} onSelect={(m) => setSelected(m.id)} />
          )}
          {view === '3d' && (
            <Typography variant="caption" color="text.secondary" component="p" mt={1}>
              Drag to rotate, scroll to zoom, click a line name to fly to it. Click a machine or operator to submit a downtime reason. Hover a machine for OEE, A, P, Q.
            </Typography>
          )}
        </Grid>
        <Grid size={{ xs: 12, lg: view === '3d' ? 3 : 12 }} order={{ xs: 1, lg: 2 }}>
          <ShiftPanel live={live} points={points.data} waiting={waiting} stale={stale} oldest={oldest} now={now} />
        </Grid>
      </Grid>

      {sel && (
        <SubmitDialog
          machine={sel}
          reasons={reasons.rows}
          onClose={() => setSelected(null)}
          onDone={(pts) => {
            setSelected(null);
            points.reload();
            if (pts) setCelebrate((c) => ({ ...c, [sel.id]: { key: Date.now(), points: pts } }));
          }}
        />
      )}
    </>
  );
}

function ShiftPanel({ live, points, waiting, stale, oldest, now }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="overline" component="div">THIS SHIFT</Typography>
        <Typography variant="h6" component="h2">{live.shift.name} · {time(live.shift.start)}–{time(live.shift.end)}</Typography>

        <Box mt={2} p={1.5} sx={{ borderRadius: 3, bgcolor: stale ? LEVELS.below.bg : waiting ? LEVELS.near.bg : LEVELS.good.bg }}>
          <Typography variant="body2" color="text.secondary">Downtime waiting for a reason</Typography>
          <Typography sx={{ fontSize: 28, fontWeight: 800, color: stale ? LEVELS.below.color : waiting ? LEVELS.near.color : LEVELS.good.color }}>{waiting}</Typography>
          {stale && <Typography variant="body2" color={LEVELS.below.color} fontWeight={700}>Oldest is waiting {duration(now - oldest)} (over {STALE_MIN} min)</Typography>}
        </Box>

        <Typography variant="h6" component="h3" fontSize={15} mt={2.5} mb={1}>Leaderboard</Typography>
        {!points?.rows.length ? (
          <Typography variant="body2" color="text.secondary">No points yet this shift. Submit a downtime reason: +10 within 5 min of the stop, +5 later.</Typography>
        ) : (
          <Stack component="ol" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {points.rows.map((p, i) => (
              <Stack component="li" key={p.operatorId} direction="row" alignItems="center" gap={1.5}>
                <Box sx={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, bgcolor: i === 0 ? '#FFB300' : C.light, color: i === 0 ? '#0F172A' : C.blueDark }}>{i + 1}</Box>
                <Box flex={1} minWidth={0}>
                  <Typography noWrap fontWeight={600}>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{p.code} · {p.submissions} reason{p.submissions > 1 ? 's' : ''}</Typography>
                </Box>
                <Typography fontWeight={800} color="primary">{p.points} pts</Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

// 2D fallback: the same information and actions, reachable by keyboard and screen readers.
function FloorList({ machines, now, onSelect }) {
  return (
    <Card>
      <Box sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 820 }}>
          <TableHead>
            <TableRow>
              <TableCell>Line</TableCell><TableCell>Machine</TableCell><TableCell>Status</TableCell><TableCell>OEE</TableCell>
              <TableCell align="right">Good / Total</TableCell><TableCell>Operators</TableCell><TableCell>Downtime</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {machines.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.line || 'No line'}</TableCell>
                <TableCell><Mono fontWeight={700}>{m.code}</Mono> · {m.name}</TableCell>
                <TableCell><StatusChip status={m.active ? m.status : 'inactive'} /></TableCell>
                <TableCell>
                  <Stack direction="row" gap={1} alignItems="center"><b>{pct(m.oee)}</b><LevelChip value={m.oee} target={m.targets?.oee} /></Stack>
                </TableCell>
                <TableCell align="right">{num(m.total - m.ng)} / {num(m.total)}</TableCell>
                <TableCell>{m.crew.map((o) => o.name).join(', ') || '—'}</TableCell>
                <TableCell>
                  {m.openStop ? (
                    <Button size="small" variant="contained" color="error" onClick={() => onSelect(m)}>Stopped {duration(now - m.openStop.start)} · submit reason</Button>
                  ) : m.pending ? (
                    <Button size="small" variant="outlined" onClick={() => onSelect(m)}>{m.pending} waiting · submit reason</Button>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Card>
  );
}

// Reason for the stop happening now (or the latest one still waiting), with big buttons for gloved hands.
function SubmitDialog({ machine, reasons, onClose, onDone }) {
  const pending = useGet(`/machines/${machine.id}/downtime/pending`);
  const event = pending.data?.find((e) => e.end == null) ?? pending.data?.[0];
  const [code, setCode] = useState(null);
  const [operatorId, setOperatorId] = useState(machine.crew[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const now = useNow();
  const pick = code ?? event?.suggested ?? '';

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api(`/machines/${machine.id}/downtime/${event.id}`, { method: 'PUT', body: { reasonCode: pick, comment: note, operatorId: operatorId || undefined } });
      onDone(res.points);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Typography variant="overline" component="div">SUBMIT DOWNTIME REASON · {machine.line || 'No line'}</Typography>
        <Typography variant="h5" component="span">{machine.code} · {machine.name}</Typography>
      </DialogTitle>
      <DialogContent>
        {pending.loading && !pending.data && <LinearProgress />}
        {pending.error && <Alert severity="error">{pending.error}</Alert>}
        {pending.data && !event && <Typography color="text.secondary">No stop on {machine.code} is waiting for a reason.</Typography>}
        {event && (
          <Stack spacing={2.5} pt={1}>
            <Stack direction="row" flexWrap="wrap" gap={3}>
              <Box><Typography variant="overline" component="div">ALARM</Typography><Typography fontWeight={700}>{event.alarmCode || 'none'} · {event.suggested ? reasons.find((r) => r.code === event.suggested)?.name : 'no alarm text'}</Typography></Box>
              <Box><Typography variant="overline" component="div">STOPPED AT</Typography><Typography fontWeight={700}>{new Date(event.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Typography></Box>
              <Box><Typography variant="overline" component="div">DURATION</Typography><Typography fontWeight={700}>{duration((event.end ?? now) - event.start)}{!event.end && ' · still stopped'}</Typography></Box>
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}

            <Box>
              <Typography fontWeight={700} mb={1}>Reason</Typography>
              <Stack spacing={1.5}>
                {CATEGORIES.map((c) => {
                  const rs = reasons.filter((r) => r.category === c.name);
                  if (!rs.length) return null;
                  const locked = c.name === BREAK && !event.breakAllowed;
                  return (
                    <Box key={c.name}>
                      <Typography variant="body2" color="text.secondary" mb={0.5} component="div">
                        <CategoryLabel name={c.name} />{locked && ' · only for a stop within the break tolerance of a scheduled break'}
                      </Typography>
                      <Grid container spacing={1}>
                        {rs.map((r) => (
                          <Grid key={r.code} size={{ xs: 12, sm: 6, md: 4 }}>
                            <Button
                              fullWidth
                              disabled={locked}
                              variant={pick === r.code ? 'contained' : 'outlined'}
                              onClick={() => setCode(r.code)}
                              aria-pressed={pick === r.code}
                              sx={{ minHeight: 56, justifyContent: 'flex-start', textAlign: 'left', gap: 1 }}
                            >
                              <Box flex={1}>{r.name}</Box>
                              {r.type === 'planned' && <TypeChip type="planned" />}
                            </Button>
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  );
                })}
              </Stack>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
              <TextField
                select
                label="Submitted by"
                value={operatorId}
                onChange={(e) => setOperatorId(e.target.value)}
                helperText={machine.crew.length ? 'Points go to this operator.' : 'No operator assigned to this machine, so no points.'}
                slotProps={{ select: { native: true } }}
                sx={{ minWidth: 220 }}
              >
                <option value="">Not an operator (no points)</option>
                {machine.crew.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}
              </TextField>
              <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
            </Stack>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        {event && <Button variant="contained" onClick={submit} disabled={!pick || saving} sx={{ minHeight: 48 }}>Submit reason</Button>}
      </DialogActions>
    </Dialog>
  );
}
