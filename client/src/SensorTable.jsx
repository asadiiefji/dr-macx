// A press's sensors with their PLC tag, live value and OK / Warning / Alarm, plus NC entry for Essential presses.
import { useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { api } from './api.js';
import { Mono, num } from './ui.jsx';
import { LEVELS } from './theme.js';
import { MOTOR, sensorsFor, useSensorCatalog, valueOf } from './sensors.js';
import { useT } from './i18n.jsx';

const STATE = { ok: { ...LEVELS.good, label: 'OK' }, warn: { ...LEVELS.near, label: 'Warning' }, alarm: { ...LEVELS.below, label: 'Alarm' } };

export function StateChip({ state }) {
  const t = useT();
  const s = STATE[state];
  return s ? <Chip size="small" label={t(s.label)} sx={{ bgcolor: s.bg, color: s.color, fontWeight: 700 }} /> : null;
}

const show = (s, v, m) => {
  if (v == null) return '—';
  if (s.id === 'motorCurrent') return `${num(v)} A · ${MOTOR[m.motor] ?? ''}`;
  if (s.id === 'alarm') return v ? `Alarm ${v}` : 'No alarm';
  if (s.id === 'ioFaults') return v ? `${v} proximity fault` : 'All healthy';
  return `${num(v)}${s.unit ? ` ${s.unit}` : ''}`;
};

// m = live row (readings, sensorStatus, nodes, setup, motor); master = machine master data (sensorTags).
export default function SensorTable({ m, master, onPick, picked }) {
  const catalog = useSensorCatalog();
  const sensors = sensorsFor(m, catalog);
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow><TableCell>Sensor</TableCell><TableCell>PLC tag</TableCell><TableCell align="right">Value</TableCell><TableCell>State</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {sensors.map((s) => (
            <TableRow key={s.id} hover={!!onPick} selected={picked === s.id} onClick={onPick && (() => onPick(s))} sx={{ cursor: onPick ? 'pointer' : 'default' }}>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>{s.short}</Typography>
                <Typography variant="caption" color="text.secondary">{s.label}</Typography>
              </TableCell>
              <TableCell><Mono sx={{ fontSize: 12 }}>{master?.sensorTags?.[s.id] || '—'}</Mono></TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{show(s, valueOf(m.readings, s), m)}</TableCell>
              <TableCell><StateChip state={m.sensorStatus?.[s.id]} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

// Essential presses have no vision camera: the operator logs NC pieces here.
export function NcEntry({ machineId, operatorId, onDone }) {
  const t = useT();
  const [count, setCount] = useState('');
  const [msg, setMsg] = useState(null);
  const save = async () => {
    try {
      await api(`/machines/${machineId}/nc`, { method: 'POST', body: { count: Number(count), operatorId } });
      setMsg({ severity: 'success', text: `${count} NC · ${t('logged')}` });
      setCount('');
      onDone?.();
    } catch (e) {
      setMsg({ severity: 'error', text: e.message });
    }
  };
  return (
    <Box>
      <Stack direction="row" gap={1} alignItems="flex-start">
        <TextField size="small" type="number" label={t('NC pieces found')} value={count} onChange={(e) => setCount(e.target.value)} slotProps={{ htmlInput: { min: 1, max: 10000 } }} sx={{ width: 170 }} />
        <Button variant="outlined" onClick={save} disabled={!(Number(count) >= 1)}>{t('Log NC')}</Button>
      </Stack>
      {msg && <Alert severity={msg.severity} sx={{ mt: 1 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
    </Box>
  );
}
