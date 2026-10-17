// Settings: how Dr. Macx Live behaves at every press (more settings can join this page later).
import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api, useGet } from '../api.js';
import { PageHeader } from '../ui.jsx';

const EVERY = [[0, 'Off (only when the operator asks)'], [30, 'Every 30 minutes'], [60, 'Every hour'], [120, 'Every 2 hours'], [240, 'Every 4 hours']];

export default function Settings() {
  const { data, error } = useGet('/settings');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => void (data && setForm(data)), [data]);
  const save = async () => {
    try {
      setForm(await api('/settings', { method: 'PUT', body: form }));
      setMsg({ severity: 'success', text: 'Saved.' });
    } catch (e) {
      setMsg({ severity: 'error', text: e.message });
    }
  };
  return (
    <>
      <PageHeader overline="MASTER DATA" title="Settings" tour="settings">
        <Button variant="contained" onClick={save} disabled={!form}>Save changes</Button>
      </PageHeader>
      {(error || msg) && <Alert severity={error ? 'error' : msg.severity} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{error || msg.text}</Alert>}
      {form && (
        <Card sx={{ maxWidth: 720 }}>
          <CardContent>
            <Typography variant="h6" component="h2">Dr. Macx Live</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Besides stops, sensor alerts, questions and shift handovers, the machine gives its own advice (read by Gemini from its sensors,
              stops and output) on this schedule. Each advice is one Gemini call per machine.
            </Typography>
            <Stack spacing={2}>
              <TextField data-tour="settings-advice" select label="Advice from the machine" value={form.adviceEveryMin ?? 60} onChange={(e) => setForm({ ...form, adviceEveryMin: Number(e.target.value) })} sx={{ maxWidth: 360 }}>
                {EVERY.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
              </TextField>
              <Typography variant="caption" color="text.secondary">
                In demo mode the kiosk also has an “Advice now” button. The operator can always ask with “Ask Dr. Macx”.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}
    </>
  );
}
