import {
  Alert, Card, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { api, useCollection } from '../api.js';
import { PageHeader, SkillChip, Mono } from '../ui.jsx';
import { SKILLS } from '../theme.js';

export default function SkillMatrix() {
  const machines = useCollection('machines');
  const operators = useCollection('operators');
  const skills = useCollection('skills');
  const error = machines.error || operators.error || skills.error;

  const level = (o, m) => skills.rows.find((s) => s.operatorId === o && s.machineId === m)?.level ?? 0;
  const change = (operatorId, machineId, lvl) =>
    api('/skills', { method: 'PUT', body: { operatorId, machineId, level: lvl } }).then(skills.reload, (e) => alert(e.message));

  const ms = [...machines.rows].sort((a, b) => a.code.localeCompare(b.code));
  const os = [...operators.rows].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <PageHeader overline="MASTER DATA" title="Skill matrix" tour="skills" />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
        {SKILLS.map((s) => <SkillChip key={s.level} level={s.level} />)}
      </Stack>
      {!ms.length || !os.length ? (
        <Typography color="text.secondary">Add machines and operators first. The matrix shows every operator against every machine.</Typography>
      ) : (
        <TableContainer component={Card}>
          <Table size="small" sx={{ minWidth: 200 + ms.length * 170 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>Operator</TableCell>
                {ms.map((m) => (
                  <TableCell key={m.id}><Mono fontWeight={700}>{m.code}</Mono><Typography variant="caption" display="block" color="text.secondary">{m.name}</Typography></TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {os.map((o) => (
                <TableRow key={o.id}>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
                    <Mono fontWeight={600}>{o.code}</Mono>
                    <Typography variant="body2">{o.name}</Typography>
                  </TableCell>
                  {ms.map((m) => (
                    <TableCell key={m.id}>
                      <Select
                        size="small"
                        variant="standard"
                        disableUnderline
                        value={level(o.id, m.id)}
                        onChange={(e) => change(o.id, m.id, e.target.value)}
                        inputProps={{ 'aria-label': `${o.name} on ${m.code}` }}
                        renderValue={(v) => <SkillChip level={v} />}
                      >
                        {SKILLS.map((s) => <MenuItem key={s.level} value={s.level}><SkillChip level={s.level} /></MenuItem>)}
                      </Select>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
