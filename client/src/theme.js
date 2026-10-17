import { createTheme } from '@mui/material/styles';

// One typeface everywhere; numbers use tabular figures (set on body) so columns line up.
const FONT = '"Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = FONT;

export const C = {
  ink: '#0F172A',
  blue: '#1565C0',
  blueDark: '#0D47A1',
  light: '#E3F2FD',
  sky: '#0288D1',
  bg: '#F4F8FC',
  line: '#E2E8F0',
  muted: '#475569',
};

// Machine status: always label + shape + color.
const ring = (color) => ({ borderRadius: '50%', border: `2px solid ${color}`, width: 6, height: 6 });
export const STATUS = {
  running: { label: 'Running', bg: '#E3F2FD', fg: '#0D47A1', dot: { borderRadius: '50%', bgcolor: '#1565C0' } },
  stopped: { label: 'Stopped', bg: '#FFF3E0', fg: '#B23C00', dot: { bgcolor: '#E65100' } },
  disconnected: { label: 'Not connected', bg: '#F1F5F9', fg: '#475569', dot: ring('#94A3B8') },
  break: { label: 'Planned break', bg: '#E1F5FE', fg: '#01579B', dot: ring('#0288D1') },
  inactive: { label: 'Inactive', bg: '#F1F5F9', fg: '#475569', dot: ring('#94A3B8') },
};

export const FACTORS = [
  { key: 'availability', label: 'Availability' },
  { key: 'performance', label: 'Performance' },
  { key: 'quality', label: 'Quality' },
];
export const KPIS = [{ key: 'oee', label: 'OEE' }, ...FACTORS];

// Target judgement against a machine's target and tolerance margin (always shown with icon + label).
export const LEVELS = {
  good: { label: 'On target', color: '#2E7D32', bar: '#43A047', bg: '#E8F5E9' },
  near: { label: 'Near limit', color: '#8A5300', bar: '#F9A825', bg: '#FFF8E1' },
  below: { label: 'Below target', color: '#C62828', bar: '#E53935', bg: '#FFEBEE' },
};
export function level(value, t) {
  if (value == null || !t) return null;
  const v = value * 100;
  return v >= t.target ? 'good' : v >= t.target - t.margin ? 'near' : 'below';
}

// Downtime categories, fixed order (validated categorical palette; always shown with labels). Other = neutral.
export const CATEGORIES = [
  { name: 'Breakdown', color: '#eb6834' },
  { name: 'Changeover', color: '#2a78d6' },
  { name: 'Material', color: '#eda100' },
  { name: 'Minor stop', color: '#1baf7a' },
  { name: 'Quality', color: '#e87ba4' },
  { name: 'Operator break', color: '#6250d6' },
  { name: 'Other', color: '#8A94A6' },
];

export const SKILLS = [
  { level: 0, label: 'None', bg: '#FFFFFF', fg: '#475569' },
  { level: 1, label: 'Trainee', bg: '#E1F5FE', fg: '#01579B' },
  { level: 2, label: 'Can run', bg: '#90CAF9', fg: '#0D47A1' },
  { level: 3, label: 'Can teach', bg: '#1565C0', fg: '#FFFFFF' },
];

const shadow = '0 1px 2px rgba(15,23,42,0.05), 0 2px 8px rgba(15,23,42,0.06)';

export const theme = createTheme({
  palette: {
    primary: { main: C.blue, dark: C.blueDark, light: '#42A5F5' },
    secondary: { main: C.sky, contrastText: '#FFFFFF' },
    success: { main: LEVELS.good.color },
    warning: { main: '#ED6C02' },
    error: { main: LEVELS.below.color },
    background: { default: C.bg, paper: '#FFFFFF' },
    text: { primary: C.ink, secondary: C.muted },
    divider: C.line,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT,
    h4: { fontWeight: 800, fontSize: 28, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em' },
    h6: { fontWeight: 700, fontSize: 17 },
    overline: { fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1.6, color: C.muted },
    button: { textTransform: 'none', fontWeight: 600, fontSize: 14.5 },
  },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { fontVariantNumeric: 'tabular-nums' } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 38, paddingInline: 16, borderRadius: 8 }, sizeSmall: { minHeight: 32, paddingInline: 12 } } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' }, styleOverrides: { root: { backgroundColor: '#FFFFFF', borderBottom: `1px solid ${C.line}` } } },
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { borderRadius: 12, boxShadow: shadow, border: `1px solid ${C.line}` } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 12 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 600 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 700, color: C.muted, fontSize: 13, backgroundColor: '#F8FAFC' }, root: { borderColor: C.line } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, fontSize: 15, minHeight: 48 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4 } } },
  },
});
