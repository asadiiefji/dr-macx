// Request-body validation for master data. Each parser returns { value } or { error }.

export const ROLES = ['admin', 'supervisor', 'operator'];
export const TAG_KEYS = ['runStatus', 'totalCount', 'rejectCount', 'alarmCode'];
// Kepware address: Channel.Device[.Group...].Tag
const TAG_RE = /^[\w-]+(\.[\w-]+){2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function machine(b) {
  const value = {
    code: str(b.code, 32).toUpperCase(),
    name: str(b.name),
    line: str(b.line, 60),
    area: str(b.area, 60),
    idealCycleTime: Number(b.idealCycleTime),
    active: b.active !== false,
    source: b.source === 'kepware' ? 'kepware' : 'dummy',
    kepware: {
      endpoint: str(b.kepware?.endpoint, 200),
      channel: str(b.kepware?.channel, 64),
      device: str(b.kepware?.device, 64),
    },
    tags: Object.fromEntries(TAG_KEYS.map((k) => [k, str(b.tags?.[k], 200)])),
  };
  if (!value.code) return { error: 'Machine code is required.' };
  if (!value.name) return { error: 'Machine name is required.' };
  if (!(value.idealCycleTime > 0 && value.idealCycleTime <= 86400))
    return { error: 'Ideal cycle time must be a number of seconds above 0.' };
  if (value.source === 'kepware') {
    if (!value.kepware.endpoint) return { error: 'Kepware endpoint is required for a PLC source.' };
    if (TAG_KEYS.some((k) => !value.tags[k])) return { error: 'All four tag addresses are required for a PLC source.' };
  }
  const bad = TAG_KEYS.find((k) => value.tags[k] && !TAG_RE.test(value.tags[k]));
  if (bad) return { error: `Tag "${value.tags[bad]}" is not valid. Use Channel.Device.Tag format.` };
  return { value };
}

function operator(b) {
  const value = { code: str(b.code, 32).toUpperCase(), name: str(b.name), active: b.active !== false };
  if (!value.code) return { error: 'Employee ID is required.' };
  if (!value.name) return { error: 'Operator name is required.' };
  return { value };
}

function user(b) {
  const value = { name: str(b.name), email: str(b.email, 200).toLowerCase(), role: b.role, active: b.active !== false };
  if (!value.name) return { error: 'Name is required.' };
  if (!EMAIL_RE.test(value.email)) return { error: 'Enter a valid email address.' };
  if (!ROLES.includes(value.role)) return { error: `Role must be one of: ${ROLES.join(', ')}.` };
  return { value };
}

// collection -> parser and the field that must be unique
export const schemas = {
  machines: { parse: machine, unique: 'code', label: 'Machine code' },
  operators: { parse: operator, unique: 'code', label: 'Employee ID' },
  users: { parse: user, unique: 'email', label: 'Email' },
};
