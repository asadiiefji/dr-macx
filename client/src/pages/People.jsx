// Operators and Users & roles share one simple master-data page.
import { useState } from 'react';
import {
  Alert, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem,
  Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/AddOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import { api, useCollection } from '../api.js';
import { PageHeader, Mono } from '../ui.jsx';

const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'operator', label: 'Operator' },
];

function MasterPage({ col, title, noun, fields, columns, sortKey, note }) {
  const { rows, error, reload } = useCollection(col);
  const [edit, setEdit] = useState(null); // form values, id set when editing
  const [formError, setFormError] = useState('');
  const blank = Object.fromEntries(fields.map((f) => [f.key, f.default ?? '']));

  const open = (row) => (setFormError(''), setEdit(row ? { ...blank, ...row } : blank));
  const save = async () => {
    try {
      await api(edit.id ? `/${col}/${edit.id}` : `/${col}`, { method: edit.id ? 'PUT' : 'POST', body: edit });
      setEdit(null);
      reload();
    } catch (e) {
      setFormError(e.message);
    }
  };
  const remove = async (row) => {
    if (!window.confirm(`Delete ${noun.toLowerCase()} ${row.name}?`)) return;
    await api(`/${col}/${row.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    reload();
  };

  const sorted = [...rows].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
  return (
    <>
      <PageHeader overline="MASTER DATA" title={title}>
        <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => open()}>Add {noun.toLowerCase()}</Button>
      </PageHeader>
      {note && <Alert severity="info" sx={{ mb: 2 }}>{note}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TableContainer component={Card}>
        <Table sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              {columns.map((c) => <TableCell key={c.key}>{c.label}</TableCell>)}
              <TableCell>Status</TableCell>
              <TableCell align="right" aria-label="Actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.id} hover onClick={() => open(r)} sx={{ cursor: 'pointer' }}>
                {columns.map((c) => <TableCell key={c.key}>{c.render ? c.render(r) : r[c.key]}</TableCell>)}
                <TableCell>{r.active ? 'Active' : 'Inactive'}</TableCell>
                <TableCell align="right">
                  <IconButton aria-label={`Delete ${r.name}`} onClick={(e) => (e.stopPropagation(), remove(r))}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {!sorted.length && (
              <TableRow><TableCell colSpan={columns.length + 2}><Typography color="text.secondary">No {title.toLowerCase()} yet. Add the first one.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!edit} onClose={() => setEdit(null)} fullWidth maxWidth="sm">
        {edit && (
          <>
            <DialogTitle>
              <Typography variant="overline" component="div">{edit.id ? `EDIT ${noun.toUpperCase()}` : `NEW ${noun.toUpperCase()}`}</Typography>
              <Typography variant="h5" component="span">{edit.name || noun}</Typography>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} pt={1}>
                {formError && <Alert severity="error">{formError}</Alert>}
                {fields.map((f) =>
                  f.type === 'switch' ? (
                    <FormControlLabel key={f.key} label={f.label} control={<Switch checked={!!edit[f.key]} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.checked })} />} />
                  ) : (
                    <TextField
                      key={f.key}
                      label={f.label}
                      type={f.type === 'email' ? 'email' : 'text'}
                      select={!!f.options}
                      required={f.required}
                      helperText={f.help}
                      value={edit[f.key]}
                      onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })}
                    >
                      {f.options?.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                    </TextField>
                  ),
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="contained" onClick={save}>{edit.id ? 'Save changes' : `Add ${noun.toLowerCase()}`}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}

export const Operators = () => (
  <MasterPage
    col="operators"
    title="Operators"
    noun="Operator"
    sortKey="code"
    fields={[
      { key: 'code', label: 'Employee ID', required: true },
      { key: 'name', label: 'Full name', required: true },
      { key: 'active', label: 'Active', type: 'switch', default: true },
    ]}
    columns={[
      { key: 'code', label: 'Employee ID', render: (r) => <Mono fontWeight={600}>{r.code}</Mono> },
      { key: 'name', label: 'Name' },
    ]}
  />
);

export const Users = () => (
  <MasterPage
    col="users"
    title="Users & roles"
    noun="User"
    sortKey="name"
    note="Login is not enabled yet. Users and their roles are stored now so access control can be switched on later."
    fields={[
      { key: 'name', label: 'Full name', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'role', label: 'Role', options: ROLES, default: 'operator', required: true },
      { key: 'active', label: 'Active', type: 'switch', default: true },
    ]}
    columns={[
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email', render: (r) => <Mono>{r.email}</Mono> },
      { key: 'role', label: 'Role', render: (r) => ROLES.find((x) => x.value === r.role)?.label ?? r.role },
    ]}
  />
);
