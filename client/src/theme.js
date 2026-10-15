import { createTheme } from '@mui/material/styles';

export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

// Brand tokens from the Dr. Macx brand guidelines.
export const C = {
  ink: '#12161B',
  amber: '#FFB000',
  steel: '#2B323B',
  concrete: '#ECEDE9',
  line: '#C9CDC6',
  muted: '#3A424C',
};

// Machine status: always label + shape + color.
export const STATUS = {
  running: { label: 'Running', bg: '#E3E9F8', fg: '#1E40AF', dot: { borderRadius: '50%', bgcolor: '#1E40AF' } },
  stopped: { label: 'Stopped', bg: '#FCE6DA', fg: '#C2410C', dot: { bgcolor: '#EA580C' } },
  disconnected: { label: 'Not connected', bg: '#EEF0F2', fg: '#4B535D', dot: { borderRadius: '50%', border: '2px solid #A3AAB3', width: 6, height: 6 } },
  inactive: { label: 'Inactive', bg: '#EEF0F2', fg: '#4B535D', dot: { borderRadius: '50%', border: '2px solid #A3AAB3', width: 6, height: 6 } },
};

export const FACTORS = [
  { key: 'availability', label: 'Availability', color: '#EA580C' },
  { key: 'performance', label: 'Performance', color: '#FFB000' },
  { key: 'quality', label: 'Quality', color: '#6D28D9' },
];
export const OEE_COLOR = '#1E40AF';

export const SKILLS = [
  { level: 0, label: 'None', bg: '#FFFFFF', fg: '#3A424C' },
  { level: 1, label: 'Trainee', bg: '#FFF1CC', fg: '#8A5A00' },
  { level: 2, label: 'Can run', bg: '#C9D5F3', fg: '#1E3A8A' },
  { level: 3, label: 'Can teach', bg: '#1E40AF', fg: '#FFFFFF' },
];

const heading = { fontWeight: 800, fontStretch: '115%' };

export const theme = createTheme({
  palette: {
    primary: { main: C.ink },
    secondary: { main: C.amber, contrastText: C.ink },
    background: { default: C.concrete, paper: '#FFFFFF' },
    text: { primary: C.ink, secondary: C.muted },
    divider: C.line,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Archivo, "Noto Sans", sans-serif',
    h4: { ...heading, fontSize: 32 },
    h5: { ...heading, fontSize: 24 },
    h6: { ...heading, fontSize: 18 },
    overline: { fontFamily: MONO, fontSize: 12, letterSpacing: '0.06em', lineHeight: 1.6, color: C.muted },
    button: { textTransform: 'none', fontWeight: 600, fontSize: 15 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 44, paddingInline: 18 } } },
    MuiAppBar: { defaultProps: { elevation: 0 } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 700 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', fontWeight: 600, fontSize: 15, minHeight: 48, color: C.ink,
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: C.ink, color: '#FFFFFF' },
        },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, fontSize: 15, minHeight: 48 } } },
  },
});
