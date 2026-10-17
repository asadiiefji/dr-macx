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
    [null, 'Welcome to Dr. Macx', 'Dr. Macx watches every stamping press: OEE live, every stop with its reason, and an AI that explains what is going on. This short tour shows where things are.'],
    ['nav-soul', 'Dr. Macx Live', 'The main feature: a kiosk next to each press. The press talks, warns, asks when output drops and answers questions, in the operator’s language.'],
    ['nav-', 'Dashboard', 'The plant at a glance: OEE of the shift, output and which presses are stopped.'],
    ['nav-monitoring', 'Monitoring', 'One card per press, judged against its own targets. Open a card for its live sensors, history, downtime analysis and anatomy.'],
    ['nav-master', 'Master data', 'Presses and their sensors, how OEE is calculated, planned breaks, downtime reasons, operators, skills and settings.'],
    ['ai-models', 'AI status', 'Which Google AI model is answering and whether its last call worked.'],
  ],
  dashboard: [
    ['page-header', 'Dashboard', 'This shift for the whole plant. Green, amber and red always come with a label, so the meaning never depends on colour alone.'],
  ],
  monitoring: [
    ['page-header', 'Monitoring', 'Each press with its OEE, Availability, Performance and Quality against its targets. Tap a card for the full detail, or History analysis for trends and losses.'],
  ],
  machines: [['page-header', 'Machines', 'Each press: identity, OEE targets, press and sensor setup (Essential or Premium), PLC tags and who may run it. Cycle-time suggestions from Dr. Macx wait here for approval.']],
  oee: [['page-header', 'OEE calculation', 'How Availability, Performance and Quality are measured and combined into OEE, with a worked example of one shift.']],
  breaks: [['page-header', 'Planned breaks', 'Break times, the same every day. Break time is not planned time, so it never lowers OEE. The tolerance lets a stop just before or after a break count as an operator break.']],
  reasons: [['page-header', 'Downtime reasons', 'The reasons an operator can give a stop. Each can be planned (not counted in OEE) or unplanned, and can be linked to a PLC alarm so it is suggested automatically.']],
  operators: [['page-header', 'Operators', 'Everyone who can sign in at a Dr. Macx Live kiosk with their employee number.']],
  skills: [['page-header', 'Skill matrix', 'Who may run which press. Level 2 (Can run) or higher is needed to sign in at that press’s kiosk.']],
  settings: [['page-header', 'Settings', 'How often Dr. Macx Live gives its own advice at each press.']],
  kiosk: [
    [null, 'Dr. Macx Live', 'This screen stands next to the press. The press speaks for itself: it warns, explains stops and asks when output drops. Here is a quick tour.'],
    ['kiosk-top', 'The press', 'Which press this is, its specs, the operator signed in, the time and shift. Switch press with the arrow next to its code.'],
    ['kiosk-oee', 'OEE now', 'The shift’s OEE and its three parts. The small figure is the last 15 minutes, so you see a change before the shift total moves.'],
    ['kiosk-soul', 'The press talks', 'Its face shows how it feels; the bubble is the last thing it said (tap it to read all). Pick the language and mute the voice here.'],
    ['kiosk-progress', 'Schedule vs actual', 'Good parts so far, the shift plan, and where the shift will end at this pace against the target.'],
    ['kiosk-tabs', 'Events, sensors, anatomy', 'Everything that needs you this shift: stops to give a reason, questions from the press, sensor alerts. Tap a card for details and the part on the press.'],
    ['kiosk-actions', 'Ask and answer', 'Ask Dr. Macx for the status and chat with it. Explain by voice or text tells the press what happened; it checks it against its sensors.'],
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
