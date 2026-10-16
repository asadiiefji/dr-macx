// Confirming a stop's downtime reason, from the monitoring card or the downtime log.
import { useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, LinearProgress,
  ListSubheader, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import MicIcon from '@mui/icons-material/MicNoneOutlined';
import StopIcon from '@mui/icons-material/StopCircleOutlined';
import AiIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { api, useCollection, useGet } from './api.js';
import { CategoryLabel, Mono, RepeatChip, TypeChip, duration } from './ui.jsx';
import { C, CATEGORIES } from './theme.js';

// Languages operators may speak (browser speech recognition needs the language up front).
export const LANGS = [
  ['id-ID', 'Bahasa Indonesia'], ['ms-MY', 'Bahasa Melayu'], ['vi-VN', 'Tiếng Việt'], ['th-TH', 'ไทย'], ['fil-PH', 'Filipino'],
  ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文'], ['hi-IN', 'हिन्दी'], ['ta-IN', 'தமிழ்'], ['en-US', 'English'],
];
const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

// Operator speaks; the browser turns speech into text in the chosen language.
export function useDictation(lang, onText) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef(null);
  const start = () => {
    const r = new SpeechRecognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => onText([...e.results].slice(e.resultIndex).map((x) => x[0].transcript).join(' '));
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser, or type the note.' : `Speech input stopped (${e.error}).`);
    r.onend = () => setListening(false);
    setError('');
    r.start();
    rec.current = r;
    setListening(true);
  };
  return { supported: !!SpeechRecognition, listening, error, start, stop: () => rec.current?.stop() };
}

const BREAK = 'Operator break';
export const fmtTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Reason list grouped by category, in the fixed category order.
function reasonItems(reasons, event) {
  return CATEGORIES.flatMap((c) => {
    const rs = reasons.filter((r) => r.category === c.name).sort((a, b) => a.code.localeCompare(b.code));
    if (!rs.length) return [];
    const locked = c.name === BREAK && !event.breakAllowed;
    return [
      <ListSubheader key={c.name}>
        <CategoryLabel name={c.name} />
        {locked && <Typography variant="caption" color="text.secondary" ml={1}>only for a stop within the break tolerance of a scheduled break</Typography>}
      </ListSubheader>,
      ...rs.map((r) => (
        <MenuItem key={r.code} value={r.code} disabled={locked}>
          <Mono fontWeight={700}>{r.code}</Mono>&nbsp;· {r.name}
          {r.type === 'planned' && <Box component="span" sx={{ ml: 1 }}><TypeChip type="planned" /></Box>}
        </MenuItem>
      )),
    ];
  });
}

// operatorId (optional): who answers; they earn the points (Machine Soul / 3D Floor).
export function StopForm({ machineId, event, reasons, onSaved, operatorId, lang: kioskLang }) {
  const [code, setCode] = useState(event.reasonCode ?? event.suggested ?? '');
  const [comment, setComment] = useState(event.comment ?? '');
  const [note, setNote] = useState('');
  const [lang, setLang] = useState(LANGS.find(([l]) => l.slice(0, 2) === (kioskLang ?? navigator.language)?.slice(0, 2))?.[0] ?? 'id-ID');
  const [ai, setAi] = useState({ loading: false, result: null, error: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dictation = useDictation(lang, (text) => setNote((n) => `${n} ${text}`.trim()));
  const chosen = reasons.find((r) => r.code === code);

  const suggest = async () => {
    setAi({ loading: true, result: null, error: '' });
    try {
      const result = await api(`/machines/${machineId}/downtime/${event.id}/suggest`, { method: 'POST', body: { note } });
      setAi({ loading: false, result, error: '' });
      if (result.reasonCode) setCode(result.reasonCode);
      if (result.translation || note) setComment(result.translation || note);
    } catch (e) {
      setAi({ loading: false, result: null, error: e.message });
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await api(`/machines/${machineId}/downtime/${event.id}`, { method: 'PUT', body: { reasonCode: code, comment, ...(operatorId && { operatorId }) } });
      onSaved();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };
  const r = ai.result;
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1}>
        <Typography fontWeight={700}>{fmtTime(event.start)}</Typography>
        <Typography color="text.secondary">· {event.end ? duration(event.end - event.start) : 'still stopped'}</Typography>
        <Typography color="text.secondary">· alarm <Mono fontWeight={700}>{event.alarmCode || 'none'}</Mono></Typography>
        {event.breakAllowed && <Chip size="small" label="At a scheduled break" sx={{ bgcolor: '#E1F5FE', color: '#01579B' }} />}
        <RepeatChip event={event} />
      </Stack>

      {/* Operator note by voice or text, any language: Gemma translates it and suggests the reason. */}
      <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: '#F8FAFC', border: `1px solid ${C.line}` }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'flex-start' }}>
          <TextField
            size="small"
            label="Operator note (speak or type, any language)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            maxRows={4}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            sx={{ flex: 1 }}
          />
          {dictation.supported && (
            <>
              <TextField select size="small" label="Spoken language" value={lang} onChange={(e) => setLang(e.target.value)} sx={{ minWidth: 160 }} disabled={dictation.listening}>
                {LANGS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
              </TextField>
              <Tooltip title={dictation.listening ? 'Stop recording' : 'Record the operator'}>
                <IconButton
                  aria-label={dictation.listening ? 'Stop recording' : 'Record the operator'}
                  onClick={dictation.listening ? dictation.stop : dictation.start}
                  sx={{ border: `1px solid ${C.line}`, color: dictation.listening ? 'error.main' : 'primary.main', width: 44, height: 40 }}
                >
                  {dictation.listening ? <StopIcon /> : <MicIcon />}
                </IconButton>
              </Tooltip>
            </>
          )}
          <Button variant="outlined" startIcon={ai.loading ? <CircularProgress size={16} /> : <AiIcon />} onClick={suggest} disabled={ai.loading} sx={{ flex: 'none' }}>
            Suggest with Gemma
          </Button>
        </Stack>
        {dictation.listening && <Typography variant="caption" color="error.main" mt={0.5} component="div">Recording… speak, then press stop.</Typography>}
        {dictation.error && <Typography variant="caption" color="error" component="div" mt={0.5}>{dictation.error}</Typography>}
        {ai.error && <Alert severity="error" sx={{ mt: 1 }}>{ai.error}</Alert>}
        {r && (
          <Stack spacing={0.5} mt={1.25}>
            {r.translation && (
              <Typography variant="body2"><b>Translation{r.language ? ` (${r.language})` : ''}:</b> {r.translation}</Typography>
            )}
            <Typography variant="body2">
              <b>Gemma suggests:</b> {r.reasonCode ? `${r.reasonCode} · ${reasons.find((x) => x.code === r.reasonCode)?.name ?? ''}` : 'no fitting reason; pick one'}
              {r.confidence != null && ` (${Math.round(Number(r.confidence) * 100)}% sure)`}
            </Typography>
            {r.rationale && <Typography variant="body2" color="text.secondary">Why: {r.rationale}</Typography>}
            {r.machineCondition && <Typography variant="body2" color="text.secondary">Machine: {r.machineCondition}</Typography>}
            <Typography variant="caption" color="text.secondary">Suggested by {r.model}. Check it, then confirm.</Typography>
          </Stack>
        )}
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} alignItems={{ sm: 'flex-start' }}>
        <TextField
          select
          size="small"
          label="Downtime reason"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          helperText={chosen ? (chosen.type === 'planned' ? 'Planned: excluded from OEE.' : 'Unplanned: counts as a loss in OEE.') : event.suggested ? 'Suggested from the PLC alarm.' : ' '}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          sx={{ flex: 2 }}
        >
          <MenuItem value="" disabled>Pick a reason</MenuItem>
          {reasonItems(reasons, event)}
        </TextField>
        <TextField size="small" label="Comment (English)" value={comment} onChange={(e) => setComment(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} sx={{ flex: 2 }} />
        <Button variant="contained" onClick={save} disabled={!code || saving} sx={{ flex: 'none' }}>Confirm</Button>
      </Stack>
    </Stack>
  );
}

// All stops of one machine still waiting for a confirmed reason.
export function PendingDialog({ machine, onClose }) {
  const pending = useGet(`/machines/${machine.id}/downtime/pending`);
  const reasons = useCollection('reasons');
  const list = pending.data ?? [];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Typography variant="overline" component="div">DOWNTIME TO CONFIRM · {machine.code}</Typography>
        <Typography variant="h5" component="span">{list.length ? `${list.length} stop${list.length > 1 ? 's' : ''} need a reason` : 'All stops confirmed'}</Typography>
      </DialogTitle>
      <DialogContent>
        {pending.loading && !pending.data && <LinearProgress />}
        {pending.error && <Alert severity="error">{pending.error}</Alert>}
        {pending.data && !list.length && <Typography color="text.secondary">Every stop on {machine.code} has a confirmed reason.</Typography>}
        <Stack divider={<Divider />} spacing={2} pt={1}>
          {list.map((e) => <StopForm key={e.id} machineId={machine.id} event={e} reasons={reasons.rows} onSaved={pending.reload} />)}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

// One stop from the downtime log: confirm it, or change an already confirmed reason.
export function ConfirmDialog({ machineId, event, onClose, onSaved }) {
  const reasons = useCollection('reasons');
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Typography variant="overline" component="div">{event.confirmed ? 'CHANGE DOWNTIME REASON' : 'CONFIRM DOWNTIME REASON'}</Typography>
        <Typography variant="h5" component="span">{event.reason}</Typography>
      </DialogTitle>
      <DialogContent>
        <Box pt={1}>{reasons.rows.length > 0 && <StopForm machineId={machineId} event={event} reasons={reasons.rows} onSaved={onSaved} />}</Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose}>Cancel</Button></DialogActions>
    </Dialog>
  );
}
