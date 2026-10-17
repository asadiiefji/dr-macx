// OEE calculation, explained: what Availability, Performance and Quality measure, how they combine into OEE,
// and where each number comes from. A worked example walks one shift from clock time to good parts.
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import AvailabilityIcon from '@mui/icons-material/TimerOutlined';
import PerformanceIcon from '@mui/icons-material/SpeedOutlined';
import QualityIcon from '@mui/icons-material/VerifiedOutlined';
import { PageHeader } from '../ui.jsx';
import { C, LEVELS } from '../theme.js';

// One example shift (8 h), the same arithmetic the app runs every second.
const EX = { shift: 480, breaks: 60, stops: 42, ict: 6, total: 3400, nc: 68 };
EX.planned = EX.shift - EX.breaks; // 420 min
EX.run = EX.planned - EX.stops; // 378 min
EX.A = EX.run / EX.planned;
EX.P = (EX.ict * EX.total) / (EX.run * 60);
EX.Q = (EX.total - EX.nc) / EX.total;
EX.OEE = EX.A * EX.P * EX.Q;
const pc = (v) => `${(v * 100).toFixed(1)}%`;

const FACTORS = [
  {
    key: 'A', name: 'Availability', Icon: AvailabilityIcon, color: '#1565C0', question: 'Was the machine running when it should have been?',
    formula: 'Run time ÷ Planned time', example: `${EX.run} min ÷ ${EX.planned} min = ${pc(EX.A)}`,
    losses: ['Breakdowns (e.g. hydraulic pressure low)', 'Material jams and short stops', 'Die changes and setups', 'Waiting for coil or material'],
    source: 'Motor current sensor: running, idle or off, every second. A stop outside a planned break is downtime and waits for a reason.',
  },
  {
    key: 'P', name: 'Performance', Icon: PerformanceIcon, color: '#7C3AED', question: 'While running, did it run at its ideal speed?',
    formula: 'Ideal cycle time × Total count ÷ Run time', example: `${EX.ict} s × ${EX.total.toLocaleString()} ÷ ${(EX.run * 60).toLocaleString()} s = ${pc(EX.P)}`,
    losses: ['Strokes slower than the ideal cycle time', 'Small stops too short to log', 'Slow restarts after a stop'],
    source: 'Laser eye at the exit chute counts every part. The ideal cycle time is set per machine (and Dr. Macx suggests a better one).',
  },
  {
    key: 'Q', name: 'Quality', Icon: QualityIcon, color: '#2E7D32', question: 'Were the parts made good the first time?',
    formula: 'Good parts ÷ Total count', example: `${(EX.total - EX.nc).toLocaleString()} ÷ ${EX.total.toLocaleString()} = ${pc(EX.Q)}`,
    losses: ['NC (non-conformance) parts', 'Parts scrapped after a die change or setup', 'Parts damaged by a sticking part or loose node'],
    source: 'Vision camera counts NC parts on Premium machines; on Essential machines the operator enters them.',
  },
];

// The shift from clock time down to good parts, as stacked bars (minutes).
const STEPS = [
  ['Shift time', EX.shift, '#CBD5E1', '07:00–15:00, 15:00–23:00, 23:00–07:00'],
  ['Planned time', EX.planned, '#90CAF9', `− ${EX.breaks} min planned breaks (and confirmed planned stops)`],
  ['Run time', EX.run, '#1565C0', `− ${EX.stops} min unplanned stops → Availability`],
  ['Effective run', Math.round(EX.run * EX.P), '#7C3AED', '− speed loss → Performance'],
  ['Good parts time', Math.round(EX.run * EX.P * EX.Q), '#2E7D32', '− NC parts → Quality'],
];

export default function OeeCalculation() {
  return (
    <>
      <PageHeader overline="MASTER DATA" title="OEE calculation" tour="oee" />
      <Stack spacing={2}>
        {/* the summary: OEE in one line and the example result */}
        <Card data-tour="oee-summary">
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} gap={3} alignItems={{ md: 'center' }}>
              <Box flex={1}>
                <Typography variant="overline">Overall Equipment Effectiveness</Typography>
                <Typography variant="h5" component="h2" mb={1}>OEE = Availability × Performance × Quality</Typography>
                <Typography color="text.secondary" lineHeight={1.7}>
                  OEE tells how much of the planned time turned into good parts at full speed. 100% means only good parts,
                  as fast as possible, with no stops. World-class machines run at about 85%. Every shift is scored on its own, live, every second.
                </Typography>
              </Box>
              <Box sx={{ p: 2, borderRadius: '12px', bgcolor: C.light, minWidth: 260 }}>
                <Typography variant="caption" color="text.secondary">Example shift</Typography>
                <Typography sx={{ fontSize: 15, mt: 0.5 }}>{pc(EX.A)} × {pc(EX.P)} × {pc(EX.Q)} =</Typography>
                <Typography sx={{ fontSize: 34, fontWeight: 800, color: C.blueDark, lineHeight: 1.2 }}>{pc(EX.OEE)}</Typography>
                <Typography variant="caption" color="text.secondary">Below an 85% target: the losses below show where it went.</Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* A, P, Q: what each one asks, its formula, what lowers it, where the number comes from */}
        <Box data-tour="oee-factors" sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' } }}>
          {FACTORS.map((f) => (
            <Card key={f.key} sx={{ borderTop: `4px solid ${f.color}` }}>
              <CardContent>
                <Stack direction="row" alignItems="center" gap={1} mb={1}>
                  <f.Icon sx={{ color: f.color }} />
                  <Typography variant="h6" component="h3" flex={1}>{f.name}</Typography>
                  <Chip size="small" label={f.key} sx={{ fontWeight: 800, bgcolor: `${f.color}18`, color: f.color }} />
                </Stack>
                <Typography fontWeight={600} mb={1.5}>{f.question}</Typography>
                <Box sx={{ p: 1.25, borderRadius: '8px', bgcolor: '#F8FAFC', border: `1px solid ${C.line}`, mb: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Formula</Typography>
                  <Typography fontWeight={700}>{f.formula}</Typography>
                  <Typography variant="body2" color="text.secondary" mt={0.5}>Example: {f.example}</Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">What lowers it</Typography>
                <Box component="ul" sx={{ m: 0, mb: 1.5, pl: 2.5 }}>{f.losses.map((l) => <Typography key={l} component="li" variant="body2">{l}</Typography>)}</Box>
                <Typography variant="caption" color="text.secondary">Where the number comes from</Typography>
                <Typography variant="body2">{f.source}</Typography>
              </CardContent>
            </Card>
          ))}
        </Box>

        {/* the example shift as a waterfall from clock time to good parts */}
        <Card data-tour="oee-waterfall">
          <CardContent>
            <Typography variant="h6" component="h2">From shift time to good parts</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>The example shift, step by step (minutes). Each step removes one kind of loss.</Typography>
            <Stack spacing={1.25}>
              {STEPS.map(([label, min, color, note]) => (
                <Box key={label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '160px 1fr 300px' }, gap: { xs: 0.5, md: 2 }, alignItems: 'center' }}>
                  <Typography fontWeight={600}>{label}</Typography>
                  <Box sx={{ height: 22, borderRadius: '6px', bgcolor: '#F1F5F9', overflow: 'hidden' }} role="img" aria-label={`${label}: ${min} minutes`}>
                    <Box sx={{ height: '100%', width: `${(min / EX.shift) * 100}%`, bgcolor: color, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pr: 1 }}>
                      <Typography variant="caption" fontWeight={700} sx={{ color: color === '#CBD5E1' || color === '#90CAF9' ? C.ink : '#FFFFFF' }}>{min} min</Typography>
                    </Box>
                  </Box>
                  <Typography variant="body2" color="text.secondary">{note}</Typography>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>

        {/* the rules behind it */}
        <Card data-tour="oee-notes">
          <CardContent>
            <Typography variant="h6" component="h2" mb={1.5}>Good to know</Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
              {[
                ['Planned time', 'Shift time minus planned breaks (Master data › Planned breaks) and stops confirmed with a planned reason (e.g. a planned maintenance or meeting). Those never lower OEE.'],
                ['Stops and reasons', 'Any stop outside a planned break is downtime. It waits for the operator to give a reason; the PLC alarm and Gemini suggest one.'],
                ['Targets and colours', `Each machine has its own targets and tolerance (Machines › OEE parameters). Green = on target, amber = within the tolerance below it, red = below. Example: ${LEVELS.good.label}, ${LEVELS.near.label}, ${LEVELS.below.label}.`],
                ['Schedule plan and target', 'Schedule plan = planned time ÷ ideal cycle time (100% OEE). Shift target = schedule plan × OEE target. Dr. Macx Live, the dashboard and the handover all use these same numbers.'],
              ].map(([title, text]) => (
                <Box key={title}>
                  <Typography fontWeight={700}>{title}</Typography>
                  <Typography variant="body2" color="text.secondary" lineHeight={1.7}>{text}</Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      </Stack>
    </>
  );
}
