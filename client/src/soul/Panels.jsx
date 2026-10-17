// Machine Soul right-hand panels: events (what the press said + stops waiting for a reason), the sensor log and the
// anatomy of the problem part. Each event names its sensor and part; clicking one opens it full screen.
import { useEffect, useState } from 'react';
import { Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent, IconButton, LinearProgress, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import WarningIcon from '@mui/icons-material/WarningAmberRounded';
import ErrorIcon from '@mui/icons-material/ReportRounded';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutline';
import AskIcon from '@mui/icons-material/HelpOutlineRounded';
import CloseIcon from '@mui/icons-material/Close';
import ArrowIcon from '@mui/icons-material/ArrowForwardRounded';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import MicIcon from '@mui/icons-material/GraphicEqRounded';
import { C } from '../theme.js';
import { duration, num } from '../ui.jsx';
import { api, useGet } from '../api.js';
import { StopForm } from '../StopConfirm.jsx';
import { NcEntry, StateChip } from '../SensorTable.jsx';
import { MOTOR, valueOf } from '../sensors.js';
import Anatomy from '../anatomy/Anatomy.jsx';
import { NODE_PLACE, PART_NAMES, worstPart } from '../anatomy/pressParts.js';
import { BCP } from './useVoice.js';
import { useLang, useT } from '../i18n.jsx';
import { KINDS as SEGMENTS } from '../pages/Timeline.jsx';

export const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const SEV = {
  error: { color: '#D32F2F', text: '#C62828', bg: '#FFEBEE', line: '#FFCDD2', Icon: ErrorIcon, label: 'Needs action' },
  warn: { color: '#ED6C02', text: '#8A5300', bg: '#FFF8E1', line: '#FFE082', Icon: WarningIcon, label: 'Warning' },
  info: { color: C.blue, text: C.blueDark, bg: C.light, line: '#BBDEFB', Icon: InfoIcon, label: 'Info' },
  ok: { color: '#2E7D32', text: '#2E7D32', bg: '#E8F5E9', line: '#C8E6C9', Icon: CheckIcon, label: 'OK' },
  ask: { color: '#7C3AED', text: '#5B21B6', bg: '#F5F3FF', line: '#DDD6FE', Icon: AskIcon, label: 'Question' }, // a question, not a fault
};

const FILTERS = { all: 'All events', downtime: 'Downtime', sensor: 'Sensor alerts', question: 'Questions', production: 'Production', advice: 'Advice & reports' };

const KINDS = {
  stop: { title: 'Unplanned stop', group: 'downtime', sev: 'error', tags: ['Downtime'] },
  anomaly: { group: 'sensor', tags: ['Sensor'] },
  risk: { title: 'Shift target at risk', group: 'production', sev: 'warn', tags: ['Performance', 'Schedule'] },
  question: { title: 'Output lower than expected', group: 'question', sev: 'ask', tags: ['Performance', 'Prediction'] },
  cycle: { title: 'Cycle time suggestion', group: 'production', sev: 'info', tags: ['Cycle time'] },
  handover: { title: 'Shift handover', group: 'advice', sev: 'info', tags: ['Handover'] },
  advice: { title: 'Dr. Macx advice', group: 'advice', sev: 'info', tags: ['Gemini'] },
  report: { title: 'Your explanation, checked', group: 'advice', sev: 'ok', tags: ['Gemini'] },
};

// Event titles, texts and chips are built outside React, so they are "parts": T('English words') to translate
// and plain strings (codes, numbers, durations) kept as they are. tx(t, x) joins them in the kiosk language;
// a plain string (the press's own message, already translated by the server) passes through.
const T = (en) => ({ en });
export const tx = (t, x) => (Array.isArray(x) ? x.map((p) => (typeof p === 'string' ? p : t(p.en))).join('') : x);

// One chip naming the sensor and the part it sits on (or just the part when no sensor is known).
const partTags = (sensor, part, node) => {
  const where = part && (node ? [T(PART_NAMES[part] ?? part), ' · ', T(NODE_PLACE[node])] : [T(PART_NAMES[part] ?? part)]);
  if (sensor) return [{ parts: where && sensor.short !== PART_NAMES[part] ? [T(sensor.short), ' · ', ...where] : [T(sensor.short)], tone: 'sensor' }];
  return where ? [{ parts: where, tone: 'part' }] : [];
};
const alarmTag = (code) => code ? { parts: [T('Alarm'), ` ${code}`], tone: 'plain' } : null;

// One list of events: questions the press asks the operator first, then stops still waiting for a reason (oldest
// first), then this shift's answered stops and what the press said, newest first. A stop and the press's message about it are one event.
export function buildEvents(messages, pending, done, sensors, alarmSensors = {}) {
  const said = (messages ?? []).filter((m) => KINDS[m.kind]);
  const stopMsg = new Map(said.filter((m) => m.kind === 'stop' && m.data?.stopId).map((m) => [m.data.stopId, m]));
  // the sensor that found a stop: saved on the press's stop message, else the one its alarm points at
  // (server/sensors.js ALARM_SENSORS), else the motor current that saw the press stop
  const finder = (e, m) =>
    sensors.find((x) => x.id === m?.data?.sensor) ??
    (alarmSensors[e.alarmCode ?? 0] ?? []).map((id) => sensors.find((x) => x.id === id)).find(Boolean) ??
    sensors.find((x) => x.id === 'motorCurrent');
  const waiting = [...(pending ?? [])].sort((a, b) => a.start - b.start).map((e) => {
    const m = stopMsg.get(e.id);
    const f = finder(e, m);
    return {
      id: `stop-${e.id}`, kind: 'downtime', group: 'downtime', sev: 'error', at: e.start, stop: e, message: m,
      title: [T(e.end ? 'Stop waiting for a reason' : 'Stopped now')],
      text: m?.text ?? (e.alarmCode ? [T('Alarm'), ` ${e.alarmCode} (`, T(e.reason), '). ', T('Give this stop its reason.')] : [T('Stopped without a PLC alarm. Give this stop its reason.')]),
      sensor: f, part: f?.part, node: f?.node,
      tags: [
        ...partTags(f, f?.part, f?.node),
        alarmTag(e.alarmCode),
        { parts: [duration((e.end ?? Date.now()) - e.start)], tone: 'plain' },
        e.repeated ? { parts: [T('Repeated'), ` ×${e.repeatCount} · 24 h`], tone: 'warn' } : null,
      ].filter(Boolean),
    };
  });
  const answered = (done ?? []).map((e) => {
    const m = stopMsg.get(e.id);
    const f = finder(e, m);
    return {
      id: `done-${e.id}`, kind: 'stopDone', group: 'downtime', sev: 'ok', at: e.start, message: m,
      title: [T('Stop'), ' · ', T(e.reason)],
      text: m?.text ?? [T(e.reason), ...(e.planned ? [' (', T('planned'), ')'] : []), `, ${duration(e.minutes * 60e3)}`, ...(e.comment ? [`: "${e.comment}"`] : []), '. ', T('Reason given.')],
      sensor: f, part: f?.part, node: f?.node,
      tags: [
        ...partTags(f, f?.part, f?.node),
        { parts: [T(e.planned ? 'Planned' : 'Unplanned')], tone: 'plain' },
        alarmTag(e.alarmCode),
        { parts: [duration(e.minutes * 60e3)], tone: 'plain' },
      ].filter(Boolean),
    };
  });
  const linked = new Set([...(pending ?? []), ...(done ?? [])].map((e) => e.id));
  const rest = said
    .filter((m) => !(m.kind === 'stop' && linked.has(m.data?.stopId)))
    .map((m) => {
      const k = KINDS[m.kind];
      const sensor = m.data?.sensor && sensors.find((s) => s.id === m.data.sensor);
      const part = m.data?.part ?? sensor?.part;
      const node = m.data?.node ?? sensor?.node;
      const isAnomaly = m.kind === 'anomaly';
      const sev = isAnomaly ? (m.data?.state === 'alarm' ? 'error' : 'warn') : m.needsAnswer ? 'ask' : k.sev;
      const state = T(m.data?.state === 'alarm' ? 'Alarm' : 'Warning');
      return {
        id: m.id, kind: m.kind, group: k.group, sev, at: m.at, message: m, part, node, sensor,
        title: m.needsAnswer && !m.answered ? [T('Question for you')]
          : isAnomaly ? (sensor?.node ? [T('Tonnage'), ' · ', T('node'), ` ${sensor.node} · `, state] : [T(sensor?.short ?? 'Sensor'), ' · ', state])
            : [T(k.title)],
        text: m.text,
        needsAnswer: m.needsAnswer && !m.answered,
        tags: [
          ...partTags(sensor, part, node),
          ...k.tags.map((label) => ({ parts: [T(label)], tone: label === 'Sensor' || label === 'Downtime' ? sev : 'plain' })),
          isAnomaly && m.data?.value != null ? { parts: [`${num(m.data.value)} ${sensor?.unit ?? ''}`.trim()], tone: 'plain' } : null,
          alarmTag(m.data?.alarmCode),
        ].filter(Boolean),
      };
    });
  // what the press asks the operator comes first, then stops waiting for a reason, then the rest by time
  const asks = rest.filter((e) => e.needsAnswer);
  return [...asks, ...waiting, ...[...answered, ...rest.filter((e) => !e.needsAnswer)].sort((a, b) => b.at - a.at)];
}

function Tag({ tag }) {
  const t = useT();
  const c = SEV[tag.tone];
  const sx = c ? { bgcolor: c.bg, color: c.text }
    : tag.tone === 'sensor' ? { bgcolor: C.light, color: C.blueDark }
      : tag.tone === 'part' ? { bgcolor: '#FFF3E0', color: '#B23C00' }
        : { bgcolor: '#F1F5F9', color: C.muted };
  return <Chip size="small" label={tx(t, tag.parts)} sx={{ height: 20, fontSize: 11, fontWeight: 600, maxWidth: '100%', ...sx }} />;
}

// Every event card has the same shape: status icon, title + time, a short description, chips, one action on the right.
function EventCard({ e, onOpen, onAnatomy, onAnswer, dense }) {
  const t = useT();
  const s = SEV[e.sev];
  const stop = (fn) => (ev) => (ev.stopPropagation(), fn());
  const action = e.stop ? { label: 'Confirm reason', color: SEV.error.text, run: () => onOpen(e) }
    : e.needsAnswer ? { label: 'Answer', color: SEV.ask.text, run: () => onAnswer(e.message) }
      : e.part ? { label: 'View part', color: C.blue, run: () => onAnatomy({ part: e.part, node: e.node ?? null }) }
        : { label: 'Details', color: C.blue, run: () => onOpen(e) };
  const tags = dense ? e.tags.slice(0, 1) : e.tags; // compact cards: the most telling chip (sensor · part first)
  const title = tx(t, e.title);
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => onOpen(e)}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onOpen(e))}
      aria-label={`${t(s.label)}: ${title} · ${hhmm(e.at)}`}
      sx={{
        p: 1.25, borderRadius: '8px', bgcolor: '#FFFFFF', border: `1px solid ${C.line}`, borderLeft: `3px solid ${s.color}`, cursor: 'pointer',
        '&:hover': { bgcolor: '#F8FAFC' }, '&:focus-visible': { outline: `2px solid ${C.blue}`, outlineOffset: 1 },
      }}
    >
      <Stack direction="row" alignItems="center" gap={1}>
        <s.Icon sx={{ color: s.color, fontSize: 18, flex: 'none' }} />
        <Typography fontWeight={700} fontSize={13.5} sx={{ flex: 1, minWidth: 0 }} noWrap>{title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 'none' }}>{hhmm(e.at)}</Typography>
      </Stack>
      <Typography
        variant="body2" color="text.secondary" mt={0.25}
        sx={{ fontSize: 13, lineHeight: 1.4, ...(dense && { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}
      >
        {tx(t, e.text)}
      </Typography>
      <Stack direction="row" gap={0.5} alignItems="center" mt={0.75}>
        <Stack direction="row" gap={0.5} flexWrap={dense ? 'nowrap' : 'wrap'} flex={1} minWidth={0} sx={{ overflow: 'hidden' }}>{tags.map((tag, i) => <Tag key={i} tag={tag} />)}</Stack>
        {/* the whole card opens the details; this link names what it leads to */}
        <Button size="small" variant="text" endIcon={<ArrowIcon sx={{ fontSize: '16px !important' }} />} onClick={stop(action.run)} sx={{ flex: 'none', minHeight: 28, py: 0, px: 0.75, fontSize: 12.5, fontWeight: 700, color: action.color, borderRadius: '6px' }}>
          {t(action.label)}
        </Button>
      </Stack>
    </Box>
  );
}

export function EventList({ events, filter, dense, ...handlers }) {
  const t = useT();
  const shown = events.filter((e) => filter === 'all' || e.group === filter);
  if (!shown.length) return <Typography color="text.secondary" sx={{ p: 1 }}>{t('Nothing here this shift. I speak when something changes.')}</Typography>;
  return <Stack spacing={1}>{shown.map((e) => <EventCard key={e.id} e={e} dense={dense} {...handlers} />)}</Stack>;
}

export function EventFilter({ value, onChange }) {
  const t = useT();
  return (
    <TextField select size="small" value={value} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { 'aria-label': t('Filter events') } }} sx={{ minWidth: 150, '& .MuiSelect-select': { py: 0.75, fontSize: 13.5 } }}>
      {Object.entries(FILTERS).map(([k, v]) => <MenuItem key={k} value={k}>{t(v)}</MenuItem>)}
    </TextField>
  );
}

// A bordered block inside a panel (stop form, anatomy).
export const Framed = ({ children, sx }) => <Box sx={{ border: `1px solid ${C.line}`, borderRadius: '8px', p: 2, ...sx }}>{children}</Box>;

// A popup at a common size, padded from the screen edge; closes on Esc or a click outside.
// size: third (a list, about 1/3 of the screen), half (one subject), wide (details with the anatomy beside them).
const WIDTH = { third: { md: '34vw' }, half: { md: '50vw' }, wide: { md: '68vw' } };
// fill: the popup takes the available height and its content does its own scrolling (e.g. two columns that scroll apart).
export function Popup({ open, onClose, title, actions, size = 'third', fill, children }) {
  const t = useT();
  return (
    <Dialog
      open={open} onClose={onClose} maxWidth={false}
      slotProps={{ paper: { sx: { width: { xs: 'calc(100% - 24px)', ...WIDTH[size] }, minWidth: { md: size === 'third' ? 440 : 560 }, m: { xs: 1.5, md: 4 }, maxHeight: { xs: 'calc(100% - 24px)', md: 'calc(100% - 96px)' }, ...(fill && { height: { md: 'calc(100% - 96px)' } }), borderRadius: '12px' } } }}
    >
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: { xs: 2, md: 3 }, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Typography fontWeight={700} fontSize={18} component="h2" flex={1}>{title}</Typography>
        {actions}
        <IconButton aria-label={t('Close')} onClick={onClose} sx={{ border: 1, borderColor: 'divider', width: 36, height: 36 }}><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      <DialogContent sx={{ p: { xs: 2, md: 3 }, ...(fill && { overflow: { md: 'hidden' }, display: 'flex', flexDirection: 'column' }) }}>{children}</DialogContent>
    </Dialog>
  );
}

const Bullets = ({ title, items }) => {
  const t = useT();
  return items?.length ? (
    <Box>
      <Typography variant="overline" color="text.secondary">{t(title)}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{items.map((x, i) => <Typography key={i} component="li" mb={0.5}>{typeof x === 'string' ? t(x) : <><b>{t(x.part)}:</b> {t(x.finding)}</>}</Typography>)}</Box>
    </Box>
  ) : null;
};

// What the sensors read 60 / 30 / 5 s before a stop (saved with the stop message).
function BeforeStop({ snap, sensors }) {
  const t = useT();
  if (!snap) return null;
  const cols = Object.keys(snap);
  const rows = sensors.filter((s) => cols.some((c) => valueOf(snap[c], s) != null));
  if (!rows.length) return null;
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">{t('Sensors before the stop')}</Typography>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { py: 0.75, px: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'right' }, '& th:first-of-type, & td:first-of-type': { textAlign: 'left' } }}>
        <thead><tr><th>{t('Sensor')}</th>{cols.map((c) => <th key={c}>−{parseInt(c, 10)} s</th>)}</tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}><td>{t(s.short)}</td>{cols.map((c) => <td key={c}>{num(valueOf(snap[c], s))} {s.unit}</td>)}</tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

// One event in a popup: everything the press knows about it, the part on its anatomy, and the stop form for downtime.
export function EventDetail({ e, row, sensors, reasons, operator, lang, onClose, onSaved, onReplay, onAnswer }) {
  const t = useT();
  const locale = useLang() === 'en' ? undefined : BCP[lang];
  if (!e) return null;
  const s = SEV[e.sev];
  const d = e.message?.data ?? {};
  const side = e.part || e.stop;
  return (
    <Popup
      open
      size={side ? 'wide' : 'half'}
      onClose={onClose}
      title={<Stack direction="row" alignItems="center" gap={1.5}><Avatar sx={{ bgcolor: s.bg, color: s.color, width: 32, height: 32 }}><s.Icon fontSize="small" /></Avatar>{tx(t, e.title)}</Stack>}
      actions={e.message && <Button size="small" startIcon={<ReplayIcon />} onClick={() => onReplay(e.message)}>{t('Say it again')}</Button>}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: side ? '1fr 1fr' : '1fr' }, gap: 3 }}>
        <Stack spacing={2}>
          <Typography color="text.secondary">{new Date(e.at).toLocaleString(locale)} · {t(s.label)}</Typography>
          <Typography fontSize={17} lineHeight={1.5}>{tx(t, e.text)}</Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">{e.tags.map((tag, i) => <Tag key={i} tag={tag} />)}</Stack>
          {d.likelyCause && <Typography><b>{t('Likely cause')}:</b> {t(d.likelyCause)}</Typography>}
          <Bullets title="What my sensors show" items={d.findings} />
          <Bullets title="What to do" items={d.actions} />
          {e.kind === 'question' && d.hour && <HourView machineId={row.id} hour={d.hour} lang={lang} idealCycleTime={row.idealCycleTime} expected={d.expected} />}
          {e.kind === 'cycle' && <Typography>{t('Ideal cycle time')} {d.from} s → {t('best steady stroke')} {d.to} s ({d.samples}). {t('A supervisor approves it on the Machines page.')}</Typography>}
          <BeforeStop snap={d.sensorsBeforeStop} sensors={sensors} />
          {e.needsAnswer && (
            <Stack direction="row" gap={1} flexWrap="wrap">
              {(d.answers ?? []).map((a) => (
                <Button key={a} variant="outlined" onClick={() => onAnswer(e.message, a)} sx={{ borderColor: SEV.ask.line, color: SEV.ask.text, borderRadius: '8px' }}>{t(a)}</Button>
              ))}
              <Button variant="contained" startIcon={<MicIcon />} onClick={() => onAnswer(e.message)} sx={{ bgcolor: SEV.ask.color, '&:hover': { bgcolor: SEV.ask.text }, borderRadius: '8px' }}>{t('Answer by voice or text')}</Button>
            </Stack>
          )}
          {e.stop && (
            <Framed>
              <Typography fontWeight={700} component="h3">{t('Give this stop its reason')}</Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>{t('Let Gemini suggest one from your spoken note, or pick it yourself.')}</Typography>
              <StopForm machineId={row.id} event={e.stop} reasons={reasons} onSaved={() => (onSaved(), onClose())} operatorId={operator.id} lang={BCP[lang]} />
            </Framed>
          )}
        </Stack>
        {side && (
          <Anatomy
            m={row} title={t(e.part ? 'Where it is' : 'My anatomy')} height={340}
            lit={e.part ? { part: e.part, node: e.node ?? null } : undefined}
            fault={e.part && (e.stop || e.kind === 'stopDone' || e.kind === 'anomaly') ? { part: e.part, node: e.node ?? null } : undefined}
          />
        )}
      </Box>
    </Popup>
  );
}

// --- Sensors tab: every sensor with its value, limit, state and the last few minutes as a sparkline ---

const showValue = (t, s, v, row) => {
  if (v == null) return '—';
  if (s.id === 'motorCurrent') return `${num(v)} A · ${t(MOTOR[row.motor] ?? '')}`;
  if (s.id === 'alarm') return v ? `${t('Alarm')} ${v}` : t('No alarm');
  if (s.id === 'ioFaults') return v ? `${v} ${t('fault')}` : t('Healthy');
  return `${num(v)} ${s.unit}`.trim();
};
const limitText = (t, s, row) =>
  s.node ? `${t('nominal')} ${Math.round(row.ratedTonnage / row.nodes)} t ± ${row.nodeTolerancePct}%` : s.warn != null ? `${t('warn')} ${s.warn} · ${t('alarm')} ${s.alarm} ${s.unit}` : t(s.feeds ?? '');

function Spark({ values, color, w = 72 }) {
  const v = values.filter((x) => typeof x === 'number');
  if (v.length < 2) return <Box sx={{ width: w, flex: 'none' }} />;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${18 - ((x - lo) / (hi - lo || 1)) * 16}`).join(' ');
  return <svg width={w} height="20" aria-hidden style={{ flex: 'none' }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" /></svg>;
}

export function SensorsTab({ row, sensors, log, operator, onPick }) {
  const t = useT();
  return (
    <Stack spacing={0.75}>
      {sensors.map((s) => {
        const st = row.sensorStatus?.[s.id];
        const color = st === 'alarm' ? SEV.error.color : st === 'warn' ? SEV.warn.color : C.blue;
        return (
          <Box
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => onPick({ part: s.part, node: s.node ?? null })}
            onKeyDown={(ev) => ev.key === 'Enter' && onPick({ part: s.part, node: s.node ?? null })}
            aria-label={`${t(s.label)}: ${showValue(t, s, valueOf(row.readings, s), row)}`}
            sx={{ p: 1, borderRadius: '8px', border: 1, borderColor: st === 'alarm' || st === 'warn' ? SEV[st === 'alarm' ? 'error' : 'warn'].line : C.line, borderLeft: `3px solid ${color}`, cursor: 'pointer', '&:hover': { bgcolor: '#F8FAFC' } }}
          >
            <Stack direction="row" alignItems="baseline" gap={1}>
              <Typography fontWeight={700} fontSize={13.5} noWrap flex={1} minWidth={0}>
                {t(s.short)} <Typography component="span" variant="caption" color="text.secondary">· {t(PART_NAMES[s.part] ?? s.part)}</Typography>
              </Typography>
              <Typography fontWeight={700} fontSize={13.5} noWrap>{showValue(t, s, valueOf(row.readings, s), row)}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" gap={1} mt={0.25}>
              <Typography variant="caption" color="text.secondary" noWrap flex={1} minWidth={0}>{limitText(t, s, row)}</Typography>
              <Spark values={log[s.id] ?? []} color={color} />
              <StateChip state={st} />
            </Stack>
          </Box>
        );
      })}
      {row.setup === 'essential' && (
        <Box sx={{ p: 1.25, borderRadius: '8px', border: 1, borderColor: C.line }}>
          <Typography fontWeight={700}>{t('NC pieces')}</Typography>
          <Typography variant="body2" color="text.secondary" mb={1}>{t('I have no camera. Log the non-conformance pieces you find so my Quality is right.')}</Typography>
          <NcEntry machineId={row.id} operatorId={operator.id} />
        </Box>
      )}
    </Stack>
  );
}

// --- Anatomy tab: the problem part (or the one picked) and its sensors ---

export function AnatomyTab({ row, sensors, lit, onClear, events, onOpen }) {
  const t = useT();
  const target = lit ?? worstPart(row, sensors);
  const on = target ? sensors.filter((s) => (target.node ? s.node === target.node : s.part === target.part && !s.node)) : [];
  const related = target ? events.filter((e) => e.part === target.part && (!target.node || e.node === target.node)).slice(0, 3) : [];
  return (
    <Stack spacing={1}>
      <Anatomy m={row} lit={lit ?? undefined} title={t('My anatomy')} height={240} />
      {lit && <Button size="small" onClick={onClear} sx={{ alignSelf: 'flex-start' }}>{t('Back to my live problem part')}</Button>}
      <Box sx={{ p: 1.25, borderRadius: '8px', border: 1, borderColor: C.line }}>
        <Typography variant="overline" color="text.secondary">{t(lit ? 'Selected part' : 'Problem part')}</Typography>
        {!target ? (
          <Typography>{t('All my parts are within limits. The drawing tours my sensors.')}</Typography>
        ) : (
          <>
            <Typography fontWeight={700} component="h3">{t(PART_NAMES[target.part] ?? target.part)}{target.node ? ` · ${t('node')} ${target.node} (${t(NODE_PLACE[target.node])})` : ''}</Typography>
            <Stack spacing={0.75} mt={1}>
              {on.map((s) => (
                <Stack key={s.id} direction="row" alignItems="center" gap={1}>
                  <Typography variant="body2" flex={1} minWidth={0}>{t(s.short)}</Typography>
                  <Typography variant="body2" fontWeight={700}>{showValue(t, s, valueOf(row.readings, s), row)}</Typography>
                  <StateChip state={row.sensorStatus?.[s.id]} />
                </Stack>
              ))}
              {!on.length && <Typography color="text.secondary">{t('No sensor on this part.')}</Typography>}
            </Stack>
            {related.length > 0 && (
              <>
                <Typography variant="overline" color="text.secondary" component="div" mt={1.5}>{t('Recent events here')}</Typography>
                {related.map((e) => (
                  <Button key={e.id} size="small" color="inherit" onClick={() => onOpen(e)} sx={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%', minHeight: 32 }}>
                    {hhmm(e.at)} · {tx(t, e.title)}
                  </Button>
                ))}
              </>
            )}
          </>
        )}
      </Box>
    </Stack>
  );
}

// --- Several stops with the same suggested reason: confirm them in one go ---

export function BulkConfirm({ stops, reasons, machineId, operatorId, onDone }) {
  const t = useT();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const byReason = new Map();
  for (const e of stops) {
    const r = reasons.find((x) => x.code === e.code);
    if (r) (byReason.get(r.code) ?? byReason.set(r.code, { reason: r, stops: [] }).get(r.code)).stops.push(e);
  }
  const groups = [...byReason.values()].filter((g) => g.stops.length >= 2).sort((a, b) => b.stops.length - a.stops.length).slice(0, 2);
  if (!groups.length) return null;
  const confirm = async (g) => {
    setBusy(g.reason.code);
    setError('');
    try {
      for (const e of g.stops) await api(`/machines/${machineId}/downtime/${e.id}`, { method: 'PUT', body: { reasonCode: g.reason.code, operatorId } });
      onDone();
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Stack spacing={0.75} mb={1}>
      {groups.map((g) => (
        <Stack key={g.reason.code} direction="row" alignItems="center" gap={1} sx={{ p: 1, borderRadius: '8px', bgcolor: SEV.error.bg, border: `1px solid ${SEV.error.line}` }}>
          <Typography variant="body2" flex={1} minWidth={0}>
            <b>{g.stops.length} ×</b> {t(g.reason.name)}
          </Typography>
          <Button size="small" variant="contained" color="error" disabled={!!busy} onClick={() => confirm(g)} sx={{ minHeight: 28, py: 0, whiteSpace: 'nowrap', borderRadius: '6px' }}>
            {busy === g.reason.code ? <CircularProgress size={16} color="inherit" /> : `${t('Confirm all as')} ${g.reason.code}`}
          </Button>
        </Stack>
      ))}
      {error && <Typography variant="caption" color="error">{error}</Typography>}
    </Stack>
  );
}

// --- Event history: any date and shift (the Events tab shows only this shift) ---

// Shift windows of a calendar day, from the current shift (three 8 h shifts, Shift 1 first): no shift table here.
export function shiftsOn(dateStr, live) {
  const n = Number(live.shift.name.replace(/\D/g, '')) || 1;
  const first = (((new Date(live.shift.start).getHours() - (n - 1) * 8) % 24) + 24) % 24; // hour Shift 1 starts
  const day = new Date(`${dateStr}T00:00:00`).getTime();
  return [1, 2, 3].map((k) => {
    const start = day + (first + (k - 1) * 8) * 3600e3;
    return { name: `Shift ${k}`, start, end: start + 8 * 3600e3 };
  });
}
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function HistoryPopup({ open, onClose, machineId, lang, live, sensors, alarmSensors, earlier, reasons, operator, refresh, onConfirmed, handlers, startMode = 'shift' }) {
  const t = useT();
  const [mode, setMode] = useState(startMode); // shift = browse a date + shift, earlier = stops still waiting from earlier shifts
  const [date, setDate] = useState(() => ymd(live.shift.start));
  const [shift, setShift] = useState(live.shift.name);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  useEffect(() => setMode(startMode), [startMode, open]);
  const windows = shiftsOn(date, live);
  const range = shift === 'all' ? { start: windows[0].start, end: windows[2].end } : windows.find((w) => w.name === shift) ?? windows[0];
  const q = `from=${range.start}&to=${range.end}`;
  const stops = useGet(open && mode === 'shift' ? `/machines/${machineId}/downtime?${q}&r=${refresh}` : null);
  const said = useGet(open && mode === 'shift' ? `/machines/${machineId}/soul?lang=${lang}&${q}&limit=200&r=${refresh}` : null);
  const all = stops.data?.events ?? [];
  const list = mode === 'earlier'
    ? buildEvents([], earlier, [], sensors, alarmSensors)
    : buildEvents(onlyWaiting ? [] : said.data ?? [], all.filter((e) => !e.confirmed), onlyWaiting ? [] : all.filter((e) => e.confirmed), sensors, alarmSensors);
  const loading = mode === 'shift' && (!stops.data || !said.data);
  return (
    <Popup open={open} onClose={onClose} size="half" title={t('Event history')}>
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center" mb={1.5}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(e, v) => v && setMode(v)}>
          <ToggleButton value="shift" sx={{ textTransform: 'none' }}>{t('By date and shift')}</ToggleButton>
          <ToggleButton value="earlier" sx={{ textTransform: 'none' }}>{t('Waiting from earlier shifts')} ({earlier.length})</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'shift' && (
          <>
            <TextField size="small" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} slotProps={{ htmlInput: { max: ymd(Date.now()), 'aria-label': t('Date') } }} />
            <TextField select size="small" value={shift} onChange={(e) => setShift(e.target.value)} slotProps={{ htmlInput: { 'aria-label': t('Shift') } }} sx={{ minWidth: 130 }}>
              <MenuItem value="all">{t('All shifts')}</MenuItem>
              {windows.map((w) => <MenuItem key={w.name} value={w.name}>{t(w.name)} · {hhmm(w.start)}–{hhmm(w.end)}</MenuItem>)}
            </TextField>
            <Button size="small" variant={onlyWaiting ? 'contained' : 'outlined'} onClick={() => setOnlyWaiting(!onlyWaiting)} sx={{ minHeight: 32, borderRadius: '8px' }}>{t('Waiting for a reason only')}</Button>
          </>
        )}
      </Stack>
      {mode === 'earlier' && <BulkConfirm stops={earlier} reasons={reasons} machineId={machineId} operatorId={operator.id} onDone={onConfirmed} />}
      {mode === 'shift' && <BulkConfirm stops={all.filter((e) => !e.confirmed)} reasons={reasons} machineId={machineId} operatorId={operator.id} onDone={onConfirmed} />}
      {loading ? <LinearProgress /> : <EventList events={list} filter="all" {...handlers} />}
    </Popup>
  );
}

// --- One hour of the press: what happened in it (for a question about that hour) ---

export function HourView({ machineId, hour, lang, idealCycleTime, expected }) {
  const t = useT();
  const end = hour + 3600e3;
  const q = `from=${hour}&to=${end}`;
  const timeline = useGet(`/machines/${machineId}/timeline?start=${hour}`);
  const stops = useGet(`/machines/${machineId}/downtime?${q}`);
  const stats = useGet(`/machines/${machineId}/history?${q}&by=hour`);
  const said = useGet(`/machines/${machineId}/soul?lang=${lang}&${q}&limit=50`);
  const b = stats.data?.total;
  const segs = (timeline.data?.segments ?? []).map((x) => ({ ...x, start: Math.max(x.start, hour), end: Math.min(x.end, end) })).filter((x) => x.end > x.start);
  const spikes = (said.data ?? []).filter((m) => m.kind === 'anomaly');
  const good = b ? b.total - b.ng : null;
  const fact = (label, value) => (
    <Box sx={{ px: 1.25, py: 0.75, border: `1px solid ${C.line}`, borderRadius: '8px', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div" noWrap>{label}</Typography>
      <Typography fontWeight={700}>{value}</Typography>
    </Box>
  );
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">{t('That hour')} · {hhmm(hour)}–{hhmm(end)}</Typography>
      {!b ? <LinearProgress /> : (
        <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', mb: 1.25 }}>
          {fact(t('Good parts'), `${num(good)} / ~${num(expected)}`)}
          {fact('NC', num(b.ng))}
          {fact(t('Run time'), `${Math.round(b.runSec / 60)} / ${Math.round(b.plannedSec / 60)} min`)}
          {fact(t('Cycle time'), `${b.total ? (b.runSec / b.total).toFixed(1) : '—'} / ${idealCycleTime} s`)}
        </Box>
      )}
      {/* the hour as a bar: running, stops, breaks (colours as on the History page, with labels below) */}
      <Box sx={{ display: 'flex', height: 18, borderRadius: '4px', overflow: 'hidden', border: `1px solid ${C.line}` }} role="img" aria-label={t('Timeline of that hour')}>
        {segs.map((x, i) => <Box key={i} title={`${hhmm(x.start)}–${hhmm(x.end)} ${t(x.label)}`} sx={{ flex: x.end - x.start, bgcolor: SEGMENTS[x.kind]?.color ?? '#E2E8F0' }} />)}
      </Box>
      <Stack direction="row" gap={1.5} flexWrap="wrap" mt={0.5} mb={1.25}>
        {Object.entries(SEGMENTS).filter(([k]) => segs.some((x) => x.kind === k)).map(([k, v]) => (
          <Stack key={k} direction="row" alignItems="center" gap={0.5}><Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: v.color }} /><Typography variant="caption">{t(v.label)}</Typography></Stack>
        ))}
      </Stack>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary">{t('Stops')}</Typography>
          {(stops.data?.events ?? []).length === 0 && <Typography variant="body2" color="text.secondary">{t('No stops logged.')}</Typography>}
          {(stops.data?.events ?? []).map((x) => (
            <Typography key={x.id} variant="body2">{hhmm(x.start)} · {t(x.reason)} · {duration((Math.min(x.end ?? end, end) - Math.max(x.start, hour)))}</Typography>
          ))}
        </Box>
        <Box>
          <Typography variant="caption" fontWeight={700} color="text.secondary">{t('Sensor spikes')}</Typography>
          {spikes.length === 0 && <Typography variant="body2" color="text.secondary">{t('No sensor out of limits.')}</Typography>}
          {spikes.map((m) => <Typography key={m.id} variant="body2" noWrap title={m.text}>{hhmm(m.at)} · {m.text}</Typography>)}
        </Box>
      </Box>
    </Box>
  );
}
