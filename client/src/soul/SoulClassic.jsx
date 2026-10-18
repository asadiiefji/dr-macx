// The current Dr. Macx Live kiosk (on /soul), kept while the redesign is tried on /soul2 (Soul.jsx). Delete this file
// once one of them is chosen.
// Machine Soul: the kiosk screen next to a press. Pick the press, sign in with an employee number, then a full-screen
// dashboard: the press speaks for itself (3D character + voice), shows OEE, schedule vs actual, events, sensors and anatomy.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  ButtonBase, DialogTitle, Grid, IconButton, InputAdornment, LinearProgress, MenuItem, Snackbar, Stack, Tab, Tabs, TextField, Tooltip,
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
import BackIcon from '@mui/icons-material/ArrowBackRounded';
import CheckIcon from '@mui/icons-material/CheckRounded';
import DemoIcon from '@mui/icons-material/ScienceOutlined';
import UpIcon from '@mui/icons-material/NorthEastRounded';
import DownIcon from '@mui/icons-material/SouthEastRounded';
import HistoryIcon from '@mui/icons-material/HistoryRounded';
import StatusIcon from '@mui/icons-material/MonitorHeartOutlined';
import FoldIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { MachineStatus, SaidPanel, factsOf } from './Pieces.jsx';
import { api, useCollection, useGet, useLive } from '../api.js';
import { Logo, StatusChip, duration, num } from '../ui.jsx';
import { C, LEVELS, level } from '../theme.js';
import { useDictation } from '../StopConfirm.jsx';
import { sensorsFor, useSensorCatalog, valueOf } from '../sensors.js';
import PressCharacter, { EMOTIONS } from './PressCharacter.jsx';
import { BCP, useVoice } from './useVoice.js';
import { tone } from './tones.js';
import { TourButton, TourHost } from '../Tour.jsx';
import Handovers from '../Handovers.jsx';
import { Dual, I18nProvider, useLang, useT } from '../i18n.jsx';
import { BreakdownButton, FactorSim, useSim } from '../Simulate.jsx';
import { AnatomyTab, BulkConfirm, EventDetail, EventFilter, EventList, HistoryPopup, Popup, SEV, SensorsTab, buildEvents, hhmm } from './Panels.jsx';

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
  // every label on this screen follows the kiosk language (i18n.jsx)
  return (
    <I18nProvider lang={session.lang ?? 'en'}>
      {!session.machineId || !session.operator
        ? <Gate session={session} onDone={save} />
        : <Main key={session.machineId} session={session} onChange={save} onExit={() => save({ lang: session.lang })} />}
    </I18nProvider>
  );
}

// --- Step 1 + 2: pick the press, verify the employee number ---
function Gate({ session, onDone }) {
  const machines = useCollection('machines');
  const operators = useCollection('operators');
  const skills = useCollection('skills');
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
  // a demo sign-in: the first active operator cleared (skill 2+) on the picked press (or on the first press)
  const cleared = (pressId) => operators.rows
    .filter((o) => o.active !== false && skills.rows.some((k) => k.operatorId === o.id && k.machineId === pressId && k.level >= 2))
    .sort((a, b) => a.code.localeCompare(b.code))[0];
  const demoPress = machineId ? active.find((m) => m.id === machineId) : active.find((m) => cleared(m.id));
  const demo = demoPress && cleared(demoPress.id);
  const t = useT();
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 720 }}>
        <CardContent sx={{ p: { xs: 2.5, md: 4 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Logo />
            <Button component={RouterLink} to="/" startIcon={<BackIcon />}>{t('Back to Dr. Macx')}</Button>
          </Stack>
          <Typography variant="h4" component="h1" mt={3}>{t('Dr. Macx Live')}</Typography>
          <Typography color="text.secondary" mb={3}>{t('Pick the machine this screen stands next to, then sign in with your employee number.')}</Typography>
          <Typography variant="overline" component="h2">1 · {t('Machine')}</Typography>
          <Grid container spacing={1.5} mb={3}>
            {active.map((m) => (
              <Grid key={m.id} size={{ xs: 12, sm: 6 }}>
                <Card sx={{ borderColor: machineId === m.id ? C.blue : C.line, borderWidth: 2, bgcolor: machineId === m.id ? C.light : '#fff' }}>
                  <CardActionArea onClick={() => setMachineId(m.id)} aria-pressed={machineId === m.id} sx={{ p: 2, minHeight: 88 }}>
                    <Typography fontWeight={800} fontSize={18}>{m.code}</Typography>
                    <Typography variant="body2">{m.ratedTonnage ?? '—'} t · {t(FRAME[m.frameType] ?? m.frameType ?? '')}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.line} · {t(m.setup === 'premium' ? 'Premium sensors' : 'Essential sensors')}</Typography>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Typography variant="overline" component="h2">2 · {t('Operator')}</Typography>
          <Stack component="form" onSubmit={verify} direction={{ xs: 'column', sm: 'row' }} gap={1.5} mt={1}>
            <TextField
              label={t('Employee number')}
              value={code}
              onChange={(e) => (setCode(e.target.value), setError(''))}
              autoComplete="off"
              slotProps={{ htmlInput: { inputMode: 'text', style: { fontSize: 22, letterSpacing: '0.08em' } } }}
              sx={{ flex: 1 }}
            />
            <Button type="submit" variant="contained" size="large" disabled={!machineId || !code.trim() || busy} sx={{ minHeight: 56, px: 4 }}>
              {busy ? <CircularProgress size={22} color="inherit" /> : t('Start')}
            </Button>
          </Stack>
          {demo && (
            <Alert severity="info" sx={{ mt: 2 }} action={<Button color="inherit" size="small" onClick={() => (setMachineId(demoPress.id), setCode(demo.code), setError(''))} sx={{ whiteSpace: 'nowrap' }}>{t('Use')} {demo.code}</Button>}>
              {t('Trying it out? Sign in as the demo operator')} <b>{demo.code}</b> ({demo.name}) · {demoPress.code}
            </Alert>
          )}
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </CardContent>
      </Card>
    </Box>
  );
}

// Mood from the press's state: a fresh stop shocks it, sensor alarms alarm it, otherwise OEE vs target.
// Mood from the whole situation: a fresh stop shocks it, sensor alarms alarm it; otherwise what still waits for the
// operator (stops without a reason, questions) and where the shift is heading against its target. Happy only when
// nothing waits, the target is in reach and OEE is on target.
export function emotionOf(row, now, waiting = 0) {
  if (!row) return 'sleepy';
  if (['break', 'inactive', 'disconnected'].includes(row.status)) return 'sleepy';
  if (row.status === 'stopped') return now - row.since < 20000 ? 'shocked' : 'worried';
  if (Object.values(row.sensorStatus ?? {}).includes('alarm')) return 'alarmed';
  const f = row.forecast;
  const oee = level(row.oee, row.targets?.oee);
  if (waiting >= 5 || (f && (!f.reachable || f.projected < f.target * 0.85))) return 'sad';
  if (waiting > 0 || (f && f.projected < f.target) || oee === 'below') return 'worried';
  return oee === 'good' ? 'happy' : 'calm';
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
  const [openEv, setOpenEv] = useState(null); // the event shown in detail (this shift, or one from the history)
  const [history, setHistory] = useState(null); // null, or the mode the history popup opens in: 'shift' | 'earlier'
  const [refresh, setRefresh] = useState(0);
  const [allSaid, setAllSaid] = useState(false);
  const [handovers, setHandovers] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false); // machine status popup (from the top bar)
  const [recentOpen, setRecentOpen] = useState(false); // recent messages popup (History button)
  const [talk, setTalk] = useState(null); // { question } while the voice dialog is open
  const [asked, setAsked] = useState(null); // Ask Dr. Macx popup: { loading } → { msg } or { error }
  const [toast, setToast] = useState('');
  const t = useT();

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
      if (m.kind === 'operator') return;
      // a tone first (different per kind), then the voice; a stop already rang when it appeared in the list
      const wait = voiceOn && m.kind !== 'stop' ? tone(m.kind) : 0;
      setTimeout(() => voice.say(m.text), wait);
    });
  }, [messages.data, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new stop (or breakdown) rings the alarm tone as soon as it shows in the list.
  const seenStops = useRef(null);
  useEffect(() => {
    if (!pending.data) return;
    if (!seenStops.current) {
      seenStops.current = new Set(pending.data.map((e) => e.id));
      return;
    }
    const fresh = pending.data.filter((e) => !seenStops.current.has(e.id));
    fresh.forEach((e) => seenStops.current.add(e.id));
    if (fresh.length && voiceOn) tone('stop');
  }, [pending.data]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // The Events tab is this shift only: what the press said, stops and questions since the shift began. Stops still
  // waiting from earlier shifts sit behind a button (history popup), so they are not asked of this shift's operator.
  const shiftStart = live?.shift.start ?? 0;
  const pendingNow = useMemo(() => (pending.data ?? []).filter((e) => e.start >= shiftStart), [pending.data, shiftStart]);
  const pendingBefore = useMemo(() => (pending.data ?? []).filter((e) => e.start < shiftStart), [pending.data, shiftStart]);
  const events = useMemo(
    () => buildEvents(messages.data?.filter((m) => m.at >= shiftStart), pendingNow, shiftStops.data?.events?.filter((e) => e.confirmed), sensors, catalog?.alarmSensors),
    [messages.data, pendingNow, shiftStops.data, catalog, shiftStart], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!live) return <LinearProgress />;
  if (!row) return <Alert severity="warning" sx={{ m: 2 }}>{t('This machine is no longer monitored.')} <Button onClick={onExit}>{t('Pick another')}</Button></Alert>;

  const question = messages.data?.find((m) => m.needsAnswer && !m.answered && m.at >= live.shift.start);
  const said = question ?? messages.data?.find((m) => m.kind !== 'operator'); // what the message panel shows
  const opened = openEv && (events.find((e) => e.id === openEv.id) ?? openEv);
  const waiting = events.filter((e) => e.stop || e.needsAnswer).length; // stops and questions waiting for the operator
  const emotion = emotionOf(row, now, waiting);
  const mood = EMOTIONS[emotion];
  const demo = !!session.demo;
  const showAnatomy = (target) => (setLit(target), setTab('anatomy'), setOpenEv(null), setHistory(null));
  const reload = () => (messages.reload(), pending.reload(), shiftStops.reload?.(), setRefresh((x) => x + 1));
  const handlers = { onOpen: setOpenEv, onAnatomy: showAnatomy, onAnswer: (q, preset) => setTalk({ question: q, preset }) };
  // tap answers for "explain": this shift's most frequent stop reasons, else the first unplanned reasons
  const quick = (() => {
    const count = new Map();
    for (const e of [...pendingNow, ...(shiftStops.data?.events ?? [])]) if (e.reason) count.set(e.reason, (count.get(e.reason) ?? 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1]).map(([r]) => r).filter((r) => !/not given|unmapped/i.test(r));
    return (top.length ? top : reasons.rows.filter((r) => r.type !== 'planned').map((r) => r.name)).slice(0, 5);
  })();

  // Ask Dr. Macx: a popup where the press thinks while Gemini reads its sensors, then says the answer (subtitled).
  const ask = async () => {
    setAsked({ loading: true });
    try {
      const msg = await api(`/machines/${machineId}/soul/ask`, { method: 'POST', body: { lang } });
      heard.current?.add(msg.id); // spoken here, so the history watcher does not say it again
      voice.say(msg.text);
      setAsked((a) => a && { msg });
      messages.reload();
    } catch (e) {
      setAsked((a) => a && { error: e.message });
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
      <TopBar row={row} live={live} now={now} operator={operator} onStatus={() => setStatusOpen(true)} onHandovers={() => setHandovers(true)} onExit={onExit} demo={demo} onDemo={() => onChange({ ...session, demo: !demo })} />

      <Box
        sx={{
          display: 'grid', gap: 1.5, minHeight: 0,
          gridTemplateColumns: fit ? 'minmax(0,9fr) minmax(0,3fr)' : '1fr',
          gridTemplateRows: fit ? 'auto minmax(0,1fr) auto' : 'none',
          gridTemplateAreas: fit ? '"oee tabs" "soul tabs" "progress tabs"' : '"oee" "soul" "progress" "tabs"',
        }}
      >
        <OeePanel row={row} ring={short ? 112 : 132} demo={demo} lang={lang} onAdvice={messages.reload} />

        {/* Machine Soul: the face in its own area, what I said beside it */}
        <Card data-tour="kiosk-soul" sx={{ ...panel, gridArea: 'soul', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <Typography fontWeight={700} fontSize={16} component="h2">{t('Dr. Macx Live')}</Typography>
            <Chip size="small" label={t(`${mood.label} mood`)} sx={{ height: 22, fontSize: 12, bgcolor: `${mood.color}22`, color: C.ink, border: `1px solid ${mood.color}` }} />
            <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}>{t('Your AI assistant for')} {row.name}</Typography>
            <Box flex={1} />
            <Button data-tour="kiosk-history" variant="outlined" color="inherit" startIcon={<HistoryIcon />} onClick={() => setRecentOpen(true)} sx={{ ...tight, px: 1.5, borderColor: C.line, borderRadius: R.inner, fontWeight: 600 }}>
              {t('History')}
            </Button>
            <TextField
              data-tour="kiosk-lang"
              select size="small" value={lang} onChange={(e) => onChange({ ...session, lang: e.target.value })}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><GlobeIcon sx={{ fontSize: 18 }} /></InputAdornment> }, htmlInput: { 'aria-label': t('Kiosk language') } }}
              sx={{ minWidth: 150, '& .MuiInputBase-root': tight, '& .MuiSelect-select': { py: 0 } }}
            >
              {Object.entries(languages).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <Tooltip title={t(voiceOn ? 'Mute my voice' : 'Turn my voice on')}>
              <IconButton aria-label={t(voiceOn ? 'Mute my voice' : 'Turn my voice on')} onClick={() => onChange({ ...session, voice: !voiceOn })} sx={{ border: `1px solid ${C.line}`, borderRadius: R.inner, width: 36, height: 36 }}>
                {voiceOn ? <VolumeUpIcon fontSize="small" /> : <VolumeOffIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,4fr) minmax(0,5fr)' } }}>
            <Box sx={{ position: 'relative', minHeight: 220, borderRadius: R.inner, border: `1px solid ${C.line}`, background: `radial-gradient(circle at 50% 55%, ${C.light}, #FFFFFF 72%)`, overflow: 'hidden' }}>
              <Box sx={{ position: 'absolute', inset: 0 }}>
                <PressCharacter emotion={emotion} talking={voice.talking} running={row.status === 'running'} reduced={reduced} />
              </Box>
              {voice.talking && <Chip size="small" color="primary" icon={<WaveIcon />} label={t('Speaking…')} sx={{ position: 'absolute', left: 10, bottom: 10 }} />}
            </Box>
            <SaidPanel
              said={said} question={question} row={row} now={now} short={short} talking={voice.talking} onReplay={(m) => voice.say(m.text)}
              facts={factsOf([...pendingNow, ...(shiftStops.data?.events ?? [])], row, now)} hello="Hello! I will tell you when something changes. Ask me anything with the buttons below."
            >
              <Box data-tour="kiosk-actions" sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
                <Button variant="contained" onClick={ask} disabled={asked?.loading} startIcon={<ChatIcon />} sx={{ minHeight: 38, fontSize: 14, fontWeight: 700, borderRadius: R.inner }}>
                  {t('Ask Dr. Macx')}
                </Button>
                <Button
                  variant="outlined" color="primary" onClick={() => setTalk({ question })} startIcon={<WaveIcon />}
                  sx={{ minHeight: 38, fontSize: 14, fontWeight: 700, borderRadius: R.inner, bgcolor: '#FFFFFF', ...(question && { borderWidth: 2, borderColor: SEV.ask.color, color: SEV.ask.text, '&:hover': { borderWidth: 2, borderColor: SEV.ask.text } }) }}
                >
                  {t(question ? 'Answer my question' : 'Explain by voice')}
                </Button>
              </Box>
            </SaidPanel>
          </Box>
        </Card>

        <Progress row={row} live={live} now={now} />

        <Card data-tour="kiosk-tabs" sx={{ ...panel, p: 1.25, gridArea: 'tabs', display: 'flex', flexDirection: 'column', gap: 1, height: fit ? 'auto' : 640 }}>
          <Tabs
            value={tab} onChange={(e, v) => setTab(v)} variant="fullWidth"
            sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0, fontSize: 13.5, px: 1 } }}
          >
            <Tab value="events" label={<Stack direction="row" gap={0.75} alignItems="center">{t('Events')}{waiting > 0 && <Chip size="small" color="error" label={waiting} sx={{ height: 18, fontSize: 11, '& .MuiChip-label': { px: 0.75 } }} />}</Stack>} />
            <Tab value="sensors" label={t('Sensors')} />
            <Tab value="anatomy" label={t('Anatomy')} />
          </Tabs>
          {tab === 'events' && (
            <Stack direction="row" alignItems="center" gap={1}>
              <EventFilter value={filter} onChange={setFilter} />
              <Box flex={1} />
              <Button data-tour="kiosk-showall" size="small" endIcon={<ArrowIcon />} onClick={() => setHistory('shift')} sx={{ minHeight: 32, whiteSpace: 'nowrap' }}>{t('Show all')}</Button>
            </Stack>
          )}
          {tab === 'events' && pendingBefore.length > 0 && (
            <Button size="small" variant="outlined" color="inherit" onClick={() => setHistory('earlier')} sx={{ minHeight: 30, justifyContent: 'space-between', borderColor: C.line, borderRadius: R.inner, fontSize: 12.5 }} endIcon={<ArrowIcon />}>
              {pendingBefore.length} {t('stops from earlier shifts wait for a reason')}
            </Button>
          )}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.25 }}>
            {tab === 'events' && (filter === 'all' || filter === 'downtime') && (
              <BulkConfirm stops={pendingNow} reasons={reasons.rows} machineId={machineId} operatorId={operator.id} onDone={reload} />
            )}
            {tab === 'events' && (messages.data ? <EventList events={events} filter={filter} dense {...handlers} /> : <LinearProgress />)}
            {tab === 'sensors' && <SensorsTab row={row} sensors={sensors} log={log.current} operator={operator} onPick={showAnatomy} />}
            {tab === 'anatomy' && <AnatomyTab row={row} sensors={sensors} lit={lit} onClear={() => setLit(null)} events={events} onOpen={handlers.onOpen} />}
          </Box>
        </Card>

      </Box>

      {opened && (
        <EventDetail
          e={opened} row={row} sensors={sensors} reasons={reasons.rows} operator={operator} lang={lang}
          onClose={() => setOpenEv(null)} onSaved={reload} onReplay={(m) => voice.say(m.text)} onAnswer={handlers.onAnswer}
        />
      )}
      <HistoryPopup
        open={!!history} startMode={history ?? 'shift'} onClose={() => setHistory(null)} machineId={machineId} lang={lang} live={live} sensors={sensors}
        alarmSensors={catalog?.alarmSensors} earlier={pendingBefore} reasons={reasons.rows} operator={operator} refresh={refresh} onConfirmed={reload} handlers={handlers}
      />
      <Popup open={allSaid} onClose={() => setAllSaid(false)} title={t('What I said')}>
        <SaidList messages={messages.data} onReplay={(m) => voice.say(m.text)} onAnatomy={(target) => (setAllSaid(false), showAnatomy(target))} />
      </Popup>
      <Popup open={statusOpen} size="half" onClose={() => setStatusOpen(false)} title={`${row.code} · ${t('Machine status')}`}>
        <MachineStatus row={row} now={now} />
      </Popup>
      <Popup open={recentOpen} size="half" onClose={() => setRecentOpen(false)} title={t('History')}>
        <Box sx={{ height: { xs: '60vh', md: '55vh' }, display: 'flex' }}>
          <Recent messages={messages.data} events={events} onOpen={(e) => (setRecentOpen(false), handlers.onOpen(e))} onAll={() => (setRecentOpen(false), setAllSaid(true))} />
        </Box>
      </Popup>
      <Popup open={handovers} size="half" onClose={() => setHandovers(false)} title={t('Shift handovers')}>
        {handovers && <Handovers machineId={machineId} />}
      </Popup>
      {asked && (
        <AskPopup
          asked={asked} emotion={emotion} voice={voice} voiceOn={voiceOn} reduced={reduced} running={row.status === 'running'} machineId={machineId} lang={lang}
          onAgain={ask} onClose={() => (voice.stop?.(), setAsked(null))}
        />
      )}
      {talk && <VoiceDialog machineId={machineId} operator={operator} lang={lang} question={talk.question} preset={talk.preset} quick={quick} onClose={() => setTalk(null)} onDone={reload} />}
      <TourHost firstVisit="kioskClassic" />
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

function TopBar({ row, live, now, operator, onStatus, onHandovers, onExit, demo, onDemo }) {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'en' ? undefined : BCP[lang];
  const setup = t(row.setup === 'premium' ? 'Premium' : 'Essential');
  const iconBtn = { border: `1px solid ${C.line}`, borderRadius: R.inner, width: 36, height: 36 };
  return (
    <Card data-tour="kiosk-top" sx={{ ...panel, px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', columnGap: 2.5, rowGap: 1, flexWrap: 'wrap' }}>
      {/* the machine of this kiosk session (sign out to pick another); tap it for the machine status */}
      <Tooltip title={t('Machine status')}>
        <ButtonBase onClick={onStatus} aria-label={`${row.code} · ${t('Machine status')}`} sx={{ borderRadius: R.inner, p: 0.5, m: -0.5, justifyContent: 'flex-start', textAlign: 'left', '&:hover': { bgcolor: '#F1F5F9' } }}>
          <Stack direction="row" gap={1.25} alignItems="center" minWidth={0}>
            <Box sx={{ width: 36, height: 36, borderRadius: R.inner, bgcolor: C.light, display: 'grid', placeItems: 'center', flex: 'none' }}>
              <BuildIcon sx={{ color: C.blue, fontSize: 22 }} />
            </Box>
            <Box minWidth={0}>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography sx={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2 }}>{row.code}</Typography>
                <StatusChip status={row.status} />
                <StatusIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap component="div">{row.line} · {operator.name} ({operator.code})</Typography>
            </Box>
          </Stack>
        </ButtonBase>
      </Tooltip>
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: C.line, display: { xs: 'none', md: 'block' } }} />
      <Spec label={t('Machine type')} value={t(FRAME[row.frameType] ?? row.frameType)} />
      <Spec label={t('Rated tonnage')} value={`${row.ratedTonnage} t`} />
      <Spec label={t('Sensor setup')} value={row.setup === 'premium' ? `${setup} · ${row.nodes} ${t('nodes')}` : setup} />
      <Box flex={1} />
      <Stack direction="row" gap={1} alignItems="center">
        <CalendarIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
        <Spec label={new Date(now).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} value={new Date(now).toLocaleTimeString(locale, { hourCycle: 'h23' })} />
      </Stack>
      <Chip label={`${t(live.shift.name)} · ${hhmm(live.shift.start)}–${hhmm(live.shift.end)}`} sx={{ bgcolor: C.light, color: C.blueDark, fontWeight: 700, height: 32, borderRadius: R.inner }} />
      {/* demo mode shows the simulation controls (breakdown, lower / better per OEE factor); off on a real shop floor */}
      {row.sim && (
        <Tooltip title={t(demo ? 'Demo mode: simulation controls are shown. Turn off for real use.' : 'Real mode. Turn on demo mode to show the simulation controls.')}>
          <Button
            data-tour="kiosk-demo" size="small" variant={demo ? 'contained' : 'outlined'} color={demo ? 'warning' : 'inherit'} onClick={onDemo} aria-pressed={demo}
            startIcon={<DemoIcon />} sx={{ minHeight: 32, borderRadius: R.inner, borderColor: C.line, whiteSpace: 'nowrap' }}
          >
            {t(demo ? 'Demo mode on' : 'Demo mode off')}
          </Button>
        </Tooltip>
      )}
      <Stack direction="row" gap={0.75} alignItems="center">
        <TourButton id="kioskClassic" />
        <Tooltip title={t('Shift handovers')}><IconButton data-tour="kiosk-handovers" aria-label={t('Shift handovers')} onClick={onHandovers} sx={iconBtn}><HandoverIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title={t('Sign out')}><IconButton aria-label={t('Sign out')} onClick={onExit} sx={iconBtn}><LogoutIcon fontSize="small" /></IconButton></Tooltip>
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

// Demo mode: make the press give its advice now (normally on the schedule in Settings › Dr. Macx Live).
function AdviceNow({ machineId, lang, onDone }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api(`/machines/${machineId}/soul/ask`, { method: 'POST', body: { lang } });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip title={t('Demo: the machine gives its advice now (normally on the schedule in Settings)')}>
      <Button size="small" variant="outlined" onClick={go} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : <ChatIcon />} sx={{ minHeight: 28, py: 0, px: 1.25, fontSize: 12.5, borderRadius: '6px' }}>
        {t('Advice now')}
      </Button>
    </Tooltip>
  );
}

// The last 15 minutes next to the shift figure: moves within a minute when the press (or the simulation) changes.
function Recent15({ now, shift, target, inline }) {
  const t = useT();
  if (now == null) return null;
  const l = LV[level(now, target)];
  const Arrow = shift != null && now > shift + 0.005 ? UpIcon : shift != null && now < shift - 0.005 ? DownIcon : null;
  return (
    <Tooltip title={t('Last 15 minutes (the big number is the whole shift so far)')}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, ml: inline ? 0.5 : 'auto', fontSize: 12.5, fontWeight: 700, color: l?.color ?? 'text.secondary' }}>
        {!inline && <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.25 }}>{t('15 min')}</Box>}
        {Math.round(now * 100)}%{Arrow && <Arrow sx={{ fontSize: 16 }} />}
      </Box>
    </Tooltip>
  );
}

function OeePanel({ row, ring, demo, lang, onAdvice }) {
  const t = useT();
  const sim = useSim(row); // simulation controls show only for dummy-generator presses (row.sim)
  const lv = (k) => LV[level(row[k], row.targets?.[k])];
  const good = row.total - row.ng;
  const factors = [
    { key: 'availability', label: 'Availability', sub: 'Run time', value: `${hours(row.runSec ?? 0)} / ${hours(row.plannedSec ?? 0)} h` },
    { key: 'performance', label: 'Performance', sub: 'Cycle time', value: `${row.total ? ((row.runSec ?? 0) / row.total).toFixed(1) : '—'} / ${row.idealCycleTime} s` },
    { key: 'quality', label: 'Quality', sub: 'Good parts', value: `${num(good)} / ${num(row.total)}` },
  ];
  const o = lv('oee');
  return (
    <Card data-tour="kiosk-oee" sx={{ ...panel, gridArea: 'oee', display: 'flex', gap: 2.5, alignItems: 'center', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
      <Ring value={row.oee} color={o?.ring ?? C.blue} size={ring} />
      <Box sx={{ flex: 1, minWidth: 0, flexBasis: { xs: '100%', sm: 0 } }}>
        <Stack direction="row" alignItems="center" gap={1} mb={0.75} flexWrap="wrap">
          <Typography fontWeight={700} fontSize={15} component="h2" flex={1}><Dual en="Overall Equipment Effectiveness" /></Typography>
          {row.last15 && (
            <Typography variant="body2" color="text.secondary">
              {t('Last 15 min')} <Recent15 now={row.last15.oee} shift={row.oee} target={row.targets?.oee} inline />
            </Typography>
          )}
          {demo && <AdviceNow machineId={row.id} lang={lang} onDone={onAdvice} />}
          {demo && row.sim && <BreakdownButton sim={sim} />}
          {o && <Chip size="small" label={`${t(o.label)} · ${t('target')} ${row.targets?.oee?.target}%`} sx={{ height: 24, bgcolor: o.bg, color: o.color, fontWeight: 700 }} />}
        </Stack>
        {sim.error && <Typography variant="caption" color="error" component="div" mb={0.5}>{sim.error}</Typography>}
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          {factors.map((f) => {
            const l = lv(f.key);
            return (
              <Box key={f.key} sx={{ px: 1.25, py: 0.75, borderRadius: R.inner, border: `1px solid ${C.line}`, minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" noWrap><Dual en={f.label} /></Typography>
                <Stack direction="row" gap={1} alignItems="center" my={0.25}>
                  <Box sx={{ width: 4, height: 20, borderRadius: 2, bgcolor: l?.ring ?? '#94A3B8', flex: 'none' }} />
                  <Typography sx={{ fontSize: 21, fontWeight: 800, lineHeight: 1.1 }}>
                    {row[f.key] == null ? '—' : Math.round(row[f.key] * 100)}<Typography component="span" sx={{ fontSize: 14, fontWeight: 800 }}>%</Typography>
                  </Typography>
                  <Recent15 now={row.last15?.[f.key]} shift={row[f.key]} target={row.targets?.[f.key]} />
                </Stack>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Typography variant="caption" color="text.secondary" noWrap component="div" flex={1} minWidth={0}>
                    <b style={{ color: l?.color }}>{t(l?.label ?? 'No data')}</b> · {t(f.sub)} <b style={{ color: C.ink }}>{f.value}</b>
                  </Typography>
                  {demo && row.sim && <FactorSim m={row} factor={f.key} sim={sim} />}
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Card>
  );
}

const DOT = { stop: SEV.error.color, anomaly: SEV.warn.color, risk: SEV.warn.color, question: SEV.ask.color, report: SEV.ok.color, cycle: SEV.info.color, handover: SEV.info.color, advice: SEV.info.color, operator: '#94A3B8' };
const KIND = { advice: 'Advice', report: 'Report', operator: 'You said', stop: 'Stop', risk: 'Target risk', question: 'Question', anomaly: 'Sensor alert', cycle: 'Cycle time', handover: 'Handover', info: 'Info' };

function Recent({ messages, events, onOpen, onAll }) {
  const t = useT();
  const byMessage = new Map(events.filter((e) => e.message).map((e) => [e.message.id, e]));
  return (
    <Box sx={{ flex: 1, minHeight: 140, maxHeight: { xs: 300, lg: 'none' }, display: 'flex', flexDirection: 'column', border: `1px solid ${C.line}`, borderRadius: R.inner }}>
      <Stack direction="row" alignItems="center" sx={{ px: 1.25, py: 0.5, borderBottom: `1px solid ${C.line}` }}>
        <Typography fontWeight={700} fontSize={13.5} flex={1}>{t('Recent messages')}</Typography>
        <Button size="small" endIcon={<ArrowIcon />} onClick={onAll} sx={{ minHeight: 28, py: 0 }}>{t('View all')}</Button>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', py: 0.5 }}>
        {!messages && <LinearProgress />}
        {messages?.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ px: 1.25 }}>{t('Nothing yet.')}</Typography>}
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
              <Typography variant="body2" color="text.secondary" sx={{ width: 96, flex: 'none', fontSize: 12 }} noWrap>{t(KIND[m.kind] ?? m.kind)}</Typography>
              <Typography variant="body2" noWrap flex={1} sx={{ fontSize: 13 }}>{m.text}</Typography>
            </Stack>
          );
        })}
      </Box>
    </Box>
  );
}

function SaidList({ messages, onReplay, onAnatomy }) {
  const t = useT();
  const lang = useLang();
  return (
    <Stack spacing={1}>
      {messages?.map((m) => (
        <Box key={m.id} sx={{ p: 1.25, borderRadius: R.inner, border: `1px solid ${m.needsAnswer && !m.answered ? SEV.warn.line : C.line}`, bgcolor: m.kind === 'operator' ? C.light : '#FFFFFF' }}>
          <Stack direction="row" alignItems="center" gap={1} mb={0.25}>
            <Typography variant="caption" fontWeight={700} color="text.secondary">{new Date(m.at).toLocaleString(lang === 'en' ? undefined : BCP[lang])}</Typography>
            <Chip size="small" label={t(KIND[m.kind] ?? m.kind)} sx={{ height: 20, fontSize: 11 }} />
            <Box flex={1} />
            {m.kind !== 'operator' && <IconButton size="small" aria-label={t('Say it again')} onClick={() => onReplay(m)}><ReplayIcon fontSize="small" /></IconButton>}
          </Stack>
          <Typography variant="body2">{m.text}</Typography>
          {(m.data?.part || m.data?.node) && (
            <Button size="small" onClick={() => onAnatomy({ part: m.data.node ? 'loadCell' : m.data.part, node: m.data.node || null })} sx={{ mt: 0.5, minHeight: 28 }}>{t('View in anatomy')}</Button>
          )}
          {m.data?.actions?.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>{m.data.actions.map((a, i) => <Typography key={i} component="li" variant="body2" color="text.secondary">{t(a)}</Typography>)}</Box>
          )}
        </Box>
      ))}
    </Stack>
  );
}

// Schedule vs actual for this shift: good pieces of the shift plan, where the schedule is now, and the projected end.
function Progress({ row, live, now }) {
  const t = useT();
  const [open, setOpen] = useState(false); // the figures (actual, plan, projected) open above the bar
  // the shift forecast from the server: the same numbers the press says out loud and the handover writes
  const f = row.forecast ?? { good: 0, toNow: 0, plan: 0, target: 0, projected: 0 };
  const { good, projected } = f;
  const plan = { toNow: f.toNow, shift: f.plan };
  const share = plan.shift ? good / plan.shift : 0;
  const k = level(plan.toNow ? good / plan.toNow : null, row.targets?.oee);
  const diff = projected - f.target;
  // one column per figure: label, the number, what it means (as in the reference)
  const stat = (label, value, note, color = C.ink, noteColor = 'text.secondary') => (
    <Box minWidth={0}>
      <Typography variant="body2" color="text.secondary" noWrap sx={{ fontSize: 12.5 }}>{label}</Typography>
      <Typography component="div" sx={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, color, letterSpacing: '-0.01em' }} noWrap>{value}</Typography>
      <Typography variant="body2" noWrap sx={{ color: noteColor, fontSize: 12 }}>{note}</Typography>
    </Box>
  );
  return (
    <Card data-tour="kiosk-progress" sx={{ ...panel, py: 0.5, gridArea: 'progress' }}>
      <ButtonBase
        onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t(open ? 'Hide the production figures' : 'Show the production figures')}
        sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: R.inner }}
      >
        {open && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap mb={0.5}>
            {num(plan.toNow)} {t('pcs due by now')} · {t('plan = planned time ÷ ideal cycle time')} ({row.idealCycleTime} s)
          </Typography>
        )}
        {open && (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(3, minmax(0,1fr))', pb: 1, mb: 0.75, borderBottom: `1px solid ${C.line}` }}>
            {stat(t('Actual Qty by Now'), num(good), t('pcs produced'), k ? LEVELS[k].color : C.ink)}
            {stat(t('Schedule Plan'), num(plan.shift), t('pcs per shift'))}
            {stat(t('Projected End Shift'), num(projected), `${num(Math.abs(diff))} ${t(diff < 0 ? 'pcs below target' : 'pcs above target')} (${num(f.target)})`, C.ink, diff < 0 ? LEVELS.below.color : LEVELS.good.color)}
          </Box>
        )}
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Typography fontWeight={700} fontSize={13} component="h2" noWrap>{t('Production progress')} · {t(live.shift.name)}</Typography>
          <Box sx={{ position: 'relative', flex: 1, height: 8, borderRadius: 4, bgcolor: '#E2E8F0', overflow: 'hidden' }} role="img" aria-label={`${t('Actual qty by now')} ${good} · ${t('Schedule plan')} ${plan.shift}`}>
            <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, share * 100)}%`, bgcolor: k ? LEVELS[k].bar : C.blue, borderRadius: 4 }} />
            <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${plan.shift ? Math.min(100, (plan.toNow / plan.shift) * 100) : 0}%`, width: 2, bgcolor: C.ink }} />
          </Box>
          <Typography variant="caption" color="text.secondary" noWrap>{duration(Math.max(0, live.shift.end - now))} {t('left')}</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{Math.round(share * 100)}%</Typography>
          <FoldIcon sx={{ fontSize: 20, color: 'text.secondary', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </Stack>
      </ButtonBase>
    </Card>
  );
}

// Ask Dr. Macx: the screen dims, the press thinks while Gemini reads its sensors and history, then says the
// answer with a subtitle under its face.
function AskPopup({ asked, emotion, voice, voiceOn, reduced, running, onAgain, onClose, machineId, lang }) {
  const t = useT();
  const msg = asked.msg;
  // with the voice muted the mouth still moves, for about as long as the answer takes to say
  const [mouth, setMouth] = useState(false);
  useEffect(() => {
    if (!msg || voiceOn) return undefined;
    setMouth(true);
    const id = setTimeout(() => setMouth(false), Math.min(20000, msg.text.split(/\s+/).length * 380));
    return () => clearTimeout(id);
  }, [msg, voiceOn]);
  const talking = voice.talking || mouth;
  const face = asked.loading ? 'thinking' : asked.error ? 'worried' : emotion === 'sleepy' ? 'calm' : emotion;
  return (
    <Popup open size="wide" fill onClose={onClose} title={t('Ask Dr. Macx')}>
      {/* left: my face and what I say (scrolls on its own); right: the chat (only the conversation scrolls) */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0,1fr) minmax(0,1fr)' } }}>
        <Box minWidth={0} sx={{ overflowY: { lg: 'auto' }, minHeight: 0, pr: { lg: 0.5 } }}>
      <Box sx={{ position: 'relative', height: { xs: 240, md: 300 }, borderRadius: R.inner, background: `radial-gradient(circle at 50% 55%, ${C.light}, #FFFFFF 72%)`, border: `1px solid ${C.line}` }}>
        <Box sx={{ position: 'absolute', inset: 0 }}>
          <PressCharacter emotion={face} talking={talking} running={running} reduced={reduced} />
        </Box>
        <Chip
          size="small" color={asked.loading ? 'default' : 'primary'} icon={asked.loading ? <CircularProgress size={12} /> : <WaveIcon />}
          label={t(asked.loading ? 'Thinking…' : talking ? 'Speaking…' : asked.error ? 'I could not answer' : 'Done')}
          sx={{ position: 'absolute', left: 10, top: 10, bgcolor: asked.loading ? '#FFFFFF' : undefined }}
        />
      </Box>
      {/* the subtitle: what I am saying */}
      <Box aria-live="polite" sx={{ mt: 1.5, px: 2, py: 1.5, borderRadius: R.inner, bgcolor: 'rgba(15,23,42,0.9)', color: '#FFFFFF', textAlign: 'center', minHeight: 64, display: 'grid', placeItems: 'center' }}>
        {asked.loading && (
          <Box width="100%">
            <Typography sx={{ fontSize: 16, mb: 1 }}>{t('Let me read my sensors and my history…')}</Typography>
            <LinearProgress />
          </Box>
        )}
        {msg && <Typography sx={{ fontSize: 17, lineHeight: 1.5 }}>{msg.text}</Typography>}
        {asked.error && <Typography sx={{ fontSize: 16, color: '#FCA5A5' }}>{asked.error}</Typography>}
      </Box>
      {msg?.data?.actions?.length > 0 && (
        <Box mt={1.5}>
          <Typography variant="overline" color="text.secondary">{t('What to do')}</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{msg.data.actions.map((x, i) => <Typography key={i} component="li" variant="body2">{t(x)}</Typography>)}</Box>
        </Box>
      )}
      <Stack direction="row" gap={1} justifyContent="flex-end" mt={2}>
        {msg && <Button startIcon={<ReplayIcon />} onClick={() => voice.say(msg.text)}>{t('Say it again')}</Button>}
        {!asked.loading && <Button variant="outlined" startIcon={<ChatIcon />} onClick={onAgain}>{t('Ask again')}</Button>}
        <Button variant="contained" onClick={onClose}>{t('Close')}</Button>
      </Stack>
        </Box>
        <ChatPanel machineId={machineId} lang={lang} />
      </Box>
    </Popup>
  );
}

// Chat with Dr. Macx, beside the status: the operator asks, the press answers from its live data (Gemini, in the
// kiosk language, POST /api/machines/:id/soul/chat). Only the conversation scrolls; the input stays in view.
const STARTERS = ['Why am I behind plan?', 'What should I check first?', 'Can we still reach the target?'];

function ChatPanel({ machineId, lang }) {
  const t = useT();
  const [msgs, setMsgs] = useState([]); // { role: 'user' | 'model', text, at }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef(null);
  const dictation = useDictation(BCP[lang] ?? 'en-US', (said) => setText((x) => `${x} ${said}`.trim()));
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [msgs, busy]);
  const ask = async (q) => {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...msgs, { role: 'user', text: question, at: Date.now() }];
    setMsgs(next);
    setText('');
    setBusy(true);
    setError('');
    try {
      const r = await api(`/machines/${machineId}/soul/chat`, { method: 'POST', body: { lang, messages: next.slice(-20).map(({ role, text: x }) => ({ role, text: x })) } });
      setMsgs((m) => [...m, { role: 'model', text: r.text, at: Date.now() }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const bubble = (m, i) => {
    const me = m.role === 'user';
    return (
      <Stack key={i} direction="row" justifyContent={me ? 'flex-end' : 'flex-start'} gap={1}>
        {!me && <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: '#F7A912', flex: 'none', display: 'grid', placeItems: 'center', color: '#3B2A05', fontWeight: 800, fontSize: 12 }} aria-hidden>Dr</Box>}
        <Box sx={{ maxWidth: '80%', px: 1.25, py: 0.75, borderRadius: '12px', ...(me ? { bgcolor: C.blue, color: '#FFFFFF', borderBottomRightRadius: '4px' } : { bgcolor: C.light, color: C.ink, borderBottomLeftRadius: '4px' }) }}>
          <Typography variant="body2" sx={{ lineHeight: 1.45, whiteSpace: 'pre-line' }}>{m.text}</Typography>
          {m.at && <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', textAlign: 'right', mt: 0.25 }}>{hhmm(m.at)}</Typography>}
        </Box>
      </Stack>
    );
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: { xs: 420, lg: 0 }, height: { lg: '100%' }, border: `1px solid ${C.line}`, borderRadius: R.inner, overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${C.line}`, bgcolor: '#F8FAFC', flex: 'none' }}>
        <ChatIcon sx={{ color: C.blue, fontSize: 20 }} />
        <Typography fontWeight={700} flex={1}>{t('Chat with Dr. Macx')}</Typography>
        <Chip size="small" label="Gemini" sx={{ height: 22, bgcolor: C.light, color: C.blueDark }} />
      </Stack>
      <Stack spacing={1.25} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }} role="log" aria-live="polite">
        {bubble({ role: 'model', text: t('Hi! Ask me anything about how I am doing: output, stops, sensors or what to check.') }, 'hello')}
        {msgs.length === 0 && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" pl={4.5}>
            {STARTERS.map((q) => <Chip key={q} label={t(q)} clickable onClick={() => ask(t(q))} variant="outlined" sx={{ height: 30, borderRadius: '8px', borderColor: C.line }} />)}
          </Stack>
        )}
        {msgs.map(bubble)}
        {busy && bubble({ role: 'model', text: '…' }, 'typing')}
        {error && <Alert severity="error">{error}</Alert>}
        <Box ref={end} />
      </Stack>
      <Stack component="form" onSubmit={(e) => (e.preventDefault(), ask(text))} direction="row" gap={1} alignItems="center" sx={{ p: 1, borderTop: `1px solid ${C.line}`, flex: 'none' }}>
        <TextField size="small" fullWidth placeholder={t('Ask Dr. Macx anything…')} value={text} onChange={(e) => setText(e.target.value)} slotProps={{ htmlInput: { maxLength: 2000, 'aria-label': t('Your question') } }} />
        {dictation.supported && (
          <IconButton aria-label={t(dictation.listening ? 'Stop recording' : 'Start recording')} onClick={dictation.listening ? dictation.stop : dictation.start} sx={{ border: `1px solid ${C.line}`, borderRadius: R.inner, width: 40, height: 40, color: dictation.listening ? 'error.main' : C.blue }}>
            {dictation.listening ? <StopIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </IconButton>
        )}
        <Button type="submit" variant="contained" disabled={!text.trim() || busy} sx={{ minHeight: 40, borderRadius: R.inner }}>{t('Send')}</Button>
      </Stack>
    </Box>
  );
}

// "Explain by voice": the operator tells what happened (or answers the press's question); Gemini checks it.
// Answers by tap, typing or voice (a loud floor, or an operator who would rather not talk to a screen). The tap options
// are Gemini's guesses of what happened (in the kiosk language); each one toggles on and off, and a question about a
// short hour also offers Yes / Partly / No for the causes the press proposed. Everything selected plus the typed text
// is sent together.
function VoiceDialog({ machineId, operator, lang, question, preset, quick, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verdict, setVerdict] = useState(preset ?? null); // Yes / Partly / No… for a question (one at a time)
  const [picked, setPicked] = useState([]); // Gemini options switched on
  const [options, setOptions] = useState(null); // null while Gemini thinks
  const dictation = useDictation(BCP[lang] ?? 'en-US', (said) => setText((x) => `${x} ${said}`.trim()));
  const t = useT();
  const causes = question?.data?.causes ?? [];
  const verdicts = question?.data?.answers ?? [];
  useEffect(() => {
    let on = true;
    api(`/machines/${machineId}/soul/options`, { method: 'POST', body: { lang } }).then(
      (r) => on && setOptions(r.options?.length ? r.options : quick.map(t)),
      () => on && setOptions(quick.map(t)), // Gemini busy: this shift's frequent reasons instead
    );
    return () => { on = false; };
  }, [machineId, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (o) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const verdictText = verdict && (verdict === 'Yes' && causes.length ? `Yes, it was ${causes.map((c) => `${c.count} × ${c.reason} (${c.minutes} min)`).join(' and ')}` : t(verdict));
  const body = [verdictText, ...picked, text.trim()].filter(Boolean).join('. ');
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
      sx={{ height: 32, fontSize: 13.5, borderRadius: '8px', ...(on ? { bgcolor: ask ? SEV.ask.color : C.blue, color: '#FFFFFF', '& .MuiChip-icon': { color: '#FFFFFF' }, '&:hover': { bgcolor: ask ? SEV.ask.text : C.blueDark } } : { borderColor: ask ? SEV.ask.line : C.line, color: ask ? SEV.ask.text : C.ink }) }}
    />
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>{t(question ? 'Answer my question' : 'Explain by voice or text')}</DialogTitle>
      <DialogContent>
        {question && <Box sx={{ p: 1.25, mb: 1.5, borderRadius: '8px', bgcolor: SEV.ask.bg, border: `1px solid ${SEV.ask.line}` }}><Typography variant="body2">{question.text}</Typography></Box>}
        {verdicts.length > 0 && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" mb={1.5} aria-label={t('Your answer')}>
            {verdicts.map((v) => chip(t(v), verdict === v, () => setVerdict(verdict === v ? null : v), true))}
          </Stack>
        )}
        <Typography variant="caption" color="text.secondary" component="div" mb={0.75}>
          {t('Gemini suggests (tap to add, tap again to remove)')}
        </Typography>
        <Stack direction="row" gap={0.75} flexWrap="wrap" mb={1.5} aria-label={t('Suggested answers')}>
          {!options && [0, 1, 2].map((i) => <Chip key={i} label="…" variant="outlined" sx={{ height: 32, width: 120, borderRadius: '8px', opacity: 0.5 }} />)}
          {options?.map((o) => chip(o, picked.includes(o), () => toggle(o)))}
        </Stack>
        <Stack direction="row" gap={1} alignItems="flex-start">
          {dictation.supported && (
            <IconButton
              aria-label={t(dictation.listening ? 'Stop recording' : 'Start recording')}
              onClick={dictation.listening ? dictation.stop : dictation.start}
              sx={{ width: 44, height: 44, flex: 'none', borderRadius: '8px', bgcolor: dictation.listening ? LEVELS.below.bg : C.light, color: dictation.listening ? LEVELS.below.color : C.blue }}
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
