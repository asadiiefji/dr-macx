// Machine Soul: the kiosk screen next to a press. Pick the press, sign in with an employee number, then a full-screen
// dashboard: the press speaks for itself (3D character + voice), shows OEE, schedule vs actual, events, sensors and anatomy.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Grid, IconButton, InputAdornment, LinearProgress, MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUpOutlined';
import VolumeOffIcon from '@mui/icons-material/VolumeOffOutlined';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import MicIcon from '@mui/icons-material/MicNoneOutlined';
import StopIcon from '@mui/icons-material/StopCircleOutlined';
import ChatIcon from '@mui/icons-material/ChatRounded';
import WaveIcon from '@mui/icons-material/GraphicEqRounded';
import GlobeIcon from '@mui/icons-material/LanguageRounded';
import CalendarIcon from '@mui/icons-material/CalendarMonthOutlined';
import ArrowIcon from '@mui/icons-material/ArrowForwardRounded';
import HandoverIcon from '@mui/icons-material/HistoryEduOutlined';
import BuildIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import { api, useCollection, useGet, useLive } from '../api.js';
import { Logo, StatusChip, duration, num } from '../ui.jsx';
import { C, LEVELS, level } from '../theme.js';
import { useDictation } from '../StopConfirm.jsx';
import { sensorsFor, useSensorCatalog, valueOf } from '../sensors.js';
import PressCharacter, { EMOTIONS } from './PressCharacter.jsx';
import { BCP, useVoice } from './useVoice.js';
import Handovers from '../Handovers.jsx';
import { BreakdownButton, FactorSim, useSim } from '../Simulate.jsx';
import { AnatomyTab, EventDetail, EventFilter, EventList, FullScreen, SEV, SensorsTab, buildEvents, hhmm } from './Panels.jsx';

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

// Short spoken greeting at sign-in (the press's own messages come from the server, already translated).
const GREET = {
  en: (n, c) => `Hi ${n}. I am ${c}. I will tell you whenever something changes.`,
  id: (n, c) => `Halo ${n}. Saya ${c}. Saya akan memberi tahu setiap kali ada perubahan.`,
};

// Target colours, same as the rest of the app (theme.js LEVELS); ring = the bar colour.
const LV = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, { ...v, ring: v.bar }]));

export default function Soul() {
  const [session, setSession] = useState(load);
  const save = (v) => (store(v), setSession(v));
  if (!session.machineId || !session.operator) return <Gate session={session} onDone={save} />;
  return <Main key={session.machineId} session={session} onChange={save} onExit={() => save({ lang: session.lang })} />;
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

// Compact sizes shared by the kiosk panels (px, so they do not scale with the theme's 12 px radius unit).
const R = { panel: '12px', inner: '8px' };
const panel = { p: 1.5, minHeight: 0, minWidth: 0, borderRadius: R.panel, boxShadow: 'none' };
const tight = { minHeight: 36, height: 36, fontSize: 13.5 };

// --- The main kiosk screen: one screen high on a desktop / kiosk, scrolls on small screens ---
function Main({ session, onChange, onExit }) {
  const { machineId, operator, lang, voice: voiceOn } = session;
  const { live } = useLive();
  const languages = useGet('/languages').data ?? { en: 'English' };
  const messages = usePoll(`/machines/${machineId}/soul?lang=${lang}`, 4000);
  const pending = usePoll(`/machines/${machineId}/downtime/pending`, 8000);
  const shiftRange = live ? `from=${live.shift.start}&to=${live.shift.end}` : null;
  const shiftStops = usePoll(shiftRange && `/machines/${machineId}/downtime?${shiftRange}`, 15000);
  const reasons = useCollection('reasons');
  const presses = useCollection('machines').rows.filter((m) => m.active !== false).sort((a, b) => a.code.localeCompare(b.code));
  const catalog = useSensorCatalog();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const fit = useMediaQuery('(min-width:1200px) and (min-height:680px)');
  const short = useMediaQuery('(max-height:780px)');
  const now = useNow();
  const voice = useVoice(lang, voiceOn);
  const row = live?.machines.find((m) => m.id === machineId);
  const sensors = row ? sensorsFor(row, catalog) : [];

  const [tab, setTab] = useState('events');
  const [filter, setFilter] = useState('all');
  const [lit, setLit] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [allEvents, setAllEvents] = useState(false);
  const [allSaid, setAllSaid] = useState(false);
  const [handovers, setHandovers] = useState(false);
  const [talk, setTalk] = useState(null); // { question } while the voice dialog is open
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState('');

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

  // Sensor log: the last 3 minutes of each sensor (one value per live poll), for the sparklines.
  const log = useRef({});
  useEffect(() => {
    if (!row?.readings) return;
    for (const s of sensors) {
      const a = (log.current[s.id] ??= []);
      a.push(valueOf(row.readings, s));
      if (a.length > 90) a.shift();
    }
  }, [row?.readings]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(
    () => buildEvents(messages.data, pending.data, shiftStops.data?.events?.filter((e) => e.confirmed), sensors),
    [messages.data, pending.data, shiftStops.data, catalog], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!live) return <LinearProgress />;
  if (!row) return <Alert severity="warning" sx={{ m: 2 }}>This press is no longer monitored. <Button onClick={onExit}>Pick another</Button></Alert>;

  const emotion = emotionOf(row, now);
  const mood = EMOTIONS[emotion];
  const question = messages.data?.find((m) => m.needsAnswer && !m.answered);
  const opened = openId && events.find((e) => e.id === openId);
  const waiting = events.filter((e) => e.stop || e.needsAnswer).length; // stops and questions waiting for the operator
  const showAnatomy = (target) => (setLit(target), setTab('anatomy'), setOpenId(null), setAllEvents(false));
  const reload = () => (messages.reload(), pending.reload(), shiftStops.reload?.());
  const handlers = { onOpen: (e) => setOpenId(e.id), onAnatomy: showAnatomy, onAnswer: (q) => setTalk({ question: q }) };

  const switchPress = async (id) => {
    if (id === machineId) return;
    try {
      const out = await api('/soul/verify', { method: 'POST', body: { machineId: id, code: operator.code } });
      onChange({ ...session, machineId: id, machine: out.machine, greet: true });
    } catch (e) {
      setToast(e.message);
    }
  };
  const ask = async () => {
    setAsking(true);
    try {
      await api(`/machines/${machineId}/soul/ask`, { method: 'POST', body: { lang } });
      messages.reload();
    } catch (e) {
      setToast(e.message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <Box
      sx={{
        bgcolor: 'background.default', p: 1.5, gap: 1.5,
        minHeight: '100vh', height: fit ? '100vh' : 'auto', overflow: fit ? 'hidden' : 'visible',
        display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)',
      }}
    >
      <TopBar row={row} live={live} now={now} presses={presses} operator={operator} onSwitch={switchPress} onHandovers={() => setHandovers(true)} onExit={onExit} />

      <Box
        sx={{
          display: 'grid', gap: 1.5, minHeight: 0,
          gridTemplateColumns: fit ? 'minmax(0,9fr) minmax(0,3fr)' : '1fr',
          gridTemplateRows: fit ? 'auto minmax(0,1fr) auto' : 'none',
          gridTemplateAreas: fit ? '"oee tabs" "soul tabs" "progress actions"' : '"oee" "soul" "progress" "actions" "tabs"',
        }}
      >
        <OeePanel row={row} ring={short ? 124 : 148} />

        {/* Machine Soul: the face in its own area, what I said beside it */}
        <Card sx={{ ...panel, gridArea: 'soul', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <Typography fontWeight={700} fontSize={16} component="h2">Machine Soul</Typography>
            <Chip size="small" label={`${mood.label} mood`} sx={{ height: 22, fontSize: 12, bgcolor: `${mood.color}22`, color: C.ink, border: `1px solid ${mood.color}` }} />
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>Your AI assistant for this press · I speak when something changes</Typography>
            <Box flex={1} />
            <TextField
              select size="small" value={lang} onChange={(e) => onChange({ ...session, lang: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><GlobeIcon sx={{ fontSize: 18 }} /></InputAdornment> }, htmlInput: { 'aria-label': 'Kiosk language' } }}
              sx={{ minWidth: 150, '& .MuiInputBase-root': tight, '& .MuiSelect-select': { py: 0 } }}
            >
              {Object.entries(languages).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <Tooltip title={voiceOn ? 'Mute my voice' : 'Turn my voice on'}>
              <IconButton aria-label={voiceOn ? 'Mute voice' : 'Turn voice on'} onClick={() => onChange({ ...session, voice: !voiceOn })} sx={{ border: `1px solid ${C.line}`, borderRadius: R.inner, width: 36, height: 36 }}>
                {voiceOn ? <VolumeUpIcon fontSize="small" /> : <VolumeOffIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,4fr) minmax(0,5fr)' } }}>
            <Box sx={{ position: 'relative', minHeight: 220, borderRadius: R.inner, border: `1px solid ${C.line}`, background: `radial-gradient(circle at 50% 55%, ${C.light}, #FFFFFF 72%)`, overflow: 'hidden' }}>
              <Box sx={{ position: 'absolute', inset: 0 }}>
                <PressCharacter emotion={emotion} talking={voice.talking} running={row.status === 'running'} reduced={reduced} />
              </Box>
              {voice.talking && <Chip size="small" color="primary" icon={<WaveIcon />} label="Speaking…" sx={{ position: 'absolute', left: 10, bottom: 10 }} />}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 0 }}>
              <Bubble messages={messages.data} question={question} talking={voice.talking} onReplay={(m) => voice.say(m.text)} onAnswer={() => setTalk({ question })} />
              <Recent messages={messages.data} events={events} onOpen={handlers.onOpen} onAll={() => setAllSaid(true)} />
            </Box>
          </Box>
        </Card>

        <Progress row={row} live={live} now={now} />

        <Card sx={{ ...panel, p: 1.25, gridArea: 'tabs', display: 'flex', flexDirection: 'column', gap: 1, height: fit ? 'auto' : 640 }}>
          <Tabs
            value={tab} onChange={(e, v) => setTab(v)} variant="fullWidth"
            sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0, fontSize: 13.5, px: 1 } }}
          >
            <Tab value="events" label={<Stack direction="row" gap={0.75} alignItems="center">Events{waiting > 0 && <Chip size="small" color="error" label={waiting} sx={{ height: 18, fontSize: 11, '& .MuiChip-label': { px: 0.75 } }} />}</Stack>} />
            <Tab value="sensors" label="Sensors" />
            <Tab value="anatomy" label="Anatomy" />
          </Tabs>
          {tab === 'events' && (
            <Stack direction="row" alignItems="center" gap={1}>
              <EventFilter value={filter} onChange={setFilter} />
              <Box flex={1} />
              <Button size="small" endIcon={<ArrowIcon />} onClick={() => setAllEvents(true)} sx={{ minHeight: 32 }}>Show all</Button>
            </Stack>
          )}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.25 }}>
            {tab === 'events' && (messages.data ? <EventList events={events} filter={filter} dense {...handlers} /> : <LinearProgress />)}
            {tab === 'sensors' && <SensorsTab row={row} sensors={sensors} log={log.current} operator={operator} onPick={showAnatomy} />}
            {tab === 'anatomy' && <AnatomyTab row={row} sensors={sensors} lit={lit} onClear={() => setLit(null)} events={events} onOpen={handlers.onOpen} />}
          </Box>
        </Card>

        <Box sx={{ gridArea: 'actions', display: 'grid', gap: 1, gridTemplateColumns: fit ? '1fr' : '1fr 1fr', alignContent: 'end' }}>
          <Button variant="contained" onClick={ask} disabled={asking} startIcon={asking ? <CircularProgress size={18} color="inherit" /> : <ChatIcon />} sx={{ minHeight: 46, fontSize: 15, fontWeight: 700, borderRadius: R.inner }}>
            {asking ? 'Reading my sensors…' : 'Ask Dr. Macx'}
          </Button>
          <Button
            variant="outlined" color={question ? 'warning' : 'primary'} onClick={() => setTalk({ question })} startIcon={<WaveIcon />}
            sx={{ minHeight: 46, fontSize: 15, fontWeight: 700, borderRadius: R.inner, bgcolor: '#FFFFFF', borderWidth: question ? 2 : 1, '&:hover': { borderWidth: question ? 2 : 1 } }}
          >
            {question ? 'Answer my question' : 'Explain by voice'}
          </Button>
        </Box>
      </Box>

      {opened && (
        <EventDetail
          e={opened} row={row} sensors={sensors} reasons={reasons.rows} operator={operator} lang={lang}
          onClose={() => setOpenId(null)} onSaved={reload} onReplay={(m) => voice.say(m.text)} onAnswer={(q) => setTalk({ question: q })}
        />
      )}
      <FullScreen open={allEvents} onClose={() => setAllEvents(false)} title="All events this shift" actions={<EventFilter value={filter} onChange={setFilter} />}>
        <Box sx={{ maxWidth: 960 }}><EventList events={events} filter={filter} {...handlers} /></Box>
      </FullScreen>
      <FullScreen open={allSaid} onClose={() => setAllSaid(false)} title="What I said">
        <SaidList messages={messages.data} onReplay={(m) => voice.say(m.text)} onAnatomy={(t) => (setAllSaid(false), showAnatomy(t))} />
      </FullScreen>
      <FullScreen open={handovers} onClose={() => setHandovers(false)} title="Shift handovers">
        {handovers && <Box sx={{ maxWidth: 960 }}><Handovers machineId={machineId} /></Box>}
      </FullScreen>
      {talk && <VoiceDialog machineId={machineId} operator={operator} lang={lang} question={talk.question} onClose={() => setTalk(null)} onDone={reload} />}
      <Snackbar open={!!toast} autoHideDuration={6000} onClose={() => setToast('')}>
        <Alert severity="error" onClose={() => setToast('')} variant="filled">{toast}</Alert>
      </Snackbar>
    </Box>
  );
}

function Spec({ label, value }) {
  return (
    <Box minWidth={0} sx={{ flex: 'none' }}>
      <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ fontSize: 11.5, lineHeight: 1.3 }}>{label}</Typography>
      <Typography fontWeight={700} fontSize={14} noWrap sx={{ lineHeight: 1.3 }}>{value}</Typography>
    </Box>
  );
}

const FRAME = { 'straight-side': 'Straight-side', 'c-frame': 'C-frame' };

function TopBar({ row, live, now, presses, operator, onSwitch, onHandovers, onExit }) {
  const setup = row.setup === 'premium' ? 'Premium' : 'Essential';
  const iconBtn = { border: `1px solid ${C.line}`, borderRadius: R.inner, width: 36, height: 36 };
  return (
    <Card sx={{ ...panel, px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', columnGap: 2.5, rowGap: 1, flexWrap: 'wrap' }}>
      <Stack direction="row" gap={1.25} alignItems="center" minWidth={0}>
        <Box sx={{ width: 36, height: 36, borderRadius: R.inner, bgcolor: C.light, display: 'grid', placeItems: 'center', flex: 'none' }}>
          <BuildIcon sx={{ color: C.blue, fontSize: 22 }} />
        </Box>
        <Box minWidth={0}>
          <Stack direction="row" gap={1} alignItems="center">
            <TextField
              select variant="standard" value={row.id} onChange={(e) => onSwitch(e.target.value)}
              slotProps={{ input: { disableUnderline: true }, htmlInput: { 'aria-label': 'Change press' }, select: { renderValue: () => row.code } }}
              sx={{ '& .MuiSelect-select': { fontSize: 19, fontWeight: 800, py: 0, pr: '24px !important', lineHeight: 1.2 } }}
            >
              {presses.map((m) => <MenuItem key={m.id} value={m.id}>{m.code} · {m.name}</MenuItem>)}
            </TextField>
            <StatusChip status={row.status} />
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap component="div">{row.line} · {operator.name} ({operator.code})</Typography>
        </Box>
      </Stack>
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: C.line, display: { xs: 'none', md: 'block' } }} />
      <Spec label="Press type" value={FRAME[row.frameType] ?? row.frameType} />
      <Spec label="Rated tonnage" value={`${row.ratedTonnage} t`} />
      <Spec label="Sensor setup" value={row.setup === 'premium' ? `${setup} · ${row.nodes} nodes` : setup} />
      <Box flex={1} />
      <Stack direction="row" gap={1} alignItems="center">
        <CalendarIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
        <Spec label={new Date(now).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} value={new Date(now).toLocaleTimeString([], { hourCycle: 'h23' })} />
      </Stack>
      <Chip label={`${live.shift.name} · ${hhmm(live.shift.start)}–${hhmm(live.shift.end)}`} sx={{ bgcolor: C.light, color: C.blueDark, fontWeight: 700, height: 32, borderRadius: R.inner }} />
      <Stack direction="row" gap={0.75}>
        <Tooltip title="Shift handovers"><IconButton aria-label="Shift handovers" onClick={onHandovers} sx={iconBtn}><HandoverIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Sign out"><IconButton aria-label="Sign out" onClick={onExit} sx={iconBtn}><LogoutIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
    </Card>
  );
}

function Ring({ value, color, size = 148 }) {
  const stroke = Math.round(size * 0.09);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={`OEE ${value == null ? 'not available' : `${Math.round(v * 100)} percent`}`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: size * 0.29, fontWeight: 800, lineHeight: 1, color: C.ink, letterSpacing: '-0.03em' }}>
            {value == null ? '—' : Math.round(v * 100)}<Typography component="span" sx={{ fontSize: size * 0.13, fontWeight: 800 }}>%</Typography>
          </Typography>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: 'text.secondary', letterSpacing: '0.08em' }}>OEE</Typography>
        </Box>
      </Box>
    </Box>
  );
}

const hours = (sec) => (sec / 3600).toFixed(1);

function OeePanel({ row, ring }) {
  const sim = useSim(row); // simulation controls show only for dummy-generator presses (row.sim)
  const lv = (k) => LV[level(row[k], row.targets?.[k])];
  const good = row.total - row.ng;
  const factors = [
    { key: 'availability', label: 'Availability', sub: 'Run time', value: `${hours(row.runSec ?? 0)} / ${hours(row.plannedSec ?? 0)} h` },
    { key: 'performance', label: 'Performance', sub: 'CT', value: `${row.total ? ((row.runSec ?? 0) / row.total).toFixed(1) : '—'} / ${row.idealCycleTime} s` },
    { key: 'quality', label: 'Quality', sub: 'Good parts', value: `${num(good)} / ${num(row.total)}` },
  ];
  const o = lv('oee');
  return (
    <Card sx={{ ...panel, gridArea: 'oee', display: 'flex', gap: 2.5, alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
      <Ring value={row.oee} color={o?.ring ?? C.blue} size={ring} />
      <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 0 } }}>
        <Stack direction="row" alignItems="center" gap={1} mb={1.25} flexWrap="wrap">
          <Typography fontWeight={700} fontSize={16} component="h2" flex={1}>Overall Equipment Effectiveness</Typography>
          {row.sim && <BreakdownButton sim={sim} />}
          {o && <Chip size="small" label={`${o.label} · target ${row.targets?.oee?.target}%`} sx={{ height: 24, bgcolor: o.bg, color: o.color, fontWeight: 700 }} />}
        </Stack>
        {sim.error && <Typography variant="caption" color="error" component="div" mb={0.5}>{sim.error}</Typography>}
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          {factors.map((f) => {
            const l = lv(f.key);
            return (
              <Box key={f.key} sx={{ px: 1.25, py: 1, borderRadius: R.inner, border: `1px solid ${C.line}`, minWidth: 0 }}>
                <Stack direction="row" alignItems="baseline" gap={1}>
                  <Typography variant="body2" color="text.secondary" noWrap flex={1}>{f.label}</Typography>
                  <Typography variant="caption" noWrap sx={{ color: l?.color ?? 'text.secondary', fontWeight: 700 }}>{l?.label ?? 'No data'}</Typography>
                </Stack>
                <Stack direction="row" gap={1} alignItems="center" my={0.25}>
                  <Box sx={{ width: 4, height: 24, borderRadius: 2, bgcolor: l?.ring ?? '#94A3B8', flex: 'none' }} />
                  <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>
                    {row[f.key] == null ? '—' : Math.round(row[f.key] * 100)}<Typography component="span" sx={{ fontSize: 14, fontWeight: 800 }}>%</Typography>
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Typography variant="caption" color="text.secondary" noWrap component="div" flex={1} minWidth={0}>{f.sub} <b style={{ color: C.ink }}>{f.value}</b></Typography>
                  {row.sim && <FactorSim m={row} factor={f.key} sim={sim} />}
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Card>
  );
}

// The latest thing the press said, as a speech bubble (or its open question: tap to answer).
function Bubble({ messages, question, talking, onReplay, onAnswer }) {
  const last = question ?? messages?.find((m) => m.kind !== 'operator');
  return (
    <Box
      sx={{ position: 'relative', flex: 'none', bgcolor: question ? LEVELS.near.bg : C.light, border: `1px solid ${question ? '#FFE082' : '#BBDEFB'}`, borderRadius: R.inner, p: 1.25, pr: 6, cursor: question ? 'pointer' : 'default' }}
      aria-live="polite" onClick={question ? onAnswer : undefined}
    >
      {question && <Typography variant="caption" fontWeight={700} sx={{ color: LEVELS.near.color }} component="div">Question for you · tap to answer</Typography>}
      <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.45, color: C.ink, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {last?.text ?? 'Hello! I will tell you when something changes. Ask me anything with the buttons on the right.'}
      </Typography>
      {last && (
        <Tooltip title={talking ? 'Speaking…' : 'Say it again'}>
          <IconButton
            aria-label="Say it again" onClick={(ev) => (ev.stopPropagation(), onReplay(last))}
            sx={{ position: 'absolute', right: 8, top: 8, width: 32, height: 32, bgcolor: '#FFFFFF', color: C.blue, border: `1px solid ${C.line}`, '&:hover': { bgcolor: '#F8FAFC' }, animation: talking ? 'soulPulse 1s ease-in-out infinite' : 'none', '@keyframes soulPulse': { '50%': { transform: 'scale(1.12)' } } }}
          >
            <WaveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

const DOT = { stop: SEV.error.color, anomaly: SEV.warn.color, risk: SEV.warn.color, question: SEV.warn.color, report: SEV.ok.color, cycle: SEV.info.color, handover: SEV.info.color, advice: SEV.info.color, operator: '#94A3B8' };
const KIND = { advice: 'Advice', report: 'Report', operator: 'You said', stop: 'Stop', risk: 'Target risk', question: 'Question', anomaly: 'Sensor alert', cycle: 'Cycle time', handover: 'Handover', info: 'Info' };

function Recent({ messages, events, onOpen, onAll }) {
  const byMessage = new Map(events.filter((e) => e.message).map((e) => [e.message.id, e]));
  return (
    <Box sx={{ flex: 1, minHeight: 140, maxHeight: { xs: 300, lg: 'none' }, display: 'flex', flexDirection: 'column', border: `1px solid ${C.line}`, borderRadius: R.inner }}>
      <Stack direction="row" alignItems="center" sx={{ px: 1.25, py: 0.5, borderBottom: `1px solid ${C.line}` }}>
        <Typography fontWeight={700} fontSize={13.5} flex={1}>Recent messages</Typography>
        <Button size="small" endIcon={<ArrowIcon />} onClick={onAll} sx={{ minHeight: 28, py: 0 }}>View all</Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 0.5 }}>
        {!messages && <LinearProgress />}
        {messages?.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 1.25 }}>Nothing yet.</Typography>}
        {messages?.map((m) => {
          const e = byMessage.get(m.id);
          return (
            <Stack
              key={m.id} direction="row" gap={1} alignItems="center" onClick={e ? () => onOpen(e) : undefined}
              role={e ? 'button' : undefined} tabIndex={e ? 0 : undefined} onKeyDown={e ? (ev) => ev.key === 'Enter' && onOpen(e) : undefined}
              sx={{ minHeight: 30, px: 1.25, cursor: e ? 'pointer' : 'default', '&:hover': e ? { bgcolor: '#F8FAFC' } : undefined }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: DOT[m.kind] ?? '#94A3B8', flex: 'none' }} />
              <Typography variant="body2" color="text.secondary" sx={{ width: 40, flex: 'none', fontSize: 12.5 }}>{hhmm(m.at)}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ width: 84, flex: 'none', fontSize: 12 }} noWrap>{KIND[m.kind] ?? m.kind}</Typography>
              <Typography variant="body2" noWrap flex={1} sx={{ fontSize: 13 }}>{m.text}</Typography>
            </Stack>
          );
        })}
      </Box>
    </Box>
  );
}

function SaidList({ messages, onReplay, onAnatomy }) {
  return (
    <Stack spacing={1} sx={{ maxWidth: 960 }}>
      {messages?.map((m) => (
        <Box key={m.id} sx={{ p: 1.25, borderRadius: R.inner, border: `1px solid ${m.needsAnswer && !m.answered ? SEV.warn.line : C.line}`, bgcolor: m.kind === 'operator' ? C.light : '#FFFFFF' }}>
          <Stack direction="row" alignItems="center" gap={1} mb={0.25}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">{new Date(m.at).toLocaleString()}</Typography>
            <Chip size="small" label={KIND[m.kind] ?? m.kind} sx={{ height: 20, fontSize: 11 }} />
            <Box flex={1} />
            {m.kind !== 'operator' && <IconButton size="small" aria-label="Say it again" onClick={() => onReplay(m)}><ReplayIcon fontSize="small" /></IconButton>}
          </Stack>
          <Typography variant="body2">{m.text}</Typography>
          {(m.data?.part || m.data?.node) && (
            <Button size="small" onClick={() => onAnatomy({ part: m.data.node ? 'loadCell' : m.data.part, node: m.data.node || null })} sx={{ mt: 0.5, minHeight: 28 }}>View in anatomy</Button>
          )}
          {m.data?.actions?.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>{m.data.actions.map((a, i) => <Typography key={i} component="li" variant="body2" color="text.secondary">{a}</Typography>)}</Box>
          )}
        </Box>
      ))}
    </Stack>
  );
}

// Schedule vs actual for this shift: good pieces of the shift plan, where the schedule is now, and the projected end.
function Progress({ row, live, now }) {
  const good = row.total - row.ng;
  const plan = row.plan ?? { toNow: 0, shift: 0 };
  const gap = good - plan.toNow;
  const rate = row.plannedSec ? good / row.plannedSec : 0; // good pieces per planned second so far
  const remainingSec = Math.max(0, (plan.shift - plan.toNow) * row.idealCycleTime);
  const projected = Math.round(good + rate * remainingSec);
  const share = plan.shift ? good / plan.shift : 0;
  const k = level(plan.toNow ? good / plan.toNow : null, row.targets?.oee);
  const diff = projected - plan.shift;
  const signed = (v) => <Box component="span" sx={{ color: v < 0 ? LEVELS.below.color : LEVELS.good.color }}>{v >= 0 ? '+' : ''}{num(v)}</Box>;
  const stat = (label, value) => (
    <Stack direction="row" alignItems="baseline" gap={1} minWidth={0}>
      <Typography variant="body2" color="text.secondary" noWrap>{label}</Typography>
      <Typography component="div" sx={{ fontSize: 15, fontWeight: 700 }} noWrap>{value}</Typography>
    </Stack>
  );
  return (
    <Card sx={{ ...panel, py: 1.25, gridArea: 'progress' }}>
      <Stack direction="row" alignItems="center" gap={1.5}>
        <Typography fontWeight={700} fontSize={14} component="h2" noWrap>Production progress · {live.shift.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {duration(Math.max(0, live.shift.end - now))} left · plan = planned time ÷ ideal cycle ({row.idealCycleTime} s)
        </Typography>
        <Typography sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1 }}>{Math.round(share * 100)}%</Typography>
      </Stack>
      <Box sx={{ position: 'relative', height: 10, my: 1, borderRadius: 5, bgcolor: '#E2E8F0', overflow: 'hidden' }} role="img" aria-label={`Good ${good} of ${plan.shift} planned this shift; ${plan.toNow} due by now`}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, share * 100)}%`, bgcolor: k ? LEVELS[k].bar : C.blue, borderRadius: 5 }} />
        <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${plan.shift ? Math.min(100, (plan.toNow / plan.shift) * 100) : 0}%`, width: 2, bgcolor: C.ink }} />
      </Box>
      <Box sx={{ display: 'grid', columnGap: 2, rowGap: 0.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, auto)' }, justifyContent: 'space-between' }}>
        {stat('Good parts', <>{num(good)} <Box component="span" sx={{ color: 'text.secondary', fontSize: 12.5 }}>/ {num(plan.shift)}</Box></>)}
        {stat('Planned by now', num(plan.toNow))}
        {stat('Gap', signed(gap))}
        {stat('Projected end of shift', <>{num(projected)} <Box component="span" sx={{ fontSize: 12.5 }}>({signed(diff)})</Box></>)}
      </Box>
    </Card>
  );
}

// "Explain by voice": the operator tells what happened (or answers the press's question); Gemini checks it.
function VoiceDialog({ machineId, operator, lang, question, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dictation = useDictation(BCP[lang] ?? 'en-US', (t) => setText((x) => `${x} ${t}`.trim()));
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/machines/${machineId}/soul/explain`, { method: 'POST', body: { lang, text, operatorId: operator.id, replyTo: question?.id } });
      onDone();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{question ? 'Answer my question' : 'Explain by voice'}</DialogTitle>
      <DialogContent>
        {question && <Box sx={{ p: 1.5, mb: 2, borderRadius: '8px', bgcolor: SEV.warn.bg, border: `1px solid ${SEV.warn.line}` }}><Typography>{question.text}</Typography></Box>}
        <Typography color="text.secondary" mb={2}>Press the mic and tell me what happened, in any language. I check it against my sensors and keep it in my history.</Typography>
        <Stack direction="row" gap={1.5} alignItems="flex-start">
          {dictation.supported && (
            <IconButton
              aria-label={dictation.listening ? 'Stop recording' : 'Start recording'}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              sx={{ width: 56, height: 56, flex: 'none', bgcolor: dictation.listening ? LEVELS.below.bg : C.light, color: dictation.listening ? LEVELS.below.color : C.blue }}
            >
              {dictation.listening ? <StopIcon fontSize="large" /> : <MicIcon fontSize="large" />}
            </IconButton>
          )}
          <TextField multiline minRows={3} maxRows={8} fullWidth placeholder="What happened?" value={text} onChange={(e) => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        </Stack>
        {dictation.listening && <Typography variant="caption" color="error.main">Listening… press stop when you are done.</Typography>}
        {(error || dictation.error) && <Alert severity="error" sx={{ mt: 1.5 }}>{error || dictation.error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={!text.trim() || busy}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Send to Dr. Macx'}</Button>
      </DialogActions>
    </Dialog>
  );
}
