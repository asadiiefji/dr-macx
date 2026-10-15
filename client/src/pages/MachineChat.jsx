// Chat with Gemini about one machine, grounded in its OEE and downtime for the selected period.
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, IconButton, Stack, TextField, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/SendOutlined';
import { api } from '../api.js';
import { C } from '../theme.js';

const STARTERS = [
  'What happened to this machine?',
  'What is the probable cause?',
  'What is the impact on OEE and output?',
  'How do we solve it?',
  'What are the short-term and long-term actions?',
  'How do we stop the repeated cases?',
  'What is likely to happen next?',
];

export default function MachineChat({ id, code, range }) {
  const [messages, setMessages] = useState([]); // { role: 'user' | 'model', text }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' }); // newer browsers return a Promise here; an effect must not
  }, [messages, loading]);

  const send = async (text) => {
    const q = text.trim();
    if (!q || loading) return;
    const next = [...messages, { role: 'user', text: q }].slice(-30);
    setMessages(next);
    setInput('');
    setLoading(true);
    setError('');
    try {
      const { text: answer } = await api(`/machines/${id}/chat`, { method: 'POST', body: { from: range.from, to: range.to, shift: range.shift, messages: next } });
      setMessages([...next, { role: 'model', text: answer }]);
    } catch (e) {
      setError(e.message);
      setMessages(messages); // put the question back so it can be retried
      setInput(q);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2} flexWrap="wrap">
          <Box>
            <Typography variant="h6" component="h2">Ask Gemini about {code}</Typography>
            <Typography variant="body2" color="text.secondary">Answers use this machine's OEE, stops, repeats and operator comments for the selected period.</Typography>
          </Box>
          {messages.length > 0 && <Button onClick={() => (setMessages([]), setError(''))}>New conversation</Button>}
        </Stack>

        <Stack role="log" aria-live="polite" spacing={1.5} mt={2} sx={{ maxHeight: 480, overflowY: 'auto', pr: 0.5 }}>
          {messages.map((m, i) => (
            <Box
              key={i}
              sx={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                px: 2,
                py: 1.25,
                borderRadius: 3,
                bgcolor: m.role === 'user' ? C.blue : '#F1F5F9',
                color: m.role === 'user' ? '#FFFFFF' : C.ink,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.6,
              }}
            >
              <Typography variant="caption" component="div" sx={{ opacity: 0.8, fontWeight: 700 }}>{m.role === 'user' ? 'You' : 'Gemini'}</Typography>
              {m.text}
            </Box>
          ))}
          {loading && (
            <Stack direction="row" alignItems="center" gap={1} color="text.secondary"><CircularProgress size={16} /><Typography variant="body2">Gemini is reading the machine data…</Typography></Stack>
          )}
          <div ref={end} />
        </Stack>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        <Stack direction="row" flexWrap="wrap" gap={1} mt={2}>
          {STARTERS.map((s) => <Chip key={s} label={s} onClick={() => send(s)} disabled={loading} variant="outlined" color="primary" />)}
        </Stack>
        <Stack direction="row" gap={1} mt={2} component="form" onSubmit={(e) => (e.preventDefault(), send(input))}>
          <TextField
            fullWidth
            size="small"
            multiline
            maxRows={4}
            placeholder="Ask anything about this machine, in any language"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send(input))}
            slotProps={{ htmlInput: { maxLength: 4000, 'aria-label': 'Question for Gemini' } }}
          />
          <IconButton type="submit" color="primary" aria-label="Send" disabled={loading || !input.trim()} sx={{ border: `1px solid ${C.line}`, width: 44 }}><SendIcon /></IconButton>
        </Stack>
      </CardContent>
    </Card>
  );
}
