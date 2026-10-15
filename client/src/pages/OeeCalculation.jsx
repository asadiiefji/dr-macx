import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, IconButton, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { api, useGet } from '../api.js';
import { PageHeader } from '../ui.jsx';

export default function OeeCalculation() {
  const { data, error } = useGet('/settings');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null); // { severity, text }

  useEffect(() => void (data && setForm(data)), [data]);

  const setBreak = (i, patch) => setForm((f) => ({ ...f, breaks: f.breaks.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const save = async () => {
    try {
      setForm(await api('/settings', { method: 'PUT', body: form }));
      setMsg({ severity: 'success', text: 'Saved. OEE uses the new breaks from now on.' });
    } catch (e) {
      setMsg({ severity: 'error', text: e.message });
    }
  };

  return (
    <>
      <PageHeader overline="MASTER DATA" title="OEE calculation">
        <Button variant="contained" onClick={save} disabled={!form}>Save changes</Button>
      </PageHeader>
      {(error || msg) && <Alert severity={error ? 'error' : msg.severity} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{error || msg.text}</Alert>}

      {form && (
        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Typography variant="h6" component="h2">How OEE is calculated</Typography>
              <Typography variant="body2" color="text.secondary" mt={1} lineHeight={1.7}>
                Per shift: Shift 1 07:00–15:00 · Shift 2 15:00–23:00 · Shift 3 23:00–07:00.<br />
                <b>Planned time</b> = shift time − planned breaks · <b>Availability</b> = run time ÷ planned time ·{' '}
                <b>Performance</b> = ideal cycle time × total count ÷ run time · <b>Quality</b> = good ÷ total ·{' '}
                <b>OEE</b> = A × P × Q. A stop outside a planned break is recorded as downtime and waits for a confirmed reason.<br />
                Targets and tolerance are set per machine (Machines › OEE parameters); downtime reasons under Master data › Downtime reasons.
              </Typography>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="h6" component="h2">Planned breaks</Typography>
                <Button startIcon={<AddIcon />} onClick={() => setForm({ ...form, breaks: [...form.breaks, { name: '', start: '12:00', end: '12:30' }] })}>Add break</Button>
              </Stack>
              <Typography variant="body2" color="text.secondary" mb={2}>Same times every day. Break time is not planned time, so it never lowers Availability.</Typography>
              <TextField
                type="number"
                label="Break tolerance (minutes)"
                value={form.breakToleranceMin ?? 5}
                onChange={(e) => setForm({ ...form, breakToleranceMin: e.target.value })}
                helperText="A stop up to this many minutes before or after a break may be given an Operator-break reason (early stop / late return)."
                slotProps={{ htmlInput: { min: 0, max: 30, step: 1 } }}
                sx={{ mb: 2.5, maxWidth: 520 }}
              />
              <Stack spacing={2}>
                {form.breaks.map((b, i) => (
                  <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                    <TextField label="Name" value={b.name} onChange={(e) => setBreak(i, { name: e.target.value })} sx={{ flex: 2 }} placeholder="Shift 1 lunch" />
                    <TextField label="Start" type="time" value={b.start} onChange={(e) => setBreak(i, { start: e.target.value })} sx={{ flex: 1 }} />
                    <TextField label="End" type="time" value={b.end} onChange={(e) => setBreak(i, { end: e.target.value })} sx={{ flex: 1 }} />
                    <Box>
                      <IconButton aria-label={`Remove ${b.name || 'break'}`} onClick={() => setForm({ ...form, breaks: form.breaks.filter((_, j) => j !== i) })}><DeleteIcon /></IconButton>
                    </Box>
                  </Stack>
                ))}
                {!form.breaks.length && <Typography color="text.secondary">No planned breaks. Every minute of the shift counts as planned time.</Typography>}
              </Stack>
            </CardContent>
          </Card>

        </Stack>
      )}
    </>
  );
}

