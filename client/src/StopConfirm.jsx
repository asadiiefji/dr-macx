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
import { useT } from './i18n.jsx';

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
function reasonItems(reasons, event, t) {
  return CATEGORIES.flatMap((c) => {
    const rs = reasons.filter((r) => r.category === c.name).sort((a, b) => a.code.localeCompare(b.code));
    if (!rs.length) return [];
    const locked = c.name === BREAK && !event.breakAllowed;
    return [
      <ListSubheader key={c.name}>
        <CategoryLabel name={c.name} label={t(c.name)} />
        {locked && <Typography variant="caption" color="text.secondary" ml={1}>{t('only for a stop within the break tolerance of a scheduled break')}</Typography>}
      </ListSubheader>,
      ...rs.map((r) => (
        <MenuItem key={r.code} value={r.code} disabled={locked}>
          <Mono fontWeight={700}>{r.code}</Mono>&nbsp;· {t(r.name)}
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
  const t = useT();

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
  const ctl = { minHeight: 36, py: 0, borderRadius: '8px' }; // compact controls, same height in a row
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={0.5}>
        <Typography variant="body2" fontWeight={700}>{fmtTime(event.start)}</Typography>
        <Typography variant="body2" color="text.secondary">· {event.end ? duration(event.end - event.start) : t('still stopped')}</Typography>
        <Typography variant="body2" color="text.secondary">· {t('alarm')} <Mono fontWeight={700}>{event.alarmCode || t('none')}</Mono></Typography>
        {event.breakAllowed && <Chip size="small" label={t('At a scheduled break')} sx={{ bgcolor: '#E1F5FE', color: '#01579B' }} />}
        <RepeatChip event={event} />
      </Stack>

      {/* Operator note by voice or text, any language: Gemini translates it and suggests the reason.
          The note takes the full width; language, mic and the Gemini button sit in one row below it. */}
      <Box sx={{ p: 1.25, borderRadius: '8px', bgcolor: '#F8FAFC', border: `1px solid ${C.line}` }}>
        <TextField
          size="small"
          fullWidth
          label={t('Operator note (speak or type, any language)')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          multiline
          minRows={2}
          maxRows={4}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
          sx={{ bgcolor: '#FFFFFF' }}
        />
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" mt={1}>
          {dictation.supported && (
            <>
              <TextField select size="small" label={t('Spoken language')} value={lang} onChange={(e) => setLang(e.target.value)} disabled={dictation.listening} sx={{ minWidth: 150, bgcolor: '#FFFFFF' }}>
                {LANGS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
              </TextField>
              <Tooltip title={t(dictation.listening ? 'Stop recording' : 'Record the operator')}>
                <IconButton
                  aria-label={t(dictation.listening ? 'Stop recording' : 'Record the operator')}
                  onClick={dictation.listening ? dictation.stop : dictation.start}
                  sx={{ border: `1px solid ${C.line}`, borderRadius: '8px', bgcolor: '#FFFFFF', color: dictation.listening ? 'error.main' : 'primary.main', width: 40, height: 40 }}
                >
                  {dictation.listening ? <StopIcon fontSize="small" /> : <MicIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </>
          )}
          <Box flex={1} />
          <Button size="small" variant="outlined" startIcon={ai.loading ? <CircularProgress size={14} /> : <AiIcon fontSize="small" />} onClick={suggest} disabled={ai.loading} sx={{ ...ctl, bgcolor: '#FFFFFF' }}>
            {t('Suggest with Gemini')}
          </Button>
        </Stack>
        {dictation.listening && <Typography variant="caption" color="error.main" mt={0.5} component="div">{t('Recording… speak, then press stop.')}</Typography>}
        {dictation.error && <Typography variant="caption" color="error" component="div" mt={0.5}>{dictation.error}</Typography>}
        {ai.error && <Alert severity="error" sx={{ mt: 1 }}>{ai.error}</Alert>}
        {r && (
          <Stack spacing={0.5} mt={1.25}>
            {r.translation && (
              <Typography variant="body2"><b>{t('Translation')}{r.language ? ` (${r.language})` : ''}:</b> {r.translation}</Typography>
            )}
            <Typography variant="body2">
              <b>{t('Gemini suggests')}:</b> {r.reasonCode ? `${r.reasonCode} · ${t(reasons.find((x) => x.code === r.reasonCode)?.name ?? '')}` : t('no fitting reason; pick one')}
              {r.confidence != null && ` (${Math.round(Number(r.confidence) * 100)}% ${t('sure')})`}
            </Typography>
            {r.rationale && <Typography variant="body2" color="text.secondary">{t('Why')}: {t(r.rationale)}</Typography>}
            {r.machineCondition && <Typography variant="body2" color="text.secondary">{t('Machine')}: {t(r.machineCondition)}</Typography>}
            <Typography variant="caption" color="text.secondary">{t('Suggested by')} {r.model}. {t('Check it, then confirm.')}</Typography>
          </Stack>
        )}
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" gap={1} alignItems="flex-start" flexWrap="wrap">
        <TextField
          select
          size="small"
          label={t('Downtime reason')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          helperText={chosen ? t(chosen.type === 'planned' ? 'Planned: excluded from OEE.' : 'Unplanned: counts as a loss in OEE.') : event.suggested ? t('Suggested from the PLC alarm.') : ' '}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          sx={{ flex: '2 1 240px', minWidth: 0 }}
        >
          <MenuItem value="" disabled>{t('Pick a reason')}</MenuItem>
          {reasonItems(reasons, event, t)}
        </TextField>
        <TextField size="small" label={t('Comment (English)')} value={comment} onChange={(e) => setComment(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} sx={{ flex: '1 1 160px', minWidth: 0 }} />
        <Button variant="contained" onClick={save} disabled={!code || saving} sx={{ ...ctl, minHeight: 40, px: 2.5, flex: 'none', ml: 'auto' }}>{t('Confirm')}</Button>
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
