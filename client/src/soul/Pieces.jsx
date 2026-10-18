// Pieces of the Dr. Macx Live kiosk: the machine status card, the panel with what the machine said (the current
// issue, one fact, the action plan, the full message on request, three facts about this shift) and the answer dialog.
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, Stack, TextField, Tooltip, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/MicNoneOutlined';
import StopIcon from '@mui/icons-material/StopCircleOutlined';
import WaveIcon from '@mui/icons-material/GraphicEqRounded';
import NextIcon from '@mui/icons-material/ArrowCircleRightOutlined';
import CheckIcon from '@mui/icons-material/CheckRounded';
import TimerIcon from '@mui/icons-material/TimerOutlined';
import RepeatIcon from '@mui/icons-material/RepeatRounded';
import AlarmIcon from '@mui/icons-material/NotificationsActiveOutlined';
import AlarmOffIcon from '@mui/icons-material/NotificationsOffOutlined';
import PlayIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import PlcIcon from '@mui/icons-material/DeveloperBoardOutlined';
import TempIcon from '@mui/icons-material/ThermostatOutlined';
import VibIcon from '@mui/icons-material/VibrationOutlined';
import MotorIcon from '@mui/icons-material/ElectricBoltOutlined';
import SensorsIcon from '@mui/icons-material/SensorsOutlined';
import StatusIcon from '@mui/icons-material/MonitorHeartOutlined';
import { C, LEVELS, STATUS } from '../theme.js';
import { api } from '../api.js';
import { useDictation } from '../StopConfirm.jsx';
import { BCP } from './useVoice.js';
import { duration } from '../ui.jsx';
import { useT } from '../i18n.jsx';
import { HourView, SEV, hhmm } from './Panels.jsx';

const INNER = '8px';

// Machine status at a glance: running state, PLC alarm and two sensor groups (temperature and vibration on Premium;
// motor current and the laser eye on Essential), each judged OK / Warning / Alarm from the live sensor status.
const STATE_COLOR = { ok: SEV.ok.color, warn: SEV.warn.color, alarm: SEV.error.color, none: '#94A3B8' };
const worst = (row, ids) => ['alarm', 'warn', 'ok'].find((s) => ids.some((id) => row.sensorStatus?.[id] === s)) ?? 'none';
const word = (state, ok) => ({ ok, warn: 'Warning', alarm: 'Alarm', none: 'No data' })[state];

export function MachineStatus({ action, row, now }) {
  const t = useT();
  const alarm = row.tags?.alarmCode;
  const premium = row.setup === 'premium';
  const motor = { running: 'Running', idle: 'Idle', off: 'Off', break: 'Break' }[row.motor];
  const temp = worst(row, ['tempMotor', 'tempGearbox', 'tempLube']);
  const vib = worst(row, ['vibMotor', 'vibGearbox']);
  const eye = worst(row, ['laserEye']);
  const tiles = [
    { Icon: PlayIcon, label: 'Current state', value: STATUS[row.status]?.label ?? row.status, state: row.status === 'running' ? 'ok' : row.status === 'stopped' ? 'alarm' : 'none' },
    { Icon: PlcIcon, label: 'PLC status', value: alarm ? `${t('Alarm')} ${alarm}` : 'No alarm', state: alarm ? 'alarm' : row.tags ? 'ok' : 'none' },
    premium ? { Icon: TempIcon, label: 'Temperature', state: temp, value: word(temp, 'Normal') } : { Icon: MotorIcon, label: 'Motor current', state: worst(row, ['motorCurrent']), value: motor ?? 'No data' },
    premium ? { Icon: VibIcon, label: 'Vibration', state: vib, value: word(vib, 'Stable') } : { Icon: SensorsIcon, label: 'Laser eye', state: eye, value: word(eye, 'Counting') },
  ];
  return (
    <Card data-tour="kiosk-status" sx={{ p: 1.5, py: 1, minWidth: 0, borderRadius: '12px', boxShadow: 'none', flex: 'none' }}>
      <Stack direction="row" alignItems="center" gap={1} mb={0.75}>
        <StatusIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
        <Typography fontWeight={700} fontSize={13} component="h2" flex={1}>{t('Machine status')}</Typography>
        <Typography variant="caption" color="text.secondary">{t('Updated')} {new Date(now).toLocaleTimeString(undefined, { hourCycle: 'h23' })}</Typography>
        {action}
      </Stack>
      <Box sx={{ display: 'grid', gap: 0.75, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {tiles.map(({ Icon, label, value, state }) => (
          <Stack key={label} alignItems="center" textAlign="center" sx={{ px: 0.5, py: 0.5, borderRadius: INNER, border: `1px solid ${C.line}`, minWidth: 0 }}>
            <Icon sx={{ fontSize: 18, color: STATE_COLOR[state] }} />
            <Typography fontWeight={700} fontSize={11.5} noWrap maxWidth="100%" sx={{ color: state === 'alarm' ? SEV.error.text : state === 'warn' ? SEV.warn.text : C.ink }}>{t(value)}</Typography>
            <Typography color="text.secondary" fontSize={10} noWrap maxWidth="100%">{t(label)}</Typography>
          </Stack>
        ))}
      </Box>
    </Card>
  );
}

// Headline when the machine has said nothing yet: its state.
const STATE_HEAD = { running: 'I am running.', stopped: 'I have stopped.', break: 'I am on a planned break.', disconnected: 'I am not connected.', inactive: 'I am switched off.' };
// The short version of what the machine said: a badge, the current issue (headline), one fact and one clear next action.
// Built from the message's own data, so no extra AI call; the full message stays one tap away.
const SENSOR_NAME = { vibMotor: 'Motor vibration', vibGearbox: 'Gearbox vibration', tempMotor: 'Motor temperature', tempGearbox: 'Gearbox temperature', tempLube: 'Lube line temperature', acoustic: 'Part sticking to the die', ioFaults: 'Proximity sensor fault' };
const SENSOR_NEXT = {
  tonnage: 'Check the tie rod, gib and die seating at that corner.', vib: 'Check the bearing and mounting.', temp: 'Check cooling and lubrication.',
  acoustic: 'Check the die and stripper before it jams.', ioFaults: 'Check the proximity sensor on the I/O module page.',
};
export const firstSentence = (x = '') => (x.match(/^[\s\S]*?[.!?](\s|$)/)?.[0] ?? x).trim();
const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const BADGE = {
  action: { sev: SEV.error, label: 'Needs action' },
  attention: { sev: SEV.warn, label: 'Needs attention' },
  ask: { sev: SEV.ask, label: 'Needs your answer' },
  info: { sev: SEV.info, label: 'Advice' },
  ok: { sev: SEV.ok, label: 'All good' },
};
export function briefOf(m, row) {
  const d = m?.data ?? {};
  if (!m) return { badge: row.status === 'stopped' ? 'action' : 'ok', issue: STATE_HEAD[row.status] ?? 'I am running.', fact: null, next: row.status === 'stopped' ? 'Check the machine and give the stop its reason.' : null };
  const causes = d.causes ?? [];
  switch (m.kind) {
    case 'stop':
      return { badge: 'action', issue: d.likelyCause || (d.alarmCode ? `I stopped on alarm ${d.alarmCode}` : 'I have stopped'), fact: firstSentence(m.text), next: d.actions?.[0] ?? 'Check the machine and give this stop its reason.' };
    case 'question':
      return {
        badge: 'ask',
        issue: causes.length ? `Possible issue: ${causes[0].reason}` : 'Output below plan',
        fact: d.hour != null && d.actual != null ? `Between ${hm(d.hour)} and ${hm(d.hour + 3600e3)} I made ${d.actual} good pieces, while the expected was about ${d.expected}.` : firstSentence(m.text),
        next: causes.length ? `Tell me if ${causes[0].reason} caused it.` : 'Tell me what happened in that hour.',
      };
    case 'risk':
      return {
        badge: 'attention', issue: d.reachable === false ? 'Shift target out of reach' : 'Shift target at risk', fact: firstSentence(m.text),
        next: d.reachable === false ? 'Keep stops short: every running minute counts now.' : `Make one good piece every ${d.neededPaceSec?.toFixed?.(1) ?? '—'} s: fewer and shorter stops.`,
      };
    case 'anomaly': {
      const id = d.sensor ?? '';
      const group = id.startsWith('tonnage') ? 'tonnage' : id.startsWith('vib') ? 'vib' : id.startsWith('temp') ? 'temp' : id;
      const name = id.startsWith('tonnage') ? `Tonnage node ${d.node ?? id.replace('tonnage', '')}` : SENSOR_NAME[id] ?? 'Sensor';
      return { badge: d.state === 'alarm' ? 'action' : 'attention', issue: `${name} ${d.state === 'alarm' ? 'alarm' : 'warning'}`, fact: firstSentence(m.text), next: SENSOR_NEXT[group] ?? 'Check that part before it stops the machine.' };
    }
    case 'report':
      return { badge: 'info', issue: 'I checked your explanation', fact: d.likelyCause ?? firstSentence(m.text), next: d.actions?.[0] ?? null };
    case 'handover':
      return { badge: 'info', issue: 'Shift handover', fact: firstSentence(m.text), next: 'Read the full handover in History.' };
    case 'cycle':
      return { badge: 'info', issue: 'My cycle time can be updated', fact: firstSentence(m.text), next: 'A supervisor approves it on the Machines page.', link: '/machines' };
    default: // advice
      return { badge: 'info', issue: 'Advice for this shift', fact: firstSentence(m.text), next: d.actions?.[0] ?? null };
  }
}

// Three facts under what the machine said: this shift's longest loss, its most frequent stop, and the PLC alarm now.
export function factsOf(stops, row, now) {
  const by = new Map();
  for (const e of stops) {
    const name = e.reason || 'Reason not given';
    const g = by.get(name) ?? by.set(name, { name, sec: 0, n: 0 }).get(name);
    g.sec += e.durationSec ?? Math.max(0, now - e.start) / 1000;
    g.n += 1;
  }
  const groups = [...by.values()];
  const longest = [...groups].sort((a, b) => b.sec - a.sec)[0];
  const most = [...groups].sort((a, b) => b.n - a.n).find((g) => g !== longest);
  const alarm = row.tags?.alarmCode;
  return [
    longest ? { Icon: TimerIcon, sev: SEV.warn, big: `${Math.max(1, Math.round(longest.sec / 60))} min`, small: longest.name } : { Icon: CheckIcon, sev: SEV.ok, big: 'No stops', small: 'this shift' },
    most && { Icon: RepeatIcon, sev: SEV.error, big: `${most.n} ×`, small: most.name },
    alarm ? { Icon: AlarmIcon, sev: SEV.error, big: `Alarm ${alarm}`, small: 'PLC alarm active' } : { Icon: AlarmOffIcon, sev: SEV.info, big: 'No PLC alarm', small: 'right now' },
  ].filter(Boolean);
}

// "Answer my question" / "Explain by voice or text": the operator's answer goes to Dr. Macx, which checks it against its
// data. Every chip writes into the text box (tap again to take it out), so the box shows exactly what is sent; the mic
// and typing add to it. The verdict chips answer the question; Gemini's chips are what most likely happened.
const optionCache = new Map(); // `${machineId}|${lang}|${question id}` -> options, kept until the page reloads

export function VoiceDialog({ machineId, operator, lang, question, preset, quick, idealCycleTime, onClose, onDone }) {
  const t = useT();
  const cacheKey = `${machineId}|${lang}|${question?.id ?? 'explain'}`;
  const causes = question?.data?.causes ?? [];
  const verdicts = question?.data?.answers ?? [];
  // a verdict as it is written in the text ("Yes" names the stops the machine proposed)
  const say = (v) => (v === 'Yes' && causes.length ? `${t('Yes, it was')} ${causes.map((c) => `${c.count} × ${c.reason} (${c.minutes} min)`).join(' and ')}` : t(v));
  const [text, setText] = useState(preset ? say(preset) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [options, setOptions] = useState(() => optionCache.get(cacheKey) ?? null); // null while Gemini thinks
  const dictation = useDictation(BCP[lang] ?? 'en-US', (said) => setText((x) => `${x} ${said}`.trim()));
  useEffect(() => {
    if (optionCache.has(cacheKey)) return undefined;
    let on = true;
    api(`/machines/${machineId}/soul/options`, { method: 'POST', body: { lang } }).then(
      (r) => {
        const got = r.options?.length ? r.options : quick.map(t);
        optionCache.set(cacheKey, got);
        if (on) setOptions(got);
      },
      () => on && setOptions(quick.map(t)), // Gemini busy: this shift's frequent reasons instead (not kept, so it tries again)
    );
    return () => { on = false; };
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // sentences in the box are joined by ". "; a chip adds or removes its own sentence
  const has = (x) => text.includes(x);
  const without = (s, x) => s.replace(`${x}. `, '').replace(`. ${x}`, '').replace(x, '').trim();
  const toggle = (x) => setText((s) => (s.includes(x) ? without(s, x) : [s.trim().replace(/\.$/, ''), x].filter(Boolean).join('. ')));
  // one verdict at a time, always first
  const pickVerdict = (v) => setText((s) => {
    const rest = verdicts.reduce((acc, x) => without(acc, say(x)), s);
    return has(say(v)) ? rest : [say(v), rest].filter(Boolean).join('. ');
  });
  const body = text.trim();
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/machines/${machineId}/soul/explain`, { method: 'POST', body: { lang, text: body, operatorId: operator.id, replyTo: question?.id } });
      onDone();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const chip = (label, on, onClick, ask) => (
    <Chip
      key={label} label={label} clickable onClick={onClick} disabled={busy} icon={on ? <CheckIcon /> : undefined} aria-pressed={on}
      variant={on ? 'filled' : 'outlined'}
      sx={{ height: 32, fontSize: 13.5, borderRadius: INNER, ...(on ? { bgcolor: ask ? SEV.ask.color : C.blue, color: '#FFFFFF', '& .MuiChip-icon': { color: '#FFFFFF' }, '&:hover': { bgcolor: ask ? SEV.ask.text : C.blueDark } } : { borderColor: ask ? SEV.ask.line : C.line, color: ask ? SEV.ask.text : C.ink }) }}
    />
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth={question?.data?.hour ? 'md' : 'sm'}>
      <DialogTitle sx={{ pb: 1 }}>{t(question ? 'Answer my question' : 'Explain by voice or text')}</DialogTitle>
      <DialogContent>
        {question && <Box sx={{ p: 1.25, mb: 1.5, borderRadius: INNER, bgcolor: SEV.ask.bg, border: `1px solid ${SEV.ask.line}` }}><Typography variant="body2">{question.text}</Typography></Box>}
        {/* the evidence for that hour, so the operator can answer on this one screen */}
        {question?.data?.hour != null && (
          <Box sx={{ mb: 1.5, p: 1.5, borderRadius: INNER, border: `1px solid ${C.line}` }}>
            <HourView machineId={machineId} hour={question.data.hour} lang={lang} idealCycleTime={idealCycleTime} expected={question.data.expected} />
          </Box>
        )}
        {verdicts.length > 0 && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" mb={1.5} aria-label={t('Your answer')}>
            {verdicts.map((v) => chip(t(v), has(say(v)), () => pickVerdict(v), true))}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" component="div" mb={0.75}>
          {t('Gemini suggests (tap to add, tap again to remove)')}
        </Typography>
        <Stack direction="row" gap={0.75} flexWrap="wrap" mb={1.5} aria-label={t('Suggested answers')}>
          {!options && [0, 1, 2].map((i) => (
            <Chip key={i} variant="outlined" aria-label={t('Gemini is thinking')} label={<CircularProgress size={16} thickness={5} sx={{ display: 'block' }} />} sx={{ height: 32, width: 120, borderRadius: INNER, borderColor: C.line, '& .MuiChip-label': { display: 'flex', justifyContent: 'center', width: '100%' } }} />
          ))}
          {options?.map((o) => chip(o, has(o), () => toggle(o)))}
        </Stack>
        <Stack direction="row" gap={1} alignItems="flex-start">
          {dictation.supported && (
            <IconButton
              aria-label={t(dictation.listening ? 'Stop recording' : 'Start recording')}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              sx={{ width: 44, height: 44, flex: 'none', borderRadius: INNER, bgcolor: dictation.listening ? LEVELS.below.bg : C.light, color: dictation.listening ? LEVELS.below.color : C.blue }}
            >
              {dictation.listening ? <StopIcon /> : <MicIcon />}
            </IconButton>
          )}
          <TextField multiline minRows={2} maxRows={6} fullWidth size="small" placeholder={t('Add details (type, or press the mic and speak any language)')} value={text} onChange={(e) => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        </Stack>
        {dictation.listening && <Typography variant="caption" color="error.main">{t('Listening… press stop when you are done.')}</Typography>}
        {(error || dictation.error) && <Alert severity="error" sx={{ mt: 1.5 }}>{error || dictation.error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" onClick={send} disabled={!body || busy}>{busy ? <CircularProgress size={18} color="inherit" /> : t('Send to Dr. Macx')}</Button>
      </DialogActions>
    </Dialog>
  );
}

// What the machine said last, short: a badge, the current issue, one fact and the action plan (a link when it is done
// on another page), the full message on request, and three facts. children (the buttons) sit at the bottom; when the
// opened message does not fit, or hideChildren is set, they step aside.
export function SaidPanel({ said, row, now, talking, facts, onReplay, onSeen, hideChildren, children }) {
  const t = useT();
  const b = briefOf(said, row);
  const badge = BADGE[b.badge];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, minHeight: 0 }}>
      <Stack direction="row" alignItems="center" gap={1.25} flexWrap="wrap">
        <Stack direction="row" alignItems="center" gap={0.75} sx={{ px: 1.25, py: 0.5, borderRadius: INNER, bgcolor: badge.sev.bg }}>
          <badge.sev.Icon sx={{ fontSize: 18, color: badge.sev.color }} />
          <Typography fontWeight={700} fontSize={13.5} sx={{ color: badge.sev.text }}>{t(badge.label)}</Typography>
        </Stack>
        {said && (
          <Typography color="text.secondary" fontSize={13}>
            {t('Since')} {hhmm(said.at)} · <b style={{ color: SEV.error.text }}>{duration(Math.max(0, now - said.at))}</b> {t('ago')}
          </Typography>
        )}
        <Box flex={1} />
        {said && (
          <Tooltip title={t(talking ? 'Speaking…' : 'Say it again')}>
            <IconButton
              aria-label={t('Say it again')} onClick={() => onReplay(said)}
              sx={{ width: 36, height: 36, flex: 'none', bgcolor: C.light, color: C.blue, '&:hover': { bgcolor: '#BBDEFB' }, animation: talking ? 'soulPulse 1s ease-in-out infinite' : 'none', '@keyframes soulPulse': { '50%': { transform: 'scale(1.1)' } } }}
            >
              <WaveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Typography component="h2" sx={{ fontSize: { xs: 21, lg: 26 }, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em', color: C.ink }}>{t(b.issue)}</Typography>
      {b.fact && <Typography sx={{ fontSize: 15.5, lineHeight: 1.45, color: 'text.secondary', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t(b.fact)}</Typography>}
      {b.next && (
        <Stack direction="row" gap={0.75} alignItems="flex-start">
          <NextIcon sx={{ fontSize: 20, color: C.blue, mt: 0.1, flex: 'none' }} />
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: C.blueDark, lineHeight: 1.4 }}>
            {t('Action plan')}:{' '}
            {b.link ? <Link component={RouterLink} to={b.link} sx={{ color: C.blue, fontWeight: 700 }}>{t(b.next)}</Link> : t(b.next)}
          </Typography>
        </Stack>
      )}
      {said?.kind === 'advice' && !said.seen && onSeen && (
        <Button size="small" variant="outlined" startIcon={<CheckIcon />} onClick={() => onSeen(said)} sx={{ alignSelf: 'flex-start' }}>{t('Got it')}</Button>
      )}
      <Box sx={{ display: 'grid', gap: 1, p: 1, borderRadius: '12px', bgcolor: '#F1F5F9', gridTemplateColumns: { xs: '1fr', sm: `repeat(${facts.length}, minmax(0,1fr))` } }}>
        {facts.map(({ Icon, sev, big, small }) => (
          <Stack key={`${big}-${small}`} direction="row" gap={1.25} alignItems="center" sx={{ px: 1.25, py: 0.75, borderRadius: INNER, bgcolor: '#FFFFFF', minWidth: 0 }}>
            <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: sev.bg, display: 'grid', placeItems: 'center', flex: 'none' }}><Icon sx={{ fontSize: 18, color: sev.color }} /></Box>
            <Box minWidth={0}>
              <Typography fontWeight={800} fontSize={15} noWrap>{t(big)}</Typography>
              <Typography color="text.secondary" fontSize={12.5} noWrap>{t(small)}</Typography>
            </Box>
          </Stack>
        ))}
      </Box>
      {children && <Box sx={{ display: hideChildren ? 'none' : 'block', mt: 'auto', pt: 1 }}>{children}</Box>}
    </Box>
  );
}
