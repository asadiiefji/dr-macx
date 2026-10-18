// Guided tours: a spotlight on one part of the screen at a time with a short explanation (Back / Next / Skip).
// Each page has a "Tutorial" button (TourButton); the app tour and the kiosk tour also start by themselves the first
// time this browser opens them. Steps point at elements by their data-tour attribute; a step without a target, or
// whose target is not on the screen, shows in the middle.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Box, Button, Card, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import SchoolIcon from '@mui/icons-material/SchoolOutlined';
import CloseIcon from '@mui/icons-material/CloseRounded';
import { C } from './theme.js';
import { useT } from './i18n.jsx';

const EVENT = 'drmacx-tour';
export const startTour = (id) => window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
const seenKey = (id) => `drmacx.tour.${id}`;
const seen = (id) => {
  try {
    return localStorage.getItem(seenKey(id)) === '1';
  } catch {
    return true; // storage blocked: do not keep popping up
  }
};
const markSeen = (id) => {
  try {
    localStorage.setItem(seenKey(id), '1');
  } catch {
    /* fine */
  }
};

// [target (data-tour value) or null, title, text]
export const TOURS = {
  app: [
    [null, 'Welcome to Dr. Macx', 'Dr. Macx watches every stamping machine: live OEE, every stop with its reason, and an assistant that explains what is going on. This short tour shows where things are.'],
    ['nav-soul', 'Dr. Macx Live', 'The main feature: a kiosk next to each machine. The machine talks, warns, asks when output drops and answers questions, in the operator’s language.'],
    ['nav-', 'Dashboard', 'The plant at a glance: OEE of the shift, output and which machines are stopped.'],
    ['nav-monitoring', 'Monitoring', 'One card per machine, judged against its own targets. Open a card for its live sensors, history, downtime analysis, anatomy and handovers.'],
    ['nav-master', 'Master data', 'Machines and their sensors, how OEE is calculated, planned breaks, downtime reasons, operators, skills and settings.'],
    ['ai-models', 'Google AI status', 'Which Google model is answering and whether its last call worked.'],
    ['page-actions', 'Tutorial on every page', 'Each page has a Tutorial button at the top right that walks through everything on that page.'],
  ],
  dashboard: [
    ['page-header', 'Dashboard', 'This shift for the whole plant. The shift name and its time left are at the top right.'],
    ['dash-kpi', 'Plant OEE', 'OEE and its three parts, Availability, Performance and Quality, for all machines together this shift. Green, amber and red always come with a label.'],
    ['dash-status', 'Machine status', 'How many machines are running, stopped, on a planned break or not connected right now.'],
    ['dash-output', 'Output', 'Parts made this shift: total, good and NC (non-conformance).'],
    ['dash-ranking', 'OEE by machine', 'Every machine with its OEE and A / P / Q bars against its own targets, lowest first, so you know where to look.'],
    ['dash-stopped', 'Stopped now', 'Machines stopped at this moment, with their PLC alarm code and how long they have been down.'],
  ],
  monitoring: [
    ['page-header', 'Monitoring', 'One card per machine, live, judged against its own targets.'],
    ['mon-card', 'A machine card', 'Status and for how long (with the alarm code when stopped), OEE against its target, the Availability, Performance and Quality bars, and output: total, good, NC and run time. The coloured top edge shows the OEE level. Tap the card for the full detail.'],
    ['mon-history', 'History analysis', 'Opens this machine’s OEE history: trends by hour, shift or day and where the time went.'],
  ],
  detail: [
    ['page-header', 'One machine', 'Code, name, line and area, the live status and the current shift.'],
    ['detail-tabs', 'Five views', 'Live: OEE and sensors now. OEE history: trends over a period. Downtime & AI analysis: losses by reason with Gemini’s reading. Anatomy: the machine and where each sensor sits. Shift handovers: what each shift handed to the next.'],
    ['detail-kpi', 'This shift', 'On the Live tab: OEE and its three parts against this machine’s targets.'],
    ['detail-sensors', 'Sensors', 'On the Live tab: every sensor with its PLC tag, live value and OK / Warning / Alarm. On an Essential machine the operator logs NC pieces here.'],
    ['detail-range', 'Period and shift', 'On the history and downtime tabs: pick the period, a shift and how to group the figures.'],
  ],
  machines: [
    ['page-header', 'Machines', 'Every machine Dr. Macx monitors.'],
    ['page-actions', 'Add a machine', 'Add machine opens the form for a new one.'],
    ['mach-table', 'The list', 'Code, name, line, ideal cycle time, machine type, sensor setup (Essential or Premium), data source, monitoring on or off, and how many operators may run it. Tap a row to edit it. The bin deletes the machine with its history and skill entries; to stop monitoring but keep the history, switch Active off instead.'],
    [null, 'Cycle-time suggestions', 'When a machine’s best steady cycle time over the last 3 shifts is more than 5% off its ideal cycle time, Dr. Macx suggests a new one at the top of this page. A supervisor approves or rejects it.'],
  ],
  machineEdit: [
    ['edit-tab-0', 'Identity', 'Code, name, line, area, ideal cycle time and whether the machine is monitored.'],
    ['edit-tab-1', 'OEE parameters', 'This machine’s targets and tolerance for OEE, Availability, Performance and Quality. They set the green, amber and red levels.'],
    ['edit-tab-2', 'Machine & sensors', 'Frame type, rated tonnage, tonnage nodes, motor current and the sensor setup: Essential (laser eye and current sensor) or Premium (adds tonnage, vibration, temperature, camera, acoustic and I/O module).'],
    ['edit-tab-3', 'Connection & tags', 'Data source (Kepware or the simulator for demos), the Kepware channel and device, and the tag address of each sensor. The tag addresses must match the tag IDs Kepware sends.'],
    ['edit-tab-4', 'Operators', 'Each operator’s skill level on this machine. Level 2 (Can run) or higher may sign in at its kiosk.'],
  ],
  oee: [
    ['oee-summary', 'OEE in one line', 'OEE = Availability × Performance × Quality, with a worked example of one shift.'],
    ['oee-factors', 'A, P and Q', 'What each factor asks, its formula, an example, what lowers it and which sensor gives the number.'],
    ['oee-waterfall', 'From shift time to good parts', 'The example shift step by step: each bar removes one kind of loss.'],
    ['oee-notes', 'Good to know', 'Planned time, stops and reasons, target colours, and how the schedule plan and shift target are worked out.'],
  ],
  breaks: [
    ['page-header', 'Planned breaks', 'Break times, the same every day. Break time is not planned time, so it never lowers OEE.'],
    ['breaks-tolerance', 'Break tolerance', 'A stop this many minutes before or after a break can be given the Operator break reason (early stop or late return).'],
    ['breaks-list', 'The breaks', 'Name, start and end of each break. The bin removes one.'],
    ['breaks-add', 'Add a break', 'Adds a new row.'],
    ['page-actions', 'Save', 'Nothing changes until you press Save changes.'],
  ],
  reasons: [
    ['page-header', 'Downtime reasons', 'The reasons an operator can give a stop.'],
    ['master-table', 'The list', 'Code, name, category, planned or unplanned, and the PLC alarm linked to it. Planned reasons do not lower OEE; a linked alarm makes Dr. Macx suggest that reason for a new stop. Tap a row to edit it. A reason that recorded stops use cannot be deleted; rename it instead.'],
    ['page-actions', 'Add a reason', 'Adds a new reason.'],
  ],
  operators: [
    ['page-header', 'Operators', 'Everyone who can sign in at a Dr. Macx Live kiosk.'],
    ['master-table', 'The list', 'Employee ID, name and whether the operator is active. Only active operators can sign in. Tap a row to edit it.'],
    ['page-actions', 'Add an operator', 'Adds a new operator. Then give them skill levels in the Skill matrix.'],
  ],
  skills: [
    ['page-header', 'Skill matrix', 'Who may run which machine.'],
    ['skills-legend', 'Skill levels', 'None, Trainee, Can run and Can teach. Level 2 (Can run) or higher is needed to sign in at that machine’s kiosk.'],
    ['skills-table', 'The matrix', 'One row per operator, one column per machine. Change a level in its cell; it saves right away.'],
  ],
  settings: [
    ['page-header', 'Settings', 'How Dr. Macx Live behaves at every machine.'],
    ['settings-advice', 'Advice from the machine', 'How often each machine gives its own advice, read by Gemini from its sensors, stops and output. Off means only when the operator asks. Each advice is one Gemini call per machine.'],
    ['page-actions', 'Save', 'Nothing changes until you press Save changes.'],
  ],
  kiosk: [
    [null, 'Dr. Macx Live', 'This screen stands next to the machine. The machine speaks for itself: it warns, explains stops and asks when output drops. Here is a quick tour.'],
    ['kiosk-top', 'The machine', 'Which machine this is, its specs, the operator signed in, the time and shift. Tap the machine for its status: running state, PLC alarm and sensor groups. To switch machine, sign out.'],
    ['kiosk-demo', 'Demo mode', 'On a simulated machine: shows the simulation controls (advice now, breakdown, and lower or better for each OEE part). Turn it off for real use.'],
    ['kiosk-handovers', 'Shift handovers', 'What each finished shift handed to the next.'],
    ['kiosk-oee', 'OEE now', 'The shift’s OEE, then Availability, Performance and Quality: each percentage with the figure behind it (run time, cycle time, good parts) and a bar in green, amber or red against its target.'],
    ['kiosk-soul', 'The machine talks', 'Its face shows how it feels; the circle behind it turns red, amber, purple or blue with what needs you. Beside it: a badge, the current issue in one line, one fact and the action plan (tap it when it takes you to another page). Read the full message with one tap; the wave button says it again. The strip shows this shift’s biggest loss, its most frequent stop and the PLC alarm now.'],
    ['kiosk-history', 'History', 'Everything the machine said lately and what operators answered. Tap one for its details.'],
    ['kiosk-lang', 'Language and voice', 'Pick the kiosk language; the speaker button mutes or turns on its voice.'],
    ['kiosk-actions', 'Ask and answer', 'Ask Dr. Macx for its status and chat with it. Explain by voice tells it what happened. When it asks you something, the button becomes Answer my question: one screen with that hour’s evidence, Yes / Partly / No and Gemini’s suggestions, which all write into the text box, plus the mic.'],
    ['kiosk-progress', 'Production progress', 'Good parts against the shift plan and the time left. Tap the bar to open the quantities above it: actual, schedule plan and the projected end of shift against the target. Tap again to fold.'],
    ['kiosk-tabs', 'Events, sensors, anatomy', 'Events: stops waiting for a reason, questions from the machine, sensor alerts and advice. A question opens the answer screen; a stop opens its details and the reason form. Sensors: live values and alerts. Anatomy: where each part and sensor sits.'],
    ['kiosk-showall', 'Show all', 'In the Events tab: every event this shift and earlier ones, with filters. Several stops can be confirmed at once.'],
  ],
};

// Runs the tour asked for (startTour) over whatever page is showing. firstVisit: start this tour once per browser.
export function TourHost({ firstVisit }) {
  const t = useT();
  const [tour, setTour] = useState(null); // { id, step }
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const on = (e) => TOURS[e.detail] && setTour({ id: e.detail, step: 0 });
    window.addEventListener(EVENT, on);
    if (firstVisit && !seen(firstVisit)) setTimeout(() => startTour(firstVisit), 800);
    return () => window.removeEventListener(EVENT, on);
  }, [firstVisit]);
  const steps = tour && TOURS[tour.id];
  const step = steps?.[tour.step];
  const close = useCallback(() => {
    if (tour) markSeen(tour.id);
    setTour(null);
  }, [tour]);
  const measure = useCallback(() => {
    const el = step?.[0] && document.querySelector(`[data-tour="${step[0]}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);
  useLayoutEffect(() => {
    if (!step) return undefined;
    const el = step[0] && document.querySelector(`[data-tour="${step[0]}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => (window.removeEventListener('resize', measure), window.removeEventListener('scroll', measure, true));
  }, [step, measure]);
  useEffect(() => {
    if (!tour) return undefined;
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tour, close]);
  if (!step) return null;

  const last = tour.step === steps.length - 1;
  const pad = 6;
  // the card goes below the spotlight if there is room, else above it, else in the middle
  const below = rect && rect.bottom + 220 < window.innerHeight;
  const above = rect && !below && rect.top > 240;
  const left = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - 372) : undefined;
  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 2000 }} role="dialog" aria-modal="true" aria-label={t(step[1])}>
      {rect ? (
        <Box sx={{ position: 'fixed', top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, borderRadius: '12px', boxShadow: '0 0 0 9999px rgba(15,23,42,0.55)', outline: `2px solid ${C.blue}`, pointerEvents: 'none', transition: 'all 200ms ease' }} />
      ) : (
        <Box sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(15,23,42,0.55)' }} />
      )}
      <Card
        sx={{
          position: 'fixed', width: 360, maxWidth: 'calc(100vw - 24px)', p: 2, borderRadius: '12px', boxShadow: '0 12px 32px rgba(15,23,42,0.3)',
          ...(below ? { top: rect.bottom + pad + 10, left } : above ? { bottom: window.innerHeight - rect.top + pad + 10, left } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
        }}
      >
        <Stack direction="row" alignItems="center" gap={1} mb={0.5}>
          <SchoolIcon sx={{ color: C.blue, fontSize: 20 }} />
          <Typography fontWeight={700} flex={1}>{t(step[1])}</Typography>
          <IconButton size="small" aria-label={t('Close the tour')} onClick={close}><CloseIcon fontSize="small" /></IconButton>
        </Stack>
        <Typography variant="body2" color="text.secondary" lineHeight={1.6}>{t(step[2])}</Typography>
        <Stack direction="row" alignItems="center" gap={1} mt={2}>
          <Typography variant="caption" color="text.secondary" flex={1}>{tour.step + 1} / {steps.length}</Typography>
          {steps.length > 1 && !last && <Button size="small" onClick={close}>{t('Skip')}</Button>}
          {tour.step > 0 && <Button size="small" variant="outlined" onClick={() => setTour({ ...tour, step: tour.step - 1 })}>{t('Back')}</Button>}
          <Button size="small" variant="contained" onClick={() => (last ? close() : setTour({ ...tour, step: tour.step + 1 }))}>{t(last ? 'Done' : 'Next')}</Button>
        </Stack>
      </Card>
    </Box>
  );
}

// The "Tutorial" button at the top right of a page or section.
export function TourButton({ id, sx }) {
  const t = useT();
  return (
    <Tooltip title={t('Show a short tour of this page')}>
      <Button size="small" variant="text" startIcon={<SchoolIcon />} onClick={() => startTour(id)} sx={{ minHeight: 32, ...sx }}>{t('Tutorial')}</Button>
    </Tooltip>
  );
}
