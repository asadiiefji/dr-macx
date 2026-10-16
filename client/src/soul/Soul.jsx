// Machine Soul: the kiosk screen next to a press. Pick the press, sign in with an employee number, then a full-screen
// dashboard: the press speaks for itself (3D character + voice), shows OEE, schedule vs actual, events, sensors and anatomy.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Grid, IconButton, InputAdornment, LinearProgress, MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
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
import FrameIcon from '@mui/icons-material/ViewInArOutlined';
import WeightIcon from '@mui/icons-material/ScaleOutlined';
import ChipIcon from '@mui/icons-material/MemoryOutlined';
import ArrowIcon from '@mui/icons-material/ArrowForwardRounded';
import HandoverIcon from '@mui/icons-material/HistoryEduOutlined';
import BuildIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import { api, useCollection, useGet, useLive } from '../api.js';
import { Logo, StatusChip, duration, num } from '../ui.jsx';
import { C, level, theme } from '../theme.js';
import { useDictation } from '../StopConfirm.jsx';
import { sensorsFor, useSensorCatalog, valueOf } from '../sensors.js';
import PressCharacter, { EMOTIONS } from './PressCharacter.jsx';
import { BCP, useVoice } from './useVoice.js';
import Handovers from '../Handovers.jsx';
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

// The kiosk is dark (a screen on the shop floor); light-only parts sit in white cards (Panels.jsx LightIsland).
const kiosk = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#60A5FA' },
    secondary: { main: '#FACC15', contrastText: '#111827' },
    error: { main: '#EF4444' },
    warning: { main: '#F59E0B' },
    success: { main: '#22C55E' },
    background: { default: '#070D1A', paper: '#0E1729' },
    text: { primary: '#F1F5F9', secondary: '#9AA8BC' },
    divider: 'rgba(148,163,184,0.18)',
  },
  shape: theme.shape,
  typography: { ...theme.typography, overline: { ...theme.typography.overline, color: '#9AA8BC' } },
  components: {
    ...theme.components,
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { borderRadius: 18, backgroundImage: 'none', backgroundColor: '#0E1729', border: '1px solid rgba(148,163,184,0.14)' } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: '#0B1324' } } },
    MuiTableCell: {},
  },
});
const LV = { good: { color: '#22C55E', label: 'On target' }, near: { color: '#FACC15', label: 'Near limit' }, below: { color: '#EF4444', label: 'Below target' } };

export default function Soul() {
  const [session, setSession] = useState(load);
  const save = (v) => (store(v), setSession(v));
  if (!session.machineId || !session.operator) return <Gate session={session} onDone={save} />;
  return (
    <ThemeProvider theme={kiosk}>
      <Main key={session.machineId} session={session} onChange={save} onExit={() => save({ lang: session.lang })} />
    </ThemeProvider>
  );
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

const panel = { p: { xs: 1.5, md: 2 }, minHeight: 0, minWidth: 0 };

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
  const compact = useMediaQuery('(max-height:840px)'); // short kiosk screens: smaller ring, tighter bubble
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
  const question = messages.data?.find((m) => m.needsAnswer && !m.answered);
  const opened = openId && events.find((e) => e.id === openId);
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
        bgcolor: 'background.default', color: 'text.primary', p: { xs: 1, md: 1.5 }, gap: 1.5,
        minHeight: '100vh', height: fit ? '100vh' : 'auto', overflow: fit ? 'hidden' : 'visible',
        display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)',
      }}
    >
      <TopBar row={row} live={live} now={now} presses={presses} operator={operator} onSwitch={switchPress} onHandovers={() => setHandovers(true)} onExit={onExit} />

      <Box
        sx={{
          display: 'grid', gap: 1.5, minHeight: 0,
          gridTemplateColumns: fit ? 'minmax(0,7fr) minmax(0,5fr)' : '1fr',
          gridTemplateRows: fit ? 'auto minmax(0,1fr) auto' : 'none',
          gridTemplateAreas: fit ? '"oee tabs" "soul tabs" "progress actions"' : '"oee" "soul" "progress" "actions" "tabs"',
        }}
      >
        <OeePanel row={row} ring={compact ? 92 : 116} />

        <Card sx={{ ...panel, gridArea: 'soul', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
            <Typography variant="h5" component="h2">Machine Soul</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', xl: 'block' } }}>Your AI assistant for this press</Typography>
            <Chip size="small" label={`${EMOTIONS[emotion].label} mood`} sx={{ bgcolor: 'rgba(34,197,94,0.14)', color: '#86EFAC', fontWeight: 700 }} />
            <Box flex={1} />
            <TextField
              select size="small" value={lang} onChange={(e) => onChange({ ...session, lang: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><GlobeIcon fontSize="small" /></InputAdornment> }, htmlInput: { 'aria-label': 'Kiosk language' } }}
              sx={{ minWidth: 150 }}
            >
              {Object.entries(languages).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <Tooltip title={voiceOn ? 'Mute my voice' : 'Turn my voice on'}>
              <IconButton aria-label={voiceOn ? 'Mute voice' : 'Turn voice on'} onClick={() => onChange({ ...session, voice: !voiceOn })} sx={{ border: 1, borderColor: 'divider', width: 44, height: 44 }}>
                {voiceOn ? <VolumeUpIcon /> : <VolumeOffIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,5fr) minmax(0,7fr)' } }}>
            <Box sx={{ position: 'relative', minHeight: compact ? 150 : 240, borderRadius: 3, background: 'radial-gradient(circle at 50% 75%, rgba(250,204,21,0.14), transparent 65%)' }}>
              <Box sx={{ position: 'absolute', inset: 0 }}>
                <PressCharacter emotion={emotion} talking={voice.talking} running={row.status === 'running'} reduced={reduced} />
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0, overflowY: 'auto' }}>
              <Bubble lines={compact ? 2 : 3} messages={messages.data} question={question} talking={voice.talking} onReplay={(m) => voice.say(m.text)} onAnswer={() => setTalk({ question })} />
              <Recent messages={messages.data} events={events} onOpen={handlers.onOpen} onAll={() => setAllSaid(true)} />
            </Box>
          </Box>
        </Card>

        <Progress row={row} live={live} now={now} />

        <Card sx={{ ...panel, gridArea: 'tabs', display: 'flex', flexDirection: 'column', gap: 1.25, height: fit ? 'auto' : 680 }}>
          <Tabs
            value={tab} onChange={(e, v) => setTab(v)} variant="fullWidth"
            sx={{ minHeight: 48, bgcolor: 'rgba(148,163,184,0.08)', borderRadius: 3, p: 0.5, '& .MuiTabs-indicator': { display: 'none' }, '& .MuiTab-root': { minHeight: 44, borderRadius: 2.5, color: 'text.secondary' }, '& .Mui-selected': { bgcolor: '#F8FAFC', color: '#0F172A !important' } }}
          >
            <Tab value="events" label={<Stack direction="row" gap={1} alignItems="center">Events{pending.data?.length > 0 && <Chip size="small" color="error" label={`${pending.data.length} waiting`} sx={{ height: 22 }} />}</Stack>} />
            <Tab value="sensors" label="Sensors" />
            <Tab value="anatomy" label="Anatomy" />
          </Tabs>
          {tab === 'events' && (
            <Stack direction="row" alignItems="center" gap={1}>
              <EventFilter value={filter} onChange={setFilter} />
              <Box flex={1} />
              <Button endIcon={<ArrowIcon />} onClick={() => setAllEvents(true)}>Show all</Button>
            </Stack>
          )}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
            {tab === 'events' && (messages.data ? <EventList events={events} filter={filter} dense {...handlers} /> : <LinearProgress />)}
            {tab === 'sensors' && <SensorsTab row={row} sensors={sensors} log={log.current} operator={operator} onPick={showAnatomy} />}
            {tab === 'anatomy' && <AnatomyTab row={row} sensors={sensors} lit={lit} onClear={() => setLit(null)} events={events} onOpen={handlers.onOpen} />}
          </Box>
        </Card>

        <Box sx={{ gridArea: 'actions', display: 'grid', gap: 1.5, gridTemplateColumns: fit ? '1fr' : '1fr 1fr' }}>
          <Button variant="contained" color="secondary" onClick={ask} disabled={asking} startIcon={asking ? <CircularProgress size={22} color="inherit" /> : <ChatIcon />} sx={{ minHeight: 60, fontSize: 19, fontWeight: 800, borderRadius: 3 }}>
            {asking ? 'Reading my sensors…' : 'Ask Dr. Macx'}
          </Button>
          <Button
            variant="outlined" color={question ? 'warning' : 'inherit'} onClick={() => setTalk({ question })} startIcon={<WaveIcon />}
            sx={{ minHeight: 60, fontSize: 19, fontWeight: 700, borderRadius: 3, borderColor: question ? undefined : 'divider' }}
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
        <EventList events={events} filter={filter} {...handlers} />
      </FullScreen>
      <FullScreen open={allSaid} onClose={() => setAllSaid(false)} title="What I said">
        <SaidList messages={messages.data} onReplay={(m) => voice.say(m.text)} onAnatomy={(t) => (setAllSaid(false), showAnatomy(t))} />
      </FullScreen>
      <FullScreen open={handovers} onClose={() => setHandovers(false)} title="Shift handovers">
        {handovers && <ThemeProvider theme={theme}><Box sx={{ bgcolor: '#fff', borderRadius: 3, p: 2 }}><Handovers machineId={machineId} /></Box></ThemeProvider>}
      </FullScreen>
      {talk && <VoiceDialog machineId={machineId} operator={operator} lang={lang} question={talk.question} onClose={() => setTalk(null)} onDone={reload} />}
      <Snackbar open={!!toast} autoHideDuration={6000} onClose={() => setToast('')}>
        <Alert severity="error" onClose={() => setToast('')} variant="filled">{toast}</Alert>
      </Snackbar>
    </Box>
  );
}

function Spec({ icon: Icon, label, value }) {
  return (
    <Stack direction="row" gap={1.25} alignItems="center" minWidth={0}>
      <Icon sx={{ color: 'text.secondary', fontSize: 28, display: { xs: 'none', xl: 'block' } }} />
      <Box minWidth={0}>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>{label}</Typography>
        <Typography fontWeight={700} noWrap>{value}</Typography>
      </Box>
    </Stack>
  );
}

const FRAME = { 'straight-side': 'Straight-side', 'c-frame': 'C-frame' };

function TopBar({ row, live, now, presses, operator, onSwitch, onHandovers, onExit }) {
  const setup = row.setup === 'premium' ? 'Premium' : 'Essential';
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,7fr) minmax(0,5fr)' } }}>
      <Card sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', columnGap: { xs: 1.5, xl: 2.5 }, rowGap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <Stack direction="row" gap={1.5} alignItems="center" minWidth={0}>
          <Box sx={{ width: 52, height: 52, borderRadius: 2.5, bgcolor: 'rgba(250,204,21,0.14)', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <BuildIcon sx={{ color: '#FACC15', fontSize: 30 }} />
          </Box>
          <Box minWidth={0}>
            <Stack direction="row" gap={1} alignItems="center">
              <TextField
                select variant="standard" value={row.id} onChange={(e) => onSwitch(e.target.value)}
                slotProps={{ input: { disableUnderline: true }, htmlInput: { 'aria-label': 'Change press' }, select: { renderValue: () => row.code } }}
                sx={{ '& .MuiSelect-select': { fontSize: 26, fontWeight: 800, py: 0, pr: '28px !important' } }}
              >
                {presses.map((m) => <MenuItem key={m.id} value={m.id}>{m.code} · {m.name}</MenuItem>)}
              </TextField>
              <StatusChip status={row.status} />
            </Stack>
            <Typography color="text.secondary" noWrap>{row.line} · {operator.name} ({operator.code})</Typography>
          </Box>
        </Stack>
        <Spec icon={FrameIcon} label="Press type" value={FRAME[row.frameType] ?? row.frameType} />
        <Spec icon={WeightIcon} label="Rated tonnage" value={`${row.ratedTonnage} t`} />
        <Spec icon={ChipIcon} label="Sensor setup" value={row.setup === 'premium' ? `${setup} (${row.nodes} nodes)` : setup} />
      </Card>
      <Card sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Box flex={1} />
        <Spec
          icon={CalendarIcon}
          label={new Date(now).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          value={new Date(now).toLocaleTimeString([], { hourCycle: 'h23' })}
        />
        <Chip label={`${live.shift.name} · ${hhmm(live.shift.start)}–${hhmm(live.shift.end)}`} sx={{ bgcolor: '#FACC15', color: '#111827', fontWeight: 800, height: 40, px: 0.5, fontSize: 15 }} />
        <Tooltip title="Shift handovers">
          <IconButton aria-label="Shift handovers" onClick={onHandovers} sx={{ border: 1, borderColor: 'divider' }}><HandoverIcon /></IconButton>
        </Tooltip>
        <Tooltip title="Sign out">
          <IconButton aria-label="Sign out" onClick={onExit} sx={{ border: 1, borderColor: 'divider' }}><LogoutIcon /></IconButton>
        </Tooltip>
      </Card>
    </Box>
  );
}

function Ring({ value, color, size = 150 }) {
  const r = (size - 18) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value ?? 0));
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={`OEE ${value == null ? 'not available' : `${Math.round(v * 100)} percent`}`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="14" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: size * 0.27, fontWeight: 800, lineHeight: 1 }}>
            {value == null ? '—' : Math.round(v * 100)}<Typography component="span" sx={{ fontSize: size * 0.12, fontWeight: 800 }}>%</Typography>
          </Typography>
          <Typography sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.06em' }}>OEE</Typography>
        </Box>
      </Box>
    </Box>
  );
}

const hours = (sec) => (sec / 3600).toFixed(1);

function OeePanel({ row, ring }) {
  const lv = (k) => LV[level(row[k], row.targets?.[k])];
  const good = row.total - row.ng;
  const factors = [
    { key: 'availability', label: 'Availability', sub: 'Run time', value: `${hours(row.runSec ?? 0)} / ${hours(row.plannedSec ?? 0)} h` },
    { key: 'performance', label: 'Performance', sub: 'Actual / ideal cycle', value: `${row.total ? ((row.runSec ?? 0) / row.total).toFixed(1) : '—'} / ${row.idealCycleTime} s` },
    { key: 'quality', label: 'Quality', sub: 'Good parts', value: `${num(good)} / ${num(row.total)}` },
  ];
  const o = lv('oee');
  return (
    <Card sx={{ ...panel, gridArea: 'oee' }}>
      <Stack direction="row" alignItems="center" gap={1} mb={0.75} flexWrap="wrap">
        <Typography variant="h6" component="h2" flex={1}>Overall Equipment Effectiveness</Typography>
        {o && <Typography variant="body2" fontWeight={700} sx={{ color: o.color }}>{o.label} (target {row.targets?.oee?.target}%)</Typography>}
      </Stack>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <Ring value={row.oee} color={o?.color ?? '#60A5FA'} size={ring} />
        <Box sx={{ flex: 1, flexBasis: { xs: '100%', sm: 0 }, display: 'grid', gap: 1.25, gridTemplateColumns: 'repeat(3, minmax(0,1fr))', minWidth: 0 }}>
          {factors.map((f) => {
            const l = lv(f.key);
            return (
              <Box key={f.key} sx={{ px: 1.5, py: 1.25, borderRadius: 3, bgcolor: 'rgba(148,163,184,0.07)', border: 1, borderColor: 'divider', minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" noWrap>{f.label}</Typography>
                <Stack direction="row" gap={1} alignItems="center" my={0.5}>
                  <Box sx={{ width: 6, height: 36, borderRadius: 3, bgcolor: l?.color ?? '#64748B', flex: 'none' }} />
                  <Typography sx={{ fontSize: { xs: 26, xl: 32 }, fontWeight: 800, lineHeight: 1 }}>
                    {row[f.key] == null ? '—' : Math.round(row[f.key] * 100)}<Typography component="span" sx={{ fontSize: 16, fontWeight: 800 }}>%</Typography>
                  </Typography>
                </Stack>
                <Typography variant="caption" component="div" noWrap>
                  <Box component="span" sx={{ color: l?.color ?? 'text.secondary', fontWeight: 700 }}>{l?.label ?? 'No data'}</Box>
                  <Box component="span" sx={{ color: 'text.secondary' }}> · {f.sub}</Box>
                </Typography>
                <Typography variant="body2" fontWeight={700} noWrap>{f.value}</Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Card>
  );
}

// The latest thing the press said, as a speech bubble (or its open question).
function Bubble({ messages, question, talking, onReplay, onAnswer, lines }) {
  const last = question ?? messages?.find((m) => m.kind !== 'operator');
  return (
    <Box
      sx={{ position: 'relative', flex: 'none', bgcolor: '#E6F6FB', color: '#0F172A', borderRadius: 4, p: lines < 3 ? 1.5 : 2, pr: 7, cursor: question ? 'pointer' : 'default' }}
      aria-live="polite" onClick={question ? onAnswer : undefined}
    >
      <Box sx={{ position: 'absolute', left: -11, top: 30, width: 0, height: 0, borderTop: '10px solid transparent', borderBottom: '10px solid transparent', borderRight: '12px solid #E6F6FB', display: { xs: 'none', sm: 'block' } }} />
      {question && <Chip size="small" label="Question for you · tap to answer" sx={{ bgcolor: '#FEF3C7', color: '#92400E', fontWeight: 700, mb: 0.75 }} />}
      <Typography sx={{ fontSize: 17, fontWeight: 600, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {last?.text ?? 'Hello! I will tell you when something changes. Ask me anything with the buttons below.'}
      </Typography>
      {last && (
        <Tooltip title={talking ? 'Speaking…' : 'Say it again'}>
          <IconButton
            aria-label="Say it again" onClick={(ev) => (ev.stopPropagation(), onReplay(last))}
            sx={{ position: 'absolute', right: 10, top: 10, bgcolor: '#DBEAFE', color: '#1D4ED8', '&:hover': { bgcolor: '#BFDBFE' }, animation: talking ? 'soulPulse 1s ease-in-out infinite' : 'none', '@keyframes soulPulse': { '50%': { transform: 'scale(1.12)' } } }}
          >
            <WaveIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

const DOT = { stop: SEV.error.color, anomaly: SEV.warn.color, risk: SEV.warn.color, question: SEV.warn.color, report: SEV.ok.color, cycle: SEV.info.color, handover: SEV.info.color, advice: SEV.info.color, operator: '#94A3B8' };

function Recent({ messages, events, onOpen, onAll }) {
  const byMessage = new Map(events.filter((e) => e.message).map((e) => [e.message.id, e]));
  return (
    <Box sx={{ flex: 1, minHeight: 150, maxHeight: { xs: 280, lg: 'none' }, display: 'flex', flexDirection: 'column', border: 1, borderColor: 'divider', borderRadius: 3, p: 1.5 }}>
      <Stack direction="row" alignItems="center" mb={0.5}>
        <Typography fontWeight={700} flex={1}>Recent messages</Typography>
        <Button size="small" endIcon={<ArrowIcon />} onClick={onAll}>View all</Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {!messages && <LinearProgress />}
        {messages?.length === 0 && <Typography variant="body2" color="text.secondary">Nothing yet.</Typography>}
        {messages?.map((m) => {
          const e = byMessage.get(m.id);
          return (
            <Stack
              key={m.id} direction="row" gap={1.25} alignItems="center" onClick={e ? () => onOpen(e) : undefined}
              role={e ? 'button' : undefined} tabIndex={e ? 0 : undefined} onKeyDown={e ? (ev) => ev.key === 'Enter' && onOpen(e) : undefined}
              sx={{ py: 0.6, px: 0.5, borderRadius: 1.5, cursor: e ? 'pointer' : 'default', '&:hover': e ? { bgcolor: 'action.hover' } : undefined }}
            >
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: DOT[m.kind] ?? '#94A3B8', flex: 'none' }} />
              <Typography variant="body2" color="text.secondary" sx={{ width: 42, flex: 'none' }}>{hhmm(m.at)}</Typography>
              <Typography variant="body2" noWrap flex={1}>{m.kind === 'operator' ? `You: ${m.text}` : m.text}</Typography>
            </Stack>
          );
        })}
      </Box>
    </Box>
  );
}

const KIND = { advice: 'Advice', report: 'Report', operator: 'You said', stop: 'Stop', risk: 'Target risk', question: 'Question', anomaly: 'Sensor alert', cycle: 'Cycle time', handover: 'Handover', info: 'Info' };

function SaidList({ messages, onReplay, onAnatomy }) {
  return (
    <Stack spacing={1.25} sx={{ maxWidth: 960 }}>
      {messages?.map((m) => (
        <Box key={m.id} sx={{ p: 1.5, borderRadius: 3, border: 1, borderColor: m.needsAnswer && !m.answered ? SEV.warn.line : 'divider', bgcolor: m.kind === 'operator' ? 'rgba(96,165,250,0.08)' : 'transparent' }}>
          <Stack direction="row" alignItems="center" gap={1} mb={0.5}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">{new Date(m.at).toLocaleString()}</Typography>
            <Chip size="small" label={KIND[m.kind] ?? m.kind} sx={{ height: 22 }} />
            <Box flex={1} />
            {m.kind !== 'operator' && <IconButton size="small" aria-label="Say it again" onClick={() => onReplay(m)}><ReplayIcon fontSize="small" /></IconButton>}
          </Stack>
          <Typography>{m.text}</Typography>
          {(m.data?.part || m.data?.node) && (
            <Button size="small" onClick={() => onAnatomy({ part: m.data.node ? 'loadCell' : m.data.part, node: m.data.node || null })} sx={{ mt: 0.5 }}>View in anatomy</Button>
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
  const bar = { good: '#22C55E', near: '#FACC15', below: '#EF4444' }[k] ?? '#60A5FA';
  const diff = projected - plan.shift;
  const stat = (label, value) => (
    <Box minWidth={0}>
      <Typography variant="body2" color="text.secondary" noWrap>{label}</Typography>
      <Typography component="div" sx={{ fontSize: { xs: 20, xl: 24 }, fontWeight: 800, lineHeight: 1.2 }} noWrap>{value}</Typography>
    </Box>
  );
  const signed = (v) => <Box component="span" sx={{ color: v < 0 ? '#F87171' : '#4ADE80' }}>{v >= 0 ? '+' : ''}{num(v)}</Box>;
  return (
    <Card sx={{ ...panel, gridArea: 'progress' }}>
      <Stack direction="row" alignItems="baseline" gap={1} flexWrap="wrap">
        <Typography variant="h6" component="h2" flex={1}>Production progress ({live.shift.name})</Typography>
        <Typography variant="body2" color="text.secondary">{duration(Math.max(0, live.shift.end - now))} left · plan = planned time ÷ ideal cycle ({row.idealCycleTime} s)</Typography>
      </Stack>
      <Stack direction="row" alignItems="center" gap={2} my={0.5}>
        <Box sx={{ position: 'relative', flex: 1, height: 14, borderRadius: 8, bgcolor: 'rgba(148,163,184,0.18)', overflow: 'hidden' }} role="img" aria-label={`Good ${good} of ${plan.shift} planned this shift; ${plan.toNow} due by now`}>
          <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, share * 100)}%`, bgcolor: bar, borderRadius: 8 }} />
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${plan.shift ? Math.min(100, (plan.toNow / plan.shift) * 100) : 0}%`, width: 3, bgcolor: '#F8FAFC' }} />
        </Box>
        <Typography sx={{ fontSize: 26, fontWeight: 800 }}>{Math.round(share * 100)}%</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        {stat('Good parts', <>{num(good)} <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.7em' }}>/ {num(plan.shift)}</Box></>)}
        {stat('Planned by now', num(plan.toNow))}
        {stat('Gap', signed(gap))}
        {stat('Projected end of shift', <>{num(projected)} <Box component="span" sx={{ fontSize: '0.7em' }}>({signed(diff)})</Box></>)}
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
        {question && <Box sx={{ p: 1.5, mb: 2, borderRadius: 3, bgcolor: SEV.warn.bg, border: `1px solid ${SEV.warn.line}` }}><Typography>{question.text}</Typography></Box>}
        <Typography color="text.secondary" mb={2}>Press the mic and tell me what happened, in any language. I check it against my sensors and keep it in my history.</Typography>
        <Stack direction="row" gap={1.5} alignItems="flex-start">
          {dictation.supported && (
            <IconButton
              aria-label={dictation.listening ? 'Stop recording' : 'Start recording'}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              sx={{ width: 64, height: 64, flex: 'none', bgcolor: dictation.listening ? 'rgba(239,68,68,0.2)' : 'rgba(96,165,250,0.18)', color: dictation.listening ? '#F87171' : '#93C5FD' }}
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
