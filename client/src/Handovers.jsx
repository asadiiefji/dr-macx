// Shift handover history: what each finished shift handed to the next (written by the press with Gemini).
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Chip, Stack, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useGet } from './api.js';
import { num, pct } from './ui.jsx';
import { useLang, useT } from './i18n.jsx';
import { BCP } from './soul/useVoice.js';

const when = (t, locale) => new Date(t).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Bullets({ title, items }) {
  const t = useT();
  if (!items?.length) return null;
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">{t(title)}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{items.map((x, i) => <li key={i}><Typography variant="body2">{t(x)}</Typography></li>)}</Box>
    </Box>
  );
}

export default function Handovers({ machineId, limit = 10 }) {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'en' ? undefined : BCP[lang];
  const { data, error } = useGet(`/machines/${machineId}/handovers?limit=${limit}`);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Typography color="text.secondary">{t('Loading handovers…')}</Typography>;
  if (!data.length) return <Typography color="text.secondary">{t('No handovers yet. The first one is written when the current shift ends.')}</Typography>;
  return (
    <Box>
      {data.map((h, i) => (
        <Accordion key={h.id} defaultExpanded={i === 0} disableGutters variant="outlined">
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography fontWeight={700}>{t(h.shift)}</Typography>
              <Typography variant="body2" color="text.secondary">{when(h.start, locale)} – {new Date(h.end).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</Typography>
              <Chip size="small" label={`OEE ${pct(h.oee)}`} />
              <Chip size="small" variant="outlined" label={`${num(h.good)} / ${num(h.plan)} ${t('good')}`} />
              {!h.ai && <Chip size="small" variant="outlined" label={t('Without AI')} />}
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1.5}>
              <Typography>{t(h.summary)}</Typography>
              <Bullets title="For the next shift" items={h.highlights} />
              <Bullets title="Advice" items={h.advice} />
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
