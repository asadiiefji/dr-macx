// Kiosk pieces shared by both versions of Dr. Macx Live (/soul and /soul2): the machine status card and the panel
// with what the machine said (headline in its own words, the text to tap open, and three facts about this shift).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Card, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import WaveIcon from '@mui/icons-material/GraphicEqRounded';
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
import { C, STATUS } from '../theme.js';
import { duration } from '../ui.jsx';
import { useT } from '../i18n.jsx';
import { SEV, hhmm } from './Panels.jsx';

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

// The big headline above what the machine said, in its own words (first person): from the kind of message, or from
// its state when it has said nothing yet.
const HEAD = {
  stop: 'I have stopped.', question: 'I have a question for you.', advice: 'Here is my advice.', report: 'I checked your explanation.',
  cycle: 'My cycle time needs a look.', handover: 'Here is my shift handover.',
};
const STATE_HEAD = { running: 'I am running.', stopped: 'I have stopped.', break: 'I am on a planned break.', disconnected: 'I am not connected.', inactive: 'I am switched off.' };
export function headlineOf(m, row) {
  if (!m) return STATE_HEAD[row.status] ?? 'I am running.';
  if (m.kind === 'risk') return m.data?.reachable === false ? 'I cannot reach my target this shift.' : 'I am producing below target.';
  if (m.kind === 'anomaly') return m.data?.state === 'alarm' ? 'Something is wrong with me.' : 'One of my sensors looks off.';
  return HEAD[m.kind] ?? 'I have something to tell you.';
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

// What the machine said last: when, the headline in its own words (wave button says it again), the text (tap to read
// all, tap again to fold) and the facts. children (e.g. buttons) come last; when the opened text does not fit, the
// facts and children step aside until it is folded. top = the message at the top and the children at the bottom
// (else everything is centred).
export function SaidPanel({ said, question, row, now, short, talking, facts, onReplay, hello, top, children }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [crowded, setCrowded] = useState(false);
  const col = useRef(null);
  useEffect(() => setOpen(false), [said?.id]);
  useLayoutEffect(() => {
    if (!open) return setCrowded(false);
    if (col.current && col.current.scrollHeight > col.current.clientHeight + 1) setCrowded(true);
  }, [open]);
  const toggle = () => setOpen(!open);
  return (
    <Box ref={col} sx={{ display: 'flex', flexDirection: 'column', justifyContent: crowded || top ? 'flex-start' : 'center', gap: 0.75, minWidth: 0, minHeight: 0, overflowY: crowded ? 'auto' : 'visible' }}>
      {said && (
        <Typography color="text.secondary" fontSize={12.5}>
          {t('Since')} {hhmm(said.at)} · <b style={{ color: SEV.error.text }}>{duration(Math.max(0, now - said.at))}</b> {t('ago')}
        </Typography>
      )}
      <Stack direction="row" alignItems="flex-start" gap={1.5}>
        <Typography component="h2" sx={{ flex: 1, minWidth: 0, fontSize: { xs: 20, lg: short ? 21 : 24 }, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em', color: question ? SEV.ask.text : C.ink }}>
          {t(headlineOf(said, row))}
        </Typography>
        {said && (
          <Tooltip title={t(talking ? 'Speaking…' : 'Say it again')}>
            <IconButton
              aria-label={t('Say it again')} onClick={() => onReplay(said)}
              sx={{ width: 38, height: 38, flex: 'none', bgcolor: C.light, color: C.blue, '&:hover': { bgcolor: '#BBDEFB' }, animation: talking ? 'soulPulse 1s ease-in-out infinite' : 'none', '@keyframes soulPulse': { '50%': { transform: 'scale(1.1)' } } }}
            >
              <WaveIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Box
        role="button" tabIndex={0} aria-expanded={open} aria-live="polite" onClick={toggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
        sx={{ cursor: 'pointer', borderRadius: INNER, '&:focus-visible': { outline: `2px solid ${C.blue}` } }}
      >
        <Typography sx={{ fontSize: { xs: 14, lg: 15 }, lineHeight: 1.45, color: 'text.secondary', ...(!open && { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
          {said?.text ?? t(hello)}
        </Typography>
        <Typography color="text.secondary" fontSize={11.5}>{t(open ? 'Tap to fold' : 'Tap to read all')}</Typography>
      </Box>
      <Box sx={{ display: crowded ? 'none' : 'grid', gap: 0.75, gridTemplateColumns: { xs: '1fr', sm: `repeat(${facts.length}, minmax(0,1fr))` } }}>
        {facts.map(({ Icon, sev, big, small }) => (
          <Stack key={`${big}-${small}`} direction="row" gap={1} alignItems="center" sx={{ px: 1, py: 0.5, borderRadius: INNER, border: `1px solid ${C.line}`, minWidth: 0 }}>
            <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: sev.bg, display: 'grid', placeItems: 'center', flex: 'none' }}><Icon sx={{ fontSize: 16, color: sev.color }} /></Box>
            <Box minWidth={0}>
              <Typography fontWeight={800} fontSize={13.5} noWrap>{t(big)}</Typography>
              <Typography color="text.secondary" fontSize={11.5} noWrap>{t(small)}</Typography>
            </Box>
          </Stack>
        ))}
      </Box>
      {children && <Box sx={{ display: crowded ? 'none' : 'block', ...(top && { mt: 'auto', pt: 1 }) }}>{children}</Box>}
    </Box>
  );
}
