// Machine Soul right-hand panels: events (what the press said + stops waiting for a reason), the sensor log and the
// anatomy of the problem part. Each event names its sensor and part; clicking one opens it full screen.
import { useState } from 'react';
import { Avatar, Box, Button, Chip, Dialog, DialogContent, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import WarningIcon from '@mui/icons-material/WarningAmberRounded';
import ErrorIcon from '@mui/icons-material/ReportRounded';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutline';
import CloseIcon from '@mui/icons-material/Close';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import MicIcon from '@mui/icons-material/GraphicEqRounded';
import { C } from '../theme.js';
import { duration, num } from '../ui.jsx';
import { StopForm } from '../StopConfirm.jsx';
import { NcEntry, StateChip } from '../SensorTable.jsx';
import { MOTOR, valueOf } from '../sensors.js';
import Anatomy from '../anatomy/Anatomy.jsx';
import { NODE_PLACE, PART_NAMES, worstPart } from '../anatomy/pressParts.js';
import { BCP } from './useVoice.js';

export const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const SEV = {
  error: { color: '#D32F2F', text: '#C62828', bg: '#FFEBEE', line: '#FFCDD2', Icon: ErrorIcon, label: 'Needs action' },
  warn: { color: '#ED6C02', text: '#8A5300', bg: '#FFF8E1', line: '#FFE082', Icon: WarningIcon, label: 'Warning' },
  info: { color: C.blue, text: C.blueDark, bg: C.light, line: '#BBDEFB', Icon: InfoIcon, label: 'Info' },
  ok: { color: '#2E7D32', text: '#2E7D32', bg: '#E8F5E9', line: '#C8E6C9', Icon: CheckIcon, label: 'OK' },
};

const FILTERS = { all: 'All events', downtime: 'Downtime', sensor: 'Sensor alerts', question: 'Questions', production: 'Production', advice: 'Advice & reports' };

const KINDS = {
  stop: { title: 'Unplanned stop', group: 'downtime', sev: 'error', tags: ['Downtime'] },
  anomaly: { group: 'sensor', tags: ['Sensor'] },
  risk: { title: 'Shift target at risk', group: 'production', sev: 'warn', tags: ['Performance', 'Schedule'] },
  question: { title: 'Output lower than expected', group: 'question', sev: 'warn', tags: ['Performance', 'Prediction'] },
  cycle: { title: 'Cycle time suggestion', group: 'production', sev: 'info', tags: ['Cycle time'] },
  handover: { title: 'Shift handover', group: 'advice', sev: 'info', tags: ['Handover'] },
  advice: { title: 'Dr. Macx advice', group: 'advice', sev: 'info', tags: ['Gemini'] },
  report: { title: 'Your explanation, checked', group: 'advice', sev: 'ok', tags: ['Gemini'] },
};

const partTags = (sensor, part, node) => [
  sensor && { label: sensor.short, tone: 'sensor' },
  part && { label: node ? `${PART_NAMES[part] ?? part} · node ${node} (${NODE_PLACE[node]})` : PART_NAMES[part] ?? part, tone: 'part' },
].filter(Boolean);

// One list of events: questions the press asks the operator first, then stops still waiting for a reason (oldest
// first), then this shift's answered stops and what the press said, newest first. A stop and the press's message about it are one event.
export function buildEvents(messages, pending, done, sensors) {
  const said = (messages ?? []).filter((m) => KINDS[m.kind]);
  const stopMsg = new Map(said.filter((m) => m.kind === 'stop' && m.data?.stopId).map((m) => [m.data.stopId, m]));
  const waiting = [...(pending ?? [])].sort((a, b) => a.start - b.start).map((e) => {
    const m = stopMsg.get(e.id);
    return {
      id: `stop-${e.id}`, kind: 'downtime', group: 'downtime', sev: 'error', at: e.start, stop: e, message: m,
      title: e.end ? 'Stop waiting for a reason' : 'Stopped now',
      text: m?.text ?? `${e.alarmCode ? `Alarm ${e.alarmCode} (${e.reason})` : 'Stopped without a PLC alarm'}. Give this stop its reason.`,
      part: m?.data?.part, node: m?.data?.node,
      tags: [
        { label: 'Downtime', tone: 'error' },
        e.alarmCode ? { label: `Alarm ${e.alarmCode}`, tone: 'plain' } : null,
        { label: duration(((e.end ?? Date.now()) - e.start)), tone: 'plain' },
        e.repeated ? { label: `Repeated ×${e.repeatCount} in 24 h`, tone: 'warn' } : null,
        ...partTags(null, m?.data?.part, m?.data?.node),
      ].filter(Boolean),
    };
  });
  const answered = (done ?? []).map((e) => {
    const m = stopMsg.get(e.id);
    return {
      id: `done-${e.id}`, kind: 'stopDone', group: 'downtime', sev: 'ok', at: e.start, message: m,
      title: `Stop · ${e.reason}`,
      text: m?.text ?? `${e.reason}${e.planned ? ' (planned)' : ''}, ${duration(e.minutes * 60e3)}${e.comment ? `: "${e.comment}"` : ''}. Reason given.`,
      part: m?.data?.part, node: m?.data?.node,
      tags: [
        { label: 'Downtime', tone: 'ok' },
        { label: e.planned ? 'Planned' : 'Unplanned', tone: 'plain' },
        e.alarmCode ? { label: `Alarm ${e.alarmCode}`, tone: 'plain' } : null,
        { label: duration(e.minutes * 60e3), tone: 'plain' },
        ...partTags(null, m?.data?.part, m?.data?.node),
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
      const sev = isAnomaly ? (m.data?.state === 'alarm' ? 'error' : 'warn') : k.sev;
      return {
        id: m.id, kind: m.kind, group: k.group, sev, at: m.at, message: m, part, node, sensor,
        title: m.needsAnswer && !m.answered ? 'Question for you' : isAnomaly ? `${sensor?.node ? 'Tonnage' : sensor?.short ?? 'Sensor'} ${m.data?.state === 'alarm' ? 'alarm' : 'warning'}${sensor?.node ? ` on node ${sensor.node}` : ''}` : k.title,
        text: m.text,
        needsAnswer: m.needsAnswer && !m.answered,
        tags: [
          ...k.tags.map((label) => ({ label, tone: label === 'Sensor' || label === 'Downtime' ? sev : 'plain' })),
          ...partTags(sensor, part, node),
          isAnomaly && m.data?.value != null ? { label: `${num(m.data.value)} ${sensor?.unit ?? ''}`.trim(), tone: 'plain' } : null,
          m.data?.alarmCode ? { label: `Alarm ${m.data.alarmCode}`, tone: 'plain' } : null,
        ].filter(Boolean),
      };
    });
  // what the press asks the operator comes first, then stops waiting for a reason, then the rest by time
  const asks = rest.filter((e) => e.needsAnswer);
  return [...asks, ...waiting, ...[...answered, ...rest.filter((e) => !e.needsAnswer)].sort((a, b) => b.at - a.at)];
}

function Tag({ t }) {
  const c = SEV[t.tone];
  const sx = c ? { bgcolor: c.bg, color: c.text }
    : t.tone === 'sensor' ? { bgcolor: C.light, color: C.blueDark }
      : t.tone === 'part' ? { bgcolor: '#FFF3E0', color: '#B23C00' }
        : { bgcolor: '#F1F5F9', color: C.muted };
  return <Chip size="small" label={t.label} sx={{ height: 20, fontSize: 11, fontWeight: 600, maxWidth: '100%', ...sx }} />;
}

// Every event card has the same shape: status icon, title + time, a short description, chips, one action on the right.
function EventCard({ e, onOpen, onAnatomy, onAnswer, dense }) {
  const s = SEV[e.sev];
  const stop = (fn) => (ev) => (ev.stopPropagation(), fn());
  const action = e.stop ? { label: 'Confirm reason', color: 'error', variant: 'contained', run: () => onOpen(e) }
    : e.needsAnswer ? { label: 'Answer', color: 'warning', variant: 'contained', icon: <MicIcon />, run: () => onAnswer(e.message) }
      : e.part ? { label: 'View part', color: 'primary', variant: 'outlined', run: () => onAnatomy({ part: e.part, node: e.node ?? null }) }
        : { label: 'Details', color: 'primary', variant: 'text', run: () => onOpen(e) };
  const tags = dense ? e.tags.slice(0, 2) : e.tags;
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={() => onOpen(e)}
      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onOpen(e))}
      aria-label={`${s.label}: ${e.title} at ${hhmm(e.at)}. Open details.`}
      sx={{
        p: 1.25, borderRadius: '8px', bgcolor: '#FFFFFF', border: `1px solid ${C.line}`, borderLeft: `3px solid ${s.color}`, cursor: 'pointer',
        '&:hover': { bgcolor: '#F8FAFC' }, '&:focus-visible': { outline: `2px solid ${C.blue}`, outlineOffset: 1 },
      }}
    >
      <Stack direction="row" alignItems="center" gap={1}>
        <s.Icon sx={{ color: s.color, fontSize: 18, flex: 'none' }} />
        <Typography fontWeight={700} fontSize={13.5} sx={{ flex: 1, minWidth: 0 }} noWrap>{e.title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 'none' }}>{hhmm(e.at)}</Typography>
      </Stack>
      <Typography
        variant="body2" color="text.secondary" mt={0.25}
        sx={{ fontSize: 13, lineHeight: 1.4, ...(dense && { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}
      >
        {e.text}
      </Typography>
      <Stack direction="row" gap={0.5} alignItems="center" mt={0.75}>
        <Stack direction="row" gap={0.5} flexWrap={dense ? 'nowrap' : 'wrap'} flex={1} minWidth={0} sx={{ overflow: 'hidden' }}>{tags.map((t) => <Tag key={t.label} t={t} />)}</Stack>
        <Button size="small" variant={action.variant} color={action.color} startIcon={action.icon} onClick={stop(action.run)} sx={{ flex: 'none', minHeight: 28, py: 0, px: 1.25, fontSize: 12.5, borderRadius: '6px' }}>
          {action.label}
        </Button>
      </Stack>
    </Box>
  );
}

export function EventList({ events, filter, dense, ...handlers }) {
  const shown = events.filter((e) => filter === 'all' || e.group === filter);
  if (!shown.length) return <Typography color="text.secondary" sx={{ p: 1 }}>No {filter === 'all' ? '' : FILTERS[filter].toLowerCase() + ' '}events this shift. I speak when something changes.</Typography>;
  return <Stack spacing={1}>{shown.map((e) => <EventCard key={e.id} e={e} dense={dense} {...handlers} />)}</Stack>;
}

export function EventFilter({ value, onChange }) {
  return (
    <TextField select size="small" value={value} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Filter events' } }} sx={{ minWidth: 150, '& .MuiSelect-select': { py: 0.75, fontSize: 13.5 } }}>
      {Object.entries(FILTERS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
    </TextField>
  );
}

// A bordered block inside a panel (stop form, anatomy).
export const Framed = ({ children, sx }) => <Box sx={{ border: `1px solid ${C.line}`, borderRadius: '8px', p: 2, ...sx }}>{children}</Box>;

export function FullScreen({ open, onClose, title, actions, children }) {
  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: { xs: 2, md: 3 }, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h5" component="h2" flex={1}>{title}</Typography>
        {actions}
        <IconButton aria-label="Close" onClick={onClose} sx={{ border: 1, borderColor: 'divider' }}><CloseIcon /></IconButton>
      </Stack>
      <DialogContent sx={{ p: { xs: 2, md: 3 } }}>{children}</DialogContent>
    </Dialog>
  );
}

const Bullets = ({ title, items }) =>
  items?.length ? (
    <Box>
      <Typography variant="overline" color="text.secondary">{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{items.map((x, i) => <Typography key={i} component="li" mb={0.5}>{typeof x === 'string' ? x : <><b>{x.part}:</b> {x.finding}</>}</Typography>)}</Box>
    </Box>
  ) : null;

// What the sensors read 60 / 30 / 5 s before a stop (saved with the stop message).
function BeforeStop({ snap, sensors }) {
  if (!snap) return null;
  const cols = Object.keys(snap);
  const rows = sensors.filter((s) => cols.some((c) => valueOf(snap[c], s) != null));
  if (!rows.length) return null;
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">Sensors before the stop</Typography>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& td, & th': { py: 0.75, px: 1, borderBottom: 1, borderColor: 'divider', textAlign: 'right' }, '& th:first-of-type, & td:first-of-type': { textAlign: 'left' } }}>
        <thead><tr><th>Sensor</th>{cols.map((c) => <th key={c}>{c.replace('sBefore', ' s before')}</th>)}</tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}><td>{s.short}</td>{cols.map((c) => <td key={c}>{num(valueOf(snap[c], s))} {s.unit}</td>)}</tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

// One event, full screen: everything the press knows about it, the part on its anatomy, and the stop form for downtime.
export function EventDetail({ e, row, sensors, reasons, operator, lang, onClose, onSaved, onReplay, onAnswer }) {
  if (!e) return null;
  const s = SEV[e.sev];
  const d = e.message?.data ?? {};
  return (
    <FullScreen
      open
      onClose={onClose}
      title={<Stack direction="row" alignItems="center" gap={1.5}><Avatar sx={{ bgcolor: s.bg, color: s.color }}><s.Icon /></Avatar>{e.title}</Stack>}
      actions={e.message && <Button startIcon={<ReplayIcon />} onClick={() => onReplay(e.message)}>Say it again</Button>}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3 }}>
        <Stack spacing={2.5}>
          <Typography color="text.secondary">{new Date(e.at).toLocaleString()} · {s.label}</Typography>
          <Typography fontSize={19} lineHeight={1.5}>{e.text}</Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">{e.tags.map((t) => <Tag key={t.label} t={t} />)}</Stack>
          {d.likelyCause && <Typography><b>Likely cause:</b> {d.likelyCause}</Typography>}
          <Bullets title="What my sensors show" items={d.findings} />
          <Bullets title="What to do" items={d.actions} />
          {e.kind === 'question' && <Typography>I expected about <b>{num(d.expected)}</b> good pieces that hour and made <b>{num(d.actual)}</b>.</Typography>}
          {e.kind === 'cycle' && <Typography>Ideal cycle time {d.from} s → best steady stroke {d.to} s ({d.samples} samples). A supervisor approves it on the Machines page.</Typography>}
          <BeforeStop snap={d.sensorsBeforeStop} sensors={sensors} />
          {e.needsAnswer && <Button variant="contained" color="warning" size="large" startIcon={<MicIcon />} onClick={() => onAnswer(e.message)} sx={{ alignSelf: 'flex-start' }}>Answer by voice</Button>}
          {e.stop && (
            <Framed>
              <Typography variant="h6" component="h3">Give this stop its reason</Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>Let Gemini suggest one from your spoken note, or pick it yourself.</Typography>
              <StopForm machineId={row.id} event={e.stop} reasons={reasons} onSaved={() => (onSaved(), onClose())} operatorId={operator.id} lang={BCP[lang]} />
            </Framed>
          )}
        </Stack>
        {(e.part || e.stop) && (
          <Framed sx={{ p: 0, overflow: 'hidden' }}>
            <Anatomy m={row} lit={e.part ? { part: e.part, node: e.node ?? null } : undefined} title={e.part ? 'Where it is' : 'My anatomy'} height={520} />
          </Framed>
        )}
      </Box>
    </FullScreen>
  );
}

// --- Sensors tab: every sensor with its value, limit, state and the last few minutes as a sparkline ---

const showValue = (s, v, row) => {
  if (v == null) return '—';
  if (s.id === 'motorCurrent') return `${num(v)} A · ${MOTOR[row.motor] ?? ''}`;
  if (s.id === 'alarm') return v ? `Alarm ${v}` : 'No alarm';
  if (s.id === 'ioFaults') return v ? `${v} fault` : 'Healthy';
  return `${num(v)} ${s.unit}`.trim();
};
const limitText = (s, row) =>
  s.node ? `nominal ${Math.round(row.ratedTonnage / row.nodes)} t ± ${row.nodeTolerancePct}%` : s.warn != null ? `warn ${s.warn} · alarm ${s.alarm} ${s.unit}` : s.feeds ?? '';

function Spark({ values, color, w = 72 }) {
  const v = values.filter((x) => typeof x === 'number');
  if (v.length < 2) return <Box sx={{ width: w, flex: 'none' }} />;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${18 - ((x - lo) / (hi - lo || 1)) * 16}`).join(' ');
  return <svg width={w} height="20" aria-hidden style={{ flex: 'none' }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" /></svg>;
}

export function SensorsTab({ row, sensors, log, operator, onPick }) {
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
            aria-label={`${s.label}: ${showValue(s, valueOf(row.readings, s), row)}. Show on anatomy.`}
            sx={{ p: 1, borderRadius: '8px', border: 1, borderColor: st === 'alarm' || st === 'warn' ? SEV[st === 'alarm' ? 'error' : 'warn'].line : C.line, borderLeft: `3px solid ${color}`, cursor: 'pointer', '&:hover': { bgcolor: '#F8FAFC' } }}
          >
            <Stack direction="row" alignItems="baseline" gap={1}>
              <Typography fontWeight={700} fontSize={13.5} noWrap flex={1} minWidth={0}>
                {s.short} <Typography component="span" variant="caption" color="text.secondary">· {PART_NAMES[s.part] ?? s.part}</Typography>
              </Typography>
              <Typography fontWeight={700} fontSize={13.5} noWrap>{showValue(s, valueOf(row.readings, s), row)}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" gap={1} mt={0.25}>
              <Typography variant="caption" color="text.secondary" noWrap flex={1} minWidth={0}>{limitText(s, row)}</Typography>
              <Spark values={log[s.id] ?? []} color={color} />
              <StateChip state={st} />
            </Stack>
          </Box>
        );
      })}
      {row.setup === 'essential' && (
        <Box sx={{ p: 1.25, borderRadius: '8px', border: 1, borderColor: C.line }}>
          <Typography fontWeight={700}>NC pieces</Typography>
          <Typography variant="body2" color="text.secondary" mb={1}>I have no camera. Log the non-conformance pieces you find so my Quality is right.</Typography>
          <NcEntry machineId={row.id} operatorId={operator.id} />
        </Box>
      )}
    </Stack>
  );
}

// --- Anatomy tab: the problem part (or the one picked) and its sensors ---

export function AnatomyTab({ row, sensors, lit, onClear, events, onOpen }) {
  const target = lit ?? worstPart(row, sensors);
  const on = target ? sensors.filter((s) => (target.node ? s.node === target.node : s.part === target.part && !s.node)) : [];
  const related = target ? events.filter((e) => e.part === target.part && (!target.node || e.node === target.node)).slice(0, 3) : [];
  return (
    <Stack spacing={1}>
      <Framed sx={{ p: 0, overflow: 'hidden' }}>
        <Anatomy m={row} lit={lit ?? undefined} title="My anatomy" height={300} />
      </Framed>
      {lit && <Button size="small" onClick={onClear} sx={{ alignSelf: 'flex-start' }}>Back to my live problem part</Button>}
      <Box sx={{ p: 1.25, borderRadius: '8px', border: 1, borderColor: C.line }}>
        <Typography variant="overline" color="text.secondary">{lit ? 'Selected part' : 'Problem part'}</Typography>
        {!target ? (
          <Typography>All my parts are within limits. The drawing tours my sensors.</Typography>
        ) : (
          <>
            <Typography fontWeight={700} component="h3">{PART_NAMES[target.part] ?? target.part}{target.node ? ` · node ${target.node} (${NODE_PLACE[target.node]})` : ''}</Typography>
            <Stack spacing={0.75} mt={1}>
              {on.map((s) => (
                <Stack key={s.id} direction="row" alignItems="center" gap={1}>
                  <Typography variant="body2" flex={1} minWidth={0}>{s.short}</Typography>
                  <Typography variant="body2" fontWeight={700}>{showValue(s, valueOf(row.readings, s), row)}</Typography>
                  <StateChip state={row.sensorStatus?.[s.id]} />
                </Stack>
              ))}
              {!on.length && <Typography color="text.secondary">No sensor on this part.</Typography>}
            </Stack>
            {related.length > 0 && (
              <>
                <Typography variant="overline" color="text.secondary" component="div" mt={1.5}>Recent events here</Typography>
                {related.map((e) => (
                  <Button key={e.id} size="small" color="inherit" onClick={() => onOpen(e)} sx={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%', minHeight: 32 }}>
                    {hhmm(e.at)} · {e.title}
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
