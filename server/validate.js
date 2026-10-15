// Request-body validation for master data. Each parser returns { value } or { error }.

export const ROLES = ['admin', 'supervisor', 'operator'];
export const CATEGORIES = ['Breakdown', 'Changeover', 'Material', 'Minor stop', 'Quality', 'Operator break', 'Other'];
// Reasons in this category may only be given to a stop that touches a scheduled break.
export const BREAK_CATEGORY = 'Operator break';
export const FACTOR_KEYS = ['oee', 'availability', 'performance', 'quality'];
const FACTOR_LABELS = { oee: 'OEE', availability: 'Availability', performance: 'Performance', quality: 'Quality' };
// Per-machine target and tolerance (% points below target that is still "near", shown yellow).
export const DEFAULT_TARGETS = {
  oee: { target: 85, margin: 5 },
  availability: { target: 90, margin: 5 },
  performance: { target: 95, margin: 5 },
  quality: { target: 99, margin: 1 },
};
export const TAG_KEYS = ['runStatus', 'totalCount', 'rejectCount', 'alarmCode'];
// Kepware address: Channel.Device[.Group...].Tag
const TAG_RE = /^[\w-]+(\.[\w-]+){2,}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
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
    targets: Object.fromEntries(
      FACTOR_KEYS.map((k) => [k, { target: Number(b.targets?.[k]?.target ?? DEFAULT_TARGETS[k].target), margin: Number(b.targets?.[k]?.margin ?? DEFAULT_TARGETS[k].margin) }]),
    ),
  };
  if (!value.code) return { error: 'Machine code is required.' };
  if (!value.name) return { error: 'Machine name is required.' };
  if (!(value.idealCycleTime > 0 && value.idealCycleTime <= 86400))
    return { error: 'Ideal cycle time must be a number of seconds above 0.' };
  if (value.source === 'kepware') {
    if (!value.kepware.endpoint) return { error: 'Kepware endpoint is required for a PLC source.' };
    if (TAG_KEYS.some((k) => !value.tags[k])) return { error: 'All four tag addresses are required for a PLC source.' };
  }
  const badTarget = FACTOR_KEYS.find((k) => {
    const { target, margin } = value.targets[k];
    return !(target > 0 && target <= 100 && margin >= 0 && margin <= target);
  });
  if (badTarget) return { error: `${FACTOR_LABELS[badTarget]} target must be 1–100% and its tolerance between 0 and the target.` };
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

// Downtime reason. alarmCode (optional) = the PLC alarm that suggests this reason for a new stop.
// type planned = scheduled stop (maintenance, meeting, QC patrol): excluded from planned production time, so it never lowers OEE.
function reason(b) {
  const noAlarm = b.alarmCode === '' || b.alarmCode == null;
  const value = {
    code: str(b.code, 24).toUpperCase(),
    name: str(b.name),
    category: b.category,
    alarmCode: noAlarm ? null : Number(b.alarmCode),
    type: b.type === 'planned' ? 'planned' : 'unplanned',
  };
  if (!/^[A-Z0-9-]+$/.test(value.code)) return { error: 'Reason code is required: letters, digits and "-" only (e.g. BD-HYD).' };
  if (!value.name) return { error: 'Reason name is required.' };
  if (!CATEGORIES.includes(value.category)) return { error: `Category must be one of: ${CATEGORIES.join(', ')}.` };
  if (!noAlarm && !(Number.isInteger(value.alarmCode) && value.alarmCode > 0 && value.alarmCode <= 65535))
    return { error: 'Linked alarm code must be a whole number from 1 to 65535, or empty.' };
  return { value };
}

// OEE calculation settings: planned breaks (same every day, not overnight).
export function parseSettings(b) {
  if (!Array.isArray(b.breaks) || b.breaks.length > 20) return { error: 'Breaks must be a list of at most 20.' };
  const breaks = b.breaks.map((x) => ({ name: str(x?.name, 60), start: str(x?.start, 5), end: str(x?.end, 5) }));
  for (const x of breaks) {
    if (!x.name) return { error: 'Each break needs a name.' };
    if (!HHMM_RE.test(x.start) || !HHMM_RE.test(x.end)) return { error: `Break "${x.name}": use HH:MM times.` };
    if (x.end <= x.start) return { error: `Break "${x.name}" must end after it starts, on the same day.` };
  }
  breaks.sort((a, c) => a.start.localeCompare(c.start));
  // minutes before/after a break in which a stop may still be given an operator-break reason
  const breakToleranceMin = b.breakToleranceMin === undefined || b.breakToleranceMin === '' ? 5 : Number(b.breakToleranceMin);
  if (!(breakToleranceMin >= 0 && breakToleranceMin <= 30)) return { error: 'Break tolerance must be 0–30 minutes.' };
  return { value: { breaks, breakToleranceMin } };
}

// Confirming (or changing) the reason of one downtime event.
export function parseConfirm(b) {
  const value = { reasonCode: str(b.reasonCode, 24).toUpperCase(), comment: str(b.comment, 500) };
  if (!value.reasonCode) return { error: 'Pick a downtime reason.' };
  const operatorId = str(b.operatorId, 64);
  if (operatorId) value.operatorId = operatorId; // who submitted it (earns points); optional
  return { value };
}

// collection -> parser and the fields that must be unique ([field, label]; empty values are not checked)
export const schemas = {
  machines: { parse: machine, unique: [['code', 'Machine code']] },
  operators: { parse: operator, unique: [['code', 'Employee ID']] },
  users: { parse: user, unique: [['email', 'Email']] },
  reasons: { parse: reason, unique: [['code', 'Reason code'], ['alarmCode', 'Alarm code']] },
};
