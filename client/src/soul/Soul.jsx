// Machine Soul: the kiosk screen next to a press. Pick the press, sign in with an employee number,
// then the press speaks for itself (3D character + voice), shows its schedule, events and downtime.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Divider, Grid, IconButton,
  LinearProgress, MenuItem, Stack, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUpOutlined';
import VolumeOffIcon from '@mui/icons-material/VolumeOffOutlined';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import MicIcon from '@mui/icons-material/MicNoneOutlined';
import StopIcon from '@mui/icons-material/StopCircleOutlined';
import AiIcon from '@mui/icons-material/AutoAwesomeOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import { api, useCollection, useGet, useLive } from '../api.js';
import { LevelChip, Logo, StatusChip, duration, num, pct } from '../ui.jsx';
import { C, KPIS, LEVELS, level } from '../theme.js';
import { StopForm, useDictation } from '../StopConfirm.jsx';
import { NcEntry } from '../SensorTable.jsx';
import { MOTOR, sensorsFor, useSensorCatalog, valueOf } from '../sensors.js';
import PressCharacter, { EMOTIONS } from './PressCharacter.jsx';
import { BCP, useVoice } from './useVoice.js';
import Anatomy from '../anatomy/Anatomy.jsx';
import BuildIcon from '@mui/icons-material/PrecisionManufacturingOutlined';

const SESSION = 'drmacx.soul';
const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION)) ?? {};
  } catch {
    return {};
  }
};
const store = (v) => {
  try {
    sessionStorage.setItem(SESSION, JSON.stringify(v));
  } catch {
    /* private mode: the kiosk just asks again */
  }
};
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Short spoken greeting at sign-in (the press's own messages come from the server, already translated).
const GREET = {
  en: (n, c) => `Hi ${n}. I am ${c}. I will tell you whenever something changes.`,
  id: (n, c) => `Halo ${n}. Saya ${c}. Saya akan memberi tahu setiap kali ada perubahan.`,
};

export default function Soul() {
  const [session, setSession] = useState(load);
  const save = (v) => (store(v), setSession(v));
  if (!session.machineId || !session.operator) return <Gate session={session} onDone={save} />;
  return <Main session={session} onChange={save} onExit={() => save({ lang: session.lang })} />;
}

// --- Step 1 + 2: pick the press, verify the employee number ---
function Gate({ session, onDone }) {
  const machines = useCollection('machines');
  const [machineId, setMachineId] = useState(session.machineId ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await api('/soul/verify', { method: 'POST', body: { machineId, code } });
      onDone({ machineId, operator: out.operator, machine: out.machine, lang: session.lang ?? 'en', voice: true, greet: true });
    } catch (x) {
      setError(x.message);
      setBusy(false);
    }
  };
  const active = machines.rows.filter((m) => m.active !== false).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 720 }}>
        <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
          <Logo />
          <Typography variant="h4" component="h1" mt={3}>Machine Soul</Typography>
          <Typography color="text.secondary" mb={3}>Pick the press this screen stands next to, then sign in with your employee number.</Typography>
          <Typography variant="overline" component="h2">1 · PRESS</Typography>
          <Grid container spacing={1.5} mb={3}>
            {active.map((m) => (
              <Grid key={m.id} size={{ xs: 12, sm: 6 }}>
                <Card sx={{ borderColor: machineId === m.id ? C.blue : C.line, borderWidth: 2, bgcolor: machineId === m.id ? C.light : '#fff' }}>
                  <CardActionArea onClick={() => setMachineId(m.id)} aria-pressed={machineId === m.id} sx={{ p: 2, minHeight: 88 }}>
                    <Typography fontWeight={800} fontSize={18}>{m.code}</Typography>
                    <Typography variant="body2">{m.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.line} · {m.setup === 'premium' ? 'Premium' : 'Essential'} sensors</Typography>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Typography variant="overline" component="h2">2 · OPERATOR</Typography>
          <Stack component="form" onSubmit={verify} direction={{ xs: 'column', sm: 'row' }} gap={1.5} mt={1}>
            <TextField
              label="Employee number"
              value={code}
              onChange={(e) => (setCode(e.target.value), setError(''))}
              autoComplete="off"
              slotProps={{ htmlInput: { inputMode: 'text', style: { fontSize: 22, letterSpacing: '0.08em' } } }}
              sx={{ flex: 1 }}
            />
            <Button type="submit" variant="contained" size="large" disabled={!machineId || !code.trim() || busy} sx={{ minHeight: 56, px: 4 }}>
              {busy ? <CircularProgress size={22} color="inherit" /> : 'Start'}
            </Button>
          </Stack>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </CardContent>
      </Card>
    </Box>
  );
}

// Mood from the press's state: a fresh stop shocks it, sensor alarms alarm it, otherwise OEE vs target.
function emotionOf(row, now) {
  if (!row) return 'sleepy';
  if (['break', 'inactive', 'disconnected'].includes(row.status)) return 'sleepy';
  if (row.status === 'stopped') return now - row.since < 20000 ? 'shocked' : 'worried';
  if (Object.values(row.sensorStatus ?? {}).includes('alarm')) return 'alarmed';
  return { good: 'happy', near: 'worried', below: 'sad' }[level(row.oee, row.targets?.oee)] ?? 'calm';
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function usePoll(path, ms) {
  const g = useGet(path);
  useEffect(() => {
    const t = setInterval(g.reload, ms);
    return () => clearInterval(t);
  }, [g.reload, ms]);
  return g;
}

// --- The main kiosk screen ---
function Main({ session, onChange, onExit }) {
  const { machineId, operator, lang, voice: voiceOn } = session;
  const { live } = useLive();
  const languages = useGet('/languages').data ?? { en: 'English' };
  const messages = usePoll(`/machines/${machineId}/soul?lang=${lang}`, 4000);
  const pending = usePoll(`/machines/${machineId}/downtime/pending`, 8000);
  const shiftRange = live ? `from=${live.shift.start}&to=${live.shift.end}` : null;
  const shiftStops = usePoll(shiftRange && `/machines/${machineId}/downtime?${shiftRange}`, 15000);
  const reasons = useCollection('reasons');
  const master = useCollection('machines').rows.find((m) => m.id === machineId);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const now = useNow();
  const voice = useVoice(lang, voiceOn);
  const row = live?.machines.find((m) => m.id === machineId);

  // Speak each new message once (not the ones already there when the screen opened).
  const heard = useRef(null);
  useEffect(() => {
    if (!messages.data) return;
    if (!heard.current) {
      heard.current = new Set(messages.data.map((m) => m.id));
      return;
    }
    [...messages.data].reverse().forEach((m) => {
      if (heard.current.has(m.id)) return;
      heard.current.add(m.id);
      if (m.kind !== 'operator') voice.say(m.text);
    });
  }, [messages.data, voice]);
  useEffect(() => {
    if (!session.greet || !row) return;
    voice.say((GREET[lang] ?? GREET.en)(operator.name.split(' ')[0], row.code));
    onChange({ ...session, greet: false });
  }, [session.greet, row?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return <LinearProgress />;
  if (!row) return <Alert severity="warning" sx={{ m: 2 }}>This press is no longer monitored. <Button onClick={onExit}>Pick another</Button></Alert>;

  const emotion = emotionOf(row, now);
  const question = messages.data?.find((m) => m.needsAnswer && !m.answered);
  const alarming = Object.values(row.sensorStatus ?? {}).some((v) => v === 'warn' || v === 'alarm');
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 1.5, md: 2.5 } }}>
      <Grid container spacing={2}>
        {/* LEFT 7/12: who I am and how I am doing, my face and what I said, schedule vs actual */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Stack spacing={2}>
            <Card>
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1.5}>
                  <Box>
                    <Typography variant="overline" component="div">{row.line} · {live.shift.name} · MACHINE SOUL</Typography>
                    <Typography variant="h4" component="h1">{row.code} · {row.name}</Typography>
                    <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
                      <StatusChip status={row.status} />
                      <Chip size="small" label={`Operator ${operator.name} (${operator.code})`} />
                      <Chip size="small" variant="outlined" label={`${EMOTIONS[emotion].label} mood`} />
                    </Stack>
                  </Box>
                  <Stack direction="row" gap={1} alignItems="center">
                    <TextField select size="small" label="Language" value={lang} onChange={(e) => onChange({ ...session, lang: e.target.value })} sx={{ minWidth: 150 }}>
                      {Object.entries(languages).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
                    </TextField>
                    <Tooltip title={voiceOn ? 'Mute my voice' : 'Turn my voice on'}>
                      <IconButton aria-label={voiceOn ? 'Mute voice' : 'Turn voice on'} onClick={() => onChange({ ...session, voice: !voiceOn })} sx={{ border: `1px solid ${C.line}` }}>
                        {voiceOn ? <VolumeUpIcon /> : <VolumeOffIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Show my anatomy (where my sensors are)">
                      <IconButton aria-label="Show anatomy" aria-pressed={!!session.anatomy} onClick={() => onChange({ ...session, anatomy: !session.anatomy })} sx={{ border: `1px solid ${C.line}`, bgcolor: session.anatomy ? C.light : undefined }}>
                        <BuildIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Sign out / change press">
                      <IconButton aria-label="Sign out" onClick={onExit} sx={{ border: `1px solid ${C.line}` }}><LogoutIcon /></IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                <Grid container spacing={1.5} mt={1.5}>
                  {KPIS.map((k, i) => {
                    const lv = level(row[k.key], row.targets?.[k.key]);
                    return (
                      <Grid key={k.key} size={{ xs: 6, sm: 3 }}>
                        <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: lv ? LEVELS[lv].bg : '#F8FAFC' }}>
                          <Typography variant="overline" component="div">{k.label}</Typography>
                          <Typography sx={{ fontWeight: 800, fontSize: i === 0 ? 34 : 26, lineHeight: 1.1, color: lv ? LEVELS[lv].color : C.ink }}>{pct(row[k.key])}</Typography>
                          <LevelChip value={row[k.key]} target={row.targets?.[k.key]} />
                        </Box>
                      </Grid>
                    );
                  })}
                </Grid>
              </CardContent>
            </Card>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 7 }}>
                <Card sx={{ height: { xs: 340, md: 430 }, position: 'relative', background: `radial-gradient(circle at 50% 70%, ${C.light}, #FFFFFF 70%)` }}>
                  <PressCharacter emotion={emotion} talking={voice.talking} running={row.status === 'running'} reduced={reduced} />
                  <Box sx={{ position: 'absolute', left: 12, bottom: 10, right: 12 }} aria-live="polite">
                    {voice.talking && <Chip size="small" color="primary" label="Speaking…" />}
                  </Box>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <SaidList messages={messages.data} onReplay={(m) => voice.say(m.text)} onShow={(lit) => onChange({ ...session, anatomy: true, lit })} />
              </Grid>
            </Grid>

            <Schedule row={row} live={live} now={now} />
          </Stack>
        </Grid>

        {/* RIGHT 5/12: what is happening, ask / explain, downtime */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2}>
            <EventSummary row={row} master={master} now={now} reasons={reasons.rows} question={question} />
            {(alarming || session.anatomy) && (
              <Box>
                <Anatomy m={row} lit={session.lit ?? undefined} title="My anatomy" height={380} />
                {session.lit && <Button size="small" onClick={() => onChange({ ...session, lit: null })} sx={{ mt: 0.5 }}>Back to my live sensors</Button>}
              </Box>
            )}
            <Talk machineId={machineId} operator={operator} lang={lang} question={question} onDone={messages.reload} />
            {row.setup === 'essential' && (
              <Card>
                <CardContent>
                  <Typography variant="h6" component="h2">NC pieces</Typography>
                  <Typography variant="body2" color="text.secondary" mb={1.5}>I have no camera. Log the non-conformance pieces you find so my Quality is right.</Typography>
                  <NcEntry machineId={machineId} operatorId={operator.id} />
                </CardContent>
              </Card>
            )}
            <DowntimeList machineId={machineId} pending={pending} done={shiftStops.data?.events?.filter((e) => e.confirmed)} reasons={reasons.rows} operator={operator} lang={lang} now={now} />
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}

const KIND = { advice: 'Advice', report: 'Report', operator: 'You said', stop: 'Stop', risk: 'Target risk', surprise: 'Question', anomaly: 'Sensor alert', cycleTime: 'Cycle time', handover: 'Handover', info: 'Info' };

function SaidList({ messages, onReplay, onShow }) {
  return (
    <Card sx={{ height: { xs: 'auto', sm: 430 }, display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ pb: 1 }}>
        <Typography variant="h6" component="h2">What I said</Typography>
      </CardContent>
      <Box sx={{ overflowY: 'auto', px: 2, pb: 2, flex: 1, maxHeight: { xs: 360, sm: 'none' } }} role="log" aria-live="polite">
        {!messages && <LinearProgress />}
        {messages && !messages.length && <Typography variant="body2" color="text.secondary">Nothing yet. I speak when something changes, or when you ask.</Typography>}
        <Stack spacing={1.25}>
          {messages?.map((m) => (
            <Box key={m.id} sx={{ p: 1.25, borderRadius: 2.5, bgcolor: m.kind === 'operator' ? C.light : '#F8FAFC', border: `1px solid ${m.needsAnswer && !m.answered ? '#F9A825' : C.line}` }}>
              <Stack direction="row" alignItems="center" gap={1} mb={0.25}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">{hhmm(m.at)}</Typography>
                <Chip size="small" label={KIND[m.kind] ?? m.kind} sx={{ height: 20, fontSize: 11 }} />
                <Box flex={1} />
                {m.kind !== 'operator' && (
                  <IconButton size="small" aria-label="Say it again" onClick={() => onReplay(m)}><ReplayIcon fontSize="small" /></IconButton>
                )}
              </Stack>
              <Typography variant="body2">{m.text}</Typography>
              {(m.data?.part || m.data?.node) && (
                <Button size="small" onClick={() => onShow({ part: m.data.node ? 'loadCell' : m.data.part, node: m.data.node || null })} sx={{ minHeight: 28, px: 0.5 }}>
                  Show on my anatomy
                </Button>
              )}
              {m.data?.actions?.length > 0 && (
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {m.data.actions.map((a, i) => <Typography key={i} component="li" variant="caption" color="text.secondary">{a}</Typography>)}
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      </Box>
    </Card>
  );
}

// Schedule vs actual for this shift: pieces due by now vs good pieces, and where the shift will end at this rate.
function Schedule({ row, live, now }) {
  const good = row.total - row.ng;
  const plan = row.plan ?? { toNow: 0, shift: 0 };
  const gap = good - plan.toNow;
  const rate = row.plannedSec ? good / row.plannedSec : 0; // good pieces per planned second so far
  const remainingSec = Math.max(0, (plan.shift - plan.toNow) * row.idealCycleTime);
  const projected = Math.round(good + rate * remainingSec);
  const k = level(plan.toNow ? good / plan.toNow : null, row.targets?.oee);
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" gap={1}>
          <Typography variant="h6" component="h2">Schedule vs actual</Typography>
          <Typography variant="body2" color="text.secondary">{duration(Math.max(0, live.shift.end - now))} left in {live.shift.name}</Typography>
        </Stack>
        <Grid container spacing={2} mt={0.5}>
          {[
            ['Planned by now', num(plan.toNow)],
            ['Good made', num(good)],
            ['Gap', `${gap >= 0 ? '+' : ''}${num(gap)}`],
            ['Shift plan', num(plan.shift)],
            ['Projected at shift end', num(projected)],
          ].map(([l, v]) => (
            <Grid key={l} size={{ xs: 6, sm: 'grow' }}>
              <Typography variant="overline" component="div">{l}</Typography>
              <Typography sx={{ fontWeight: 800, fontSize: 24, color: l === 'Gap' ? (gap < 0 ? LEVELS.below.color : LEVELS.good.color) : C.ink }}>{v}</Typography>
            </Grid>
          ))}
        </Grid>
        <Box sx={{ position: 'relative', mt: 1.5, height: 14, borderRadius: 2, bgcolor: '#E2E8F0', overflow: 'hidden' }} role="img" aria-label={`Good ${good} of ${plan.shift} planned this shift`}>
          <Box sx={{ position: 'absolute', inset: 0, width: `${plan.shift ? Math.min(100, (good / plan.shift) * 100) : 0}%`, bgcolor: k ? LEVELS[k].bar : C.blue }} />
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${plan.shift ? Math.min(100, (plan.toNow / plan.shift) * 100) : 0}%`, width: 2, bgcolor: C.ink }} />
        </Box>
        <Typography variant="caption" color="text.secondary">Bar = good pieces of the shift plan; the line = where the schedule is now. Plan = planned time ÷ ideal cycle time ({row.idealCycleTime} s).</Typography>
      </CardContent>
    </Card>
  );
}

function EventSummary({ row, master, now, reasons, question }) {
  const catalog = useSensorCatalog();
  const problems = sensorsFor(row, catalog).filter((s) => ['warn', 'alarm'].includes(row.sensorStatus?.[s.id]));
  const alarmText = (code) => reasons.find((r) => r.alarmCode === code && code)?.name;
  return (
    <Card sx={{ borderTop: `4px solid ${problems.some((p) => row.sensorStatus[p.id] === 'alarm') || row.status === 'stopped' ? LEVELS.below.bar : C.blue}` }}>
      <CardContent>
        <Typography variant="h6" component="h2" mb={1}>Right now</Typography>
        <Stack spacing={1}>
          <Typography>
            <b>{row.status === 'running' ? 'Running' : row.status === 'stopped' ? 'Stopped' : row.status === 'break' ? 'On a planned break' : 'Not producing'}</b>
            {' '}for {duration(now - row.since)} · motor {MOTOR[row.motor] ?? '—'}
          </Typography>
          {row.openStop && (
            <Alert severity="error" icon={false}>
              Stopped {duration(now - row.openStop.start)} · alarm {row.openStop.alarmCode || 'none'}{alarmText(row.openStop.alarmCode) ? ` · ${alarmText(row.openStop.alarmCode)}` : ''}. Give it a reason below.
            </Alert>
          )}
          {question && <Alert severity="warning" icon={false}><b>I have a question:</b> {question.text}</Alert>}
          {problems.map((s) => (
            <Alert key={s.id} severity={row.sensorStatus[s.id] === 'alarm' ? 'error' : 'warning'} icon={false}>
              <b>{s.short}</b>: {num(valueOf(row.readings, s))} {s.unit}
              {s.node ? ` (nominal ${Math.round(row.ratedTonnage / row.nodes)} t ± ${row.nodeTolerancePct}%)` : s.warn != null ? ` (warn ${s.warn} ${s.unit})` : ''}
            </Alert>
          ))}
          {!row.openStop && !problems.length && !question && <Typography variant="body2" color="text.secondary">All my sensors are within limits.</Typography>}
          <Typography variant="caption" color="text.secondary">{row.pending} stop{row.pending === 1 ? '' : 's'} waiting for a reason · {master?.setup === 'premium' ? 'Premium' : 'Essential'} sensors</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

// "Ask Gemini" and "Explain by voice" (the operator always starts an explanation).
function Talk({ machineId, operator, lang, question, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null); // 'ask' | 'explain'
  const [error, setError] = useState('');
  const dictation = useDictation(BCP[lang] ?? 'en-US', (t) => setText((x) => `${x} ${t}`.trim()));
  const run = async (kind) => {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'ask') await api(`/machines/${machineId}/soul/ask`, { method: 'POST', body: { lang } });
      else {
        await api(`/machines/${machineId}/soul/explain`, { method: 'POST', body: { lang, text, operatorId: operator.id, replyTo: question?.id } });
        setText('');
      }
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="h6" component="h2">Talk to me</Typography>
          <Button variant="contained" color="secondary" startIcon={busy === 'ask' ? <CircularProgress size={18} color="inherit" /> : <AiIcon />} onClick={() => run('ask')} disabled={!!busy} sx={{ minHeight: 48 }}>
            Ask Gemini
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" mt={0.5} mb={1.5}>
          {question ? 'Answer my question: press the mic and tell me what happened.' : 'Press the mic and tell me what happened, in any language. I check it against my sensors.'}
        </Typography>
        <Stack direction="row" gap={1} alignItems="flex-start">
          {dictation.supported && (
            <IconButton
              aria-label={dictation.listening ? 'Stop recording' : 'Start recording'}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              sx={{ width: 56, height: 56, bgcolor: dictation.listening ? LEVELS.below.bg : C.light, color: dictation.listening ? LEVELS.below.color : C.blue }}
            >
              {dictation.listening ? <StopIcon /> : <MicIcon />}
            </IconButton>
          )}
          <TextField multiline minRows={2} maxRows={5} fullWidth placeholder="What happened?" value={text} onChange={(e) => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
          <IconButton aria-label="Send" color="primary" onClick={() => run('explain')} disabled={!text.trim() || !!busy} sx={{ width: 56, height: 56, border: `1px solid ${C.line}` }}>
            {busy === 'explain' ? <CircularProgress size={20} /> : <SendIcon />}
          </IconButton>
        </Stack>
        {dictation.listening && <Typography variant="caption" color="error.main">Listening… press stop when you are done.</Typography>}
        {(error || dictation.error) && <Alert severity="error" sx={{ mt: 1.5 }}>{error || dictation.error}</Alert>}
      </CardContent>
    </Card>
  );
}

// Downtime: the oldest stop still waiting for a reason first ("Show all" for the rest), then this shift's answered stops.
function DowntimeList({ machineId, pending, done, reasons, operator, lang, now }) {
  const [showDone, setShowDone] = useState(false);
  const [all, setAll] = useState(false);
  const waiting = useMemo(() => [...(pending.data ?? [])].sort((a, b) => a.start - b.start), [pending.data]);
  const shown = all ? waiting : waiting.slice(0, 1);
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" component="h2">Downtime waiting for a reason</Typography>
          <Chip size="small" label={waiting.length} color={waiting.length ? 'warning' : 'default'} />
        </Stack>
        {pending.loading && !pending.data && <LinearProgress sx={{ mt: 1 }} />}
        {pending.data && !waiting.length && <Typography variant="body2" color="text.secondary" mt={1}>Every stop has its reason. Thank you!</Typography>}
        <Stack divider={<Divider />} spacing={2} mt={1.5}>
          {shown.map((e) => (
            <Box key={e.id}>
              <Typography variant="caption" color="text.secondary">Waiting {duration(now - (e.end ?? now))}{e.end ? '' : ' · still stopped'}</Typography>
              <StopForm machineId={machineId} event={e} reasons={reasons} onSaved={pending.reload} operatorId={operator.id} lang={BCP[lang]} />
            </Box>
          ))}
        </Stack>
        {waiting.length > 1 && (
          <Button onClick={() => setAll(!all)} sx={{ mt: 1.5 }}>{all ? 'Show only the oldest' : `Show all (${waiting.length})`}</Button>
        )}
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" component="h2" fontSize={16}>Reason given this shift</Typography>
          <Chip size="small" label={done?.length ?? '…'} />
        </Stack>
        {done && !done.length && <Typography variant="body2" color="text.secondary" mt={1}>None yet this shift.</Typography>}
        <Stack spacing={1} mt={1}>
          {(showDone ? done : done?.slice(0, 3))?.map((e) => (
            <Stack key={e.id} direction="row" gap={1} alignItems="baseline">
              <Typography variant="body2" fontWeight={700} sx={{ minWidth: 48 }}>{hhmm(e.start)}</Typography>
              <Typography variant="body2" flex={1}>{e.reason}{e.planned ? ' · planned' : ''}</Typography>
              <Typography variant="body2" color="text.secondary">{duration(e.minutes * 60e3)}</Typography>
            </Stack>
          ))}
        </Stack>
        {done?.length > 3 && <Button onClick={() => setShowDone(!showDone)} sx={{ mt: 1 }}>{showDone ? 'Show fewer' : `Show all (${done.length})`}</Button>}
      </CardContent>
    </Card>
  );
}
