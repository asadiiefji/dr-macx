import { useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton,
  MenuItem, Stack, Switch, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { api, useCollection } from '../api.js';
import { PageHeader, Mono, SkillChip } from '../ui.jsx';
import { TourButton } from '../Tour.jsx';
import { KPIS, LEVELS, MONO, SKILLS } from '../theme.js';
import { SETUP_TEXT, sensorsFor, useSensorCatalog } from '../sensors.js';

const BLANK = {
  code: '', name: '', line: '', area: '', idealCycleTime: '', active: true, source: 'dummy',
  kepware: { endpoint: '', channel: '', device: '' },
  setup: 'essential', frameType: 'c-frame', ratedTonnage: 160, nodes: 2, nodeTolerancePct: 5, motorFla: '',
  sensorTags: {},
  targets: {
    oee: { target: 85, margin: 5 },
    availability: { target: 90, margin: 5 },
    performance: { target: 95, margin: 5 },
    quality: { target: 99, margin: 1 },
  },
};
const SOURCE = { dummy: 'Dummy generator', kepware: 'Kepware (PLC)' };
const lineArea = (m) => [m.line, m.area].filter(Boolean).join(' · ') || '—';

export default function Machines() {
  const { rows, error, reload } = useCollection('machines');
  const operators = useCollection('operators');
  const skills = useCollection('skills');
  const [edit, setEdit] = useState(null);

  const crew = (id) => skills.rows.filter((s) => s.machineId === id && s.level >= 2).length;
  const remove = async (m) => {
    if (!window.confirm(`Delete machine ${m.code}? Its OEE history, stops, messages and skill-matrix entries are deleted too. This cannot be undone. To stop monitoring it but keep its history, switch Active off instead.`)) return;
    await api(`/machines/${m.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    reload();
    skills.reload();
  };

  return (
    <>
      <PageHeader overline="MASTER DATA" title="Machines" tour="machines">
        <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setEdit(BLANK)}>Add machine</Button>
      </PageHeader>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {rows.filter((m) => m.cycleSuggestion?.status === 'pending').map((m) => <CycleSuggestion key={m.id} m={m} onDone={reload} />)}
      <TableContainer component={Card} data-tour="mach-table">
        <Table sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell><TableCell>Name</TableCell><TableCell>Line / Area</TableCell>
              <TableCell align="right">Ideal CT (s)</TableCell><TableCell>Machine type</TableCell><TableCell>Sensors</TableCell><TableCell>Data source</TableCell><TableCell>Monitoring</TableCell>
              <TableCell align="right">Operators</TableCell><TableCell aria-label="Actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {[...rows].sort((a, b) => a.code.localeCompare(b.code)).map((m) => (
                <TableRow key={m.id} hover onClick={() => setEdit({ ...BLANK, ...m, targets: { ...BLANK.targets, ...m.targets } })} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ fontFamily: MONO, fontWeight: 600, whiteSpace: 'nowrap' }}>{m.code}</TableCell>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{lineArea(m)}</TableCell>
                  <TableCell align="right"><Mono>{m.idealCycleTime}</Mono></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{m.ratedTonnage ?? '—'} t · {m.frameType ?? '—'}</TableCell>
                  <TableCell><Chip size="small" label={SETUP_TEXT[m.setup ?? 'essential'].label} color={m.setup === 'premium' ? 'primary' : 'default'} sx={{ fontWeight: 700 }} /></TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={SOURCE[m.source]} sx={{ fontWeight: 600 }} /></TableCell>
                  <TableCell>{m.active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell align="right"><Mono>{crew(m.id)}</Mono></TableCell>
                  <TableCell align="right">
                    <IconButton aria-label={`Delete ${m.code}`} onClick={(e) => (e.stopPropagation(), remove(m))}><DeleteIcon /></IconButton>
                  </TableCell>
                </TableRow>
            ))}
            {!rows.length && (
              <TableRow><TableCell colSpan={10}><Typography color="text.secondary">No machines yet. Add the first one to start monitoring.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="body2" color="text.secondary" mt={1}>Operators = people at level 2 (Can run) or higher. Live values are under Monitoring.</Typography>

      {edit && (
        <MachineDialog
          machine={edit}
          operators={operators.rows}
          skills={skills.rows}
          onClose={() => setEdit(null)}
          onSaved={() => (setEdit(null), reload(), skills.reload())}
        />
      )}
    </>
  );
}

// The press learned a different best cycle time from its sensors; a supervisor decides.
function CycleSuggestion({ m, onDone }) {
  const s = m.cycleSuggestion;
  const decide = (approve) => api(`/machines/${m.id}/cycle-time`, { method: 'POST', body: { approve } }).then(onDone, (e) => alert(e.message));
  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" onClick={() => decide(false)}>Reject</Button>
          <Button variant="contained" size="small" onClick={() => decide(true)}>Approve {s.to} s</Button>
        </Stack>
      }
    >
      <b>{m.code}</b>: its best steady stroke over the last 3 shifts was <b>{s.to} s</b> per piece, but the ideal cycle time is <b>{s.from} s</b>.
      Approving changes the ideal cycle time used for Performance. <Typography component="span" variant="caption" color="text.secondary">({s.samples} stable samples from {s.source})</Typography>
    </Alert>
  );
}

// On-demand check of the ideal cycle time against the stroke history.
function CycleCheck({ id }) {
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const r = await api(`/machines/${id}/cycle-time/learn`, { method: 'POST' });
      const p = r.suggestion ?? r.pending;
      setOut({
        severity: p ? 'info' : 'success',
        text: !r.best
          ? 'Not enough steady running in the last 3 shifts to learn from yet.'
          : p
            ? `Best steady stroke: ${r.best.seconds} s per piece. A suggestion to change ${p.from} s → ${p.to} s waits for approval on the Machines page.`
            : `Best steady stroke: ${r.best.seconds} s per piece, within 5 % of the ideal cycle time (or recently rejected). No change needed.`,
      });
    } catch (e) {
      setOut({ severity: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={1} alignItems="flex-start">
      <Button variant="outlined" size="small" onClick={check} disabled={busy}>{busy ? 'Checking…' : 'Check against the sensors'}</Button>
      {out && <Alert severity={out.severity} sx={{ width: '100%' }}>{out.text}</Alert>}
    </Stack>
  );
}

function MachineDialog({ machine, operators, skills, onClose, onSaved }) {
  const [m, setM] = useState(machine);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState('');
  const [levels, setLevels] = useState({}); // operatorId -> changed level
  const set = (patch) => setM((x) => ({ ...x, ...patch }));
  const setKep = (patch) => setM((x) => ({ ...x, kepware: { ...x.kepware, ...patch } }));
  const setTag = (key, v) => setM((x) => ({ ...x, sensorTags: { ...x.sensorTags, [key]: v } }));
  const catalog = useSensorCatalog();
  const sensors = sensorsFor(m, catalog);
  const setTarget = (key, patch) => setM((x) => ({ ...x, targets: { ...x.targets, [key]: { ...x.targets[key], ...patch } } }));
  const levelOf = (opId) => levels[opId] ?? skills.find((s) => s.operatorId === opId && s.machineId === m.id)?.level ?? 0;

  // An example Kepware device name for the placeholders, from the machine code: PRS-03 -> Press03.
  const exampleDevice = `Press${m.code?.match(/\d+/)?.[0] ?? '01'}`;
  const fillTags = () => {
    const { channel, device } = m.kepware;
    if (!channel || !device) return setError('Enter Channel and Device first.');
    setError('');
    setM((x) => ({ ...x, sensorTags: Object.fromEntries(sensors.map((t) => [t.id, `${channel}.${device}.${t.tag}`])) }));
  };

  const save = async () => {
    try {
      const saved = await api(m.id ? `/machines/${m.id}` : '/machines', { method: m.id ? 'PUT' : 'POST', body: m });
      await Promise.all(
        Object.entries(levels).map(([operatorId, level]) => api('/skills', { method: 'PUT', body: { operatorId, machineId: saved.id, level } })),
      );
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 0 }}>
        <Typography variant="overline" component="div">{m.id ? 'EDIT MACHINE' : 'NEW MACHINE'}</Typography>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="h5" component="span">{m.code ? `${m.code} · ${m.name}` : 'New machine'}</Typography>
          <TourButton id="machineEdit" />
        </Stack>
      </DialogTitle>
      <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Identity" data-tour="edit-tab-0" /><Tab label="OEE parameters" data-tour="edit-tab-1" /><Tab label="Machine & sensors" data-tour="edit-tab-2" /><Tab label="Connection & tags" data-tour="edit-tab-3" /><Tab label="Operators" data-tour="edit-tab-4" />
      </Tabs>
      <DialogContent sx={{ minHeight: 380 }}>
        <Stack spacing={2.5} pt={1}>
          {error && <Alert severity="error">{error}</Alert>}

          {tab === 0 && (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Machine code" required value={m.code} onChange={(e) => set({ code: e.target.value })} helperText="e.g. PRS-03" slotProps={{ htmlInput: { style: { fontFamily: MONO } } }} sx={{ flex: 1 }} />
                <TextField label="Machine name" required value={m.name} onChange={(e) => set({ name: e.target.value })} helperText="e.g. Machine 03 · 400T straight-side" sx={{ flex: 2 }} />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Line" value={m.line} onChange={(e) => set({ line: e.target.value })} helperText="e.g. Line 2" sx={{ flex: 1 }} />
                <TextField label="Area / process" value={m.area} onChange={(e) => set({ area: e.target.value })} helperText="e.g. Stamping" sx={{ flex: 1 }} />
              </Stack>
              <FormControlLabel control={<Switch checked={m.active} onChange={(e) => set({ active: e.target.checked })} />} label="Active — monitor this machine" />
            </>
          )}

          {tab === 1 && (
            <>
              <TextField
                label="Ideal cycle time (seconds per piece)"
                required
                type="number"
                value={m.idealCycleTime}
                onChange={(e) => set({ idealCycleTime: e.target.value })}
                helperText="Fastest designed time for one piece — used for Performance."
                slotProps={{ htmlInput: { min: 0.1, step: 0.1 } }}
                sx={{ maxWidth: 360 }}
              />
              {m.id && <CycleCheck id={m.id} />}
              <Box>
                <Typography fontWeight={700}>Targets and tolerance</Typography>
                <Typography variant="body2" color="text.secondary" mb={1.5}>
                  <b style={{ color: LEVELS.good.color }}>Green</b> at or above target · <b style={{ color: LEVELS.near.color }}>yellow</b> within the tolerance below it ·{' '}
                  <b style={{ color: LEVELS.below.color }}>red</b> below target − tolerance.
                </Typography>
                <Stack spacing={1.5}>
                  {KPIS.map((k) => (
                    <Stack key={k.key} direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                      <Typography sx={{ flex: 1, fontWeight: 600 }}>{k.label}</Typography>
                      <TextField size="small" type="number" label="Target %" value={m.targets[k.key].target} onChange={(e) => setTarget(k.key, { target: e.target.value })} slotProps={{ htmlInput: { min: 1, max: 100, step: 0.1 } }} sx={{ width: 140 }} />
                      <TextField size="small" type="number" label="Tolerance (pts)" value={m.targets[k.key].margin} onChange={(e) => setTarget(k.key, { margin: e.target.value })} slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }} sx={{ width: 160 }} />
                      <Typography variant="body2" color="text.secondary" sx={{ width: 150 }}>Red below {Number(m.targets[k.key].target) - Number(m.targets[k.key].margin)}%</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              <Alert severity="info" icon={false}>
                OEE is calculated per shift (Shift 1 07:00–15:00, Shift 2 15:00–23:00, Shift 3 23:00–07:00).<br />
                <b>Availability</b> = run time ÷ planned time · <b>Performance</b> = ideal CT × total count ÷ run time ·{' '}
                <b>Quality</b> = good ÷ total · <b>OEE</b> = A × P × Q
              </Alert>
            </>
          )}

          {tab === 2 && (
            <>
              <Box>
                <Typography fontWeight={600} mb={1}>Sensor setup</Typography>
                <ToggleButtonGroup exclusive color="primary" value={m.setup} onChange={(e, v) => v && set({ setup: v })}>
                  <ToggleButton value="essential" sx={{ px: 2.5 }}>Essential</ToggleButton>
                  <ToggleButton value="premium" sx={{ px: 2.5 }}>Premium</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="body2" color="text.secondary" mt={1}>{SETUP_TEXT[m.setup]?.text}</Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField select label="Frame" value={m.frameType} onChange={(e) => set({ frameType: e.target.value, nodes: e.target.value === 'straight-side' ? 4 : 2 })} sx={{ flex: 1 }}>
                  <MenuItem value="c-frame">C-frame (gap frame)</MenuItem>
                  <MenuItem value="straight-side">Straight-side</MenuItem>
                </TextField>
                <TextField label="Rated tonnage (t)" type="number" value={m.ratedTonnage} onChange={(e) => set({ ratedTonnage: e.target.value })} sx={{ flex: 1 }} />
                <TextField select label="Tonnage nodes" value={m.nodes} onChange={(e) => set({ nodes: e.target.value })} sx={{ flex: 1 }}>
                  <MenuItem value={2}>2 nodes</MenuItem>
                  <MenuItem value={4}>4 nodes</MenuItem>
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Node tolerance (±%)"
                  type="number"
                  value={m.nodeTolerancePct}
                  onChange={(e) => set({ nodeTolerancePct: e.target.value })}
                  helperText={`Nominal per node ${Math.round((Number(m.ratedTonnage) || 0) / (Number(m.nodes) || 1))} t; outside ±${m.nodeTolerancePct}% is flagged`}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Motor full-load current (A)"
                  type="number"
                  value={m.motorFla}
                  onChange={(e) => set({ motorFla: e.target.value })}
                  helperText="Running ≥ 30 % of this, idle below, off under 1 A. Empty = estimated from tonnage."
                  sx={{ flex: 1 }}
                />
              </Stack>
              <Box>
                <Typography fontWeight={600} mb={1}>Sensors on this machine ({sensors.length})</Typography>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Sensor</TableCell><TableCell>Setup</TableCell><TableCell>Feeds</TableCell></TableRow></TableHead>
                  <TableBody>
                    {sensors.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.label}</TableCell>
                        <TableCell><Chip size="small" variant="outlined" label={SETUP_TEXT[t.setup].label} /></TableCell>
                        <TableCell>{t.feeds ?? (t.warn != null ? `Prediction · warn ${t.warn}${t.unit ? ` ${t.unit}` : ''}` : '—')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}

          {tab === 3 && (
            <>
              <Box>
                <Typography fontWeight={600} mb={1}>Data source</Typography>
                <ToggleButtonGroup exclusive color="primary" value={m.source} onChange={(e, v) => v && set({ source: v })}>
                  <ToggleButton value="dummy" sx={{ px: 2.5, textTransform: 'none', fontWeight: 600 }}>Dummy generator</ToggleButton>
                  <ToggleButton value="kepware" sx={{ px: 2.5, textTransform: 'none', fontWeight: 600 }}>Kepware (PLC)</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              <Alert severity="info" icon={false}>
                {m.source === 'dummy'
                  ? 'Dr. Macx simulates this machine’s sensors every 1 s (as the PLC would send them): strokes, motor current, stops with alarm codes and, on Premium, tonnage, vibration, temperatures, vision NC and acoustic. Tag addresses are optional here — fill them now so you can switch to Kepware later.'
                  : 'The sensors are wired to the PLC. Kepware IoT Gateway on the plant edge PC sends every tag to Dr. Macx each second; the tag addresses below must match its tag IDs. This machine shows "Not connected" while its part count, motor current or alarm tag (and vision NC on Premium) has sent nothing for 10 s.'}
              </Alert>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Kepware endpoint (for reference)" value={m.kepware.endpoint} onChange={(e) => setKep({ endpoint: e.target.value })} placeholder="opc.tcp://192.168.1.10:49320" sx={{ flex: 2 }} />
                <TextField label="Channel" value={m.kepware.channel} onChange={(e) => setKep({ channel: e.target.value })} placeholder="Channel1" sx={{ flex: 1 }} />
                <TextField label="Device" value={m.kepware.device} onChange={(e) => setKep({ device: e.target.value })} placeholder={exampleDevice} sx={{ flex: 1 }} />
              </Stack>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={600}>Tag addresses</Typography>
                <Button onClick={fillTags} sx={{ textDecoration: 'underline' }}>Fill from Channel.Device</Button>
              </Stack>
              {sensors.map((t) => (
                <Stack key={t.id} direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography fontWeight={700}>{t.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{t.unit ? `${t.unit} · ` : ''}{SETUP_TEXT[t.setup].label}</Typography>
                  </Box>
                  <TextField
                    size="small"
                    value={m.sensorTags?.[t.id] ?? ''}
                    onChange={(e) => setTag(t.id, e.target.value)}
                    placeholder={`${m.kepware.channel || 'Channel1'}.${m.kepware.device || exampleDevice}.${t.tag}`}
                    required={m.source === 'kepware'}
                    slotProps={{ htmlInput: { 'aria-label': `${t.label} tag address` } }}
                    sx={{ flex: 2 }}
                  />
                </Stack>
              ))}
            </>
          )}

          {tab === 4 && (
            operators.length ? (
              <>
                <Typography variant="body2" color="text.secondary">Skill level of each operator on this machine. Saved with the machine.</Typography>
                {[...operators].sort((a, b) => a.code.localeCompare(b.code)).map((o) => (
                  <Stack key={o.id} direction="row" alignItems="center" spacing={2}>
                    <Box sx={{ flex: 1 }}><Mono fontWeight={600}>{o.code}</Mono> · {o.name}</Box>
                    <TextField
                      select
                      size="small"
                      value={levelOf(o.id)}
                      onChange={(e) => setLevels({ ...levels, [o.id]: e.target.value })}
                      slotProps={{ htmlInput: { 'aria-label': `Skill of ${o.name}` } }}
                      sx={{ minWidth: 180 }}
                    >
                      {SKILLS.map((s) => <MenuItem key={s.level} value={s.level}><SkillChip level={s.level} /></MenuItem>)}
                    </TextField>
                  </Stack>
                ))}
              </>
            ) : (
              <Typography color="text.secondary">No operators yet. Add them under Master data › Operators.</Typography>
            )
          )}

        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>{m.id ? 'Save changes' : 'Add machine'}</Button>
      </DialogActions>
    </Dialog>
  );
}
