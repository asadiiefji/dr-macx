import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Stack, Toolbar, Tooltip, Typography } from '@mui/material';
import AiIcon from '@mui/icons-material/AutoAwesomeOutlined';
import MenuIcon from '@mui/icons-material/MenuOutlined';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import MonitorIcon from '@mui/icons-material/MonitorHeartOutlined';
import PrecisionIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import BadgeIcon from '@mui/icons-material/BadgeOutlined';
import GridIcon from '@mui/icons-material/GridOnOutlined';
import ShieldIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import ReasonIcon from '@mui/icons-material/RuleOutlined';
import FloorIcon from '@mui/icons-material/ViewInArOutlined';
import { Logo } from './ui.jsx';
import { useGet } from './api.js';
import { C } from './theme.js';

const WIDTH = 248;
const NAV = [
  ['OVERVIEW', [['/', 'Dashboard', DashboardIcon], ['/monitoring', 'Machine monitoring', MonitorIcon], ['/floor', '3D Floor', FloorIcon]]],
  ['MASTER DATA', [['/machines', 'Machines', PrecisionIcon], ['/oee-calculation', 'OEE calculation', TuneIcon], ['/downtime-reasons', 'Downtime reasons', ReasonIcon], ['/operators', 'Operators', BadgeIcon], ['/skills', 'Skill matrix', GridIcon], ['/users', 'Users & roles', ShieldIcon]]],
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const nav = (
    <Box component="nav" aria-label="Main" sx={{ p: 1.5 }}>
      {NAV.map(([section, items]) => (
        <List key={section} subheader={<ListSubheader sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', lineHeight: '32px', color: 'text.secondary' }}>{section}</ListSubheader>}>
          {items.map(([to, label, Icon]) => (
            <ListItemButton
              key={to}
              component={NavLink}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              sx={{ borderRadius: 3, minHeight: 46, mb: 0.5, color: C.muted, '&.active': { bgcolor: C.light, color: C.blueDark, fontWeight: 700, '& .MuiListItemIcon-root': { color: C.blue } } }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}><Icon /></ListItemIcon>
              <ListItemText primary={label} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
            </ListItemButton>
          ))}
        </List>
      ))}
      <AiModels />
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton color="inherit" edge="start" aria-label="Open menu" onClick={() => setOpen(true)} sx={{ mr: 1, display: { md: 'none' } }}>
            <MenuIcon />
          </IconButton>
          <Logo />
        </Toolbar>
      </AppBar>
      <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} sx={{ display: { md: 'none' }, '& .MuiDrawer-paper': { width: WIDTH } }}>
        {nav}
      </Drawer>
      <Drawer variant="permanent" sx={{ display: { xs: 'none', md: 'block' }, width: WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box', borderColor: C.line } }}>
        <Toolbar />
        {nav}
      </Drawer>
      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 4 } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}

// The Google AI models this server uses, how they are reached, and how their last call went.
const AI_STATE = {
  ok: { label: 'Working', color: '#2E7D32' },
  error: { label: 'Error', color: '#C62828' },
  off: { label: 'No key', color: '#8A5300' },
  idle: { label: 'Ready', color: '#475569' },
};
function AiModels() {
  const { data, reload } = useGet('/ai');
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);
  if (!data) return null;
  return (
    <List subheader={<ListSubheader sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', lineHeight: '32px', color: 'text.secondary' }}>AI MODELS</ListSubheader>}>
      {Object.values(data).map((m) => {
        const st = AI_STATE[!m.configured ? 'off' : m.state ?? 'idle'] ?? AI_STATE.idle;
        const tip = m.message || (m.state === 'ok' ? `Last call worked at ${new Date(m.at).toLocaleTimeString()}` : m.configured ? 'Not used yet since the server started' : 'Set GEMINI_API_KEY');
        return (
          <Tooltip key={m.name} title={tip} placement="right">
            <Box tabIndex={0} sx={{ px: 1.5, py: 1, mb: 0.5, borderRadius: 3, bgcolor: '#F8FAFC', border: `1px solid ${C.line}` }}>
              <Stack direction="row" alignItems="center" gap={1}>
                <AiIcon sx={{ fontSize: 18, color: C.blue }} />
                <Typography fontWeight={700} fontSize={14} flex={1}>{m.name}</Typography>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: st.color }} />
                <Typography fontSize={12} fontWeight={700} sx={{ color: st.color }}>{st.label}</Typography>
              </Stack>
              <Typography fontSize={12} color="text.secondary" sx={{ wordBreak: 'break-all' }}>{m.model}</Typography>
              <Typography fontSize={11} color="text.secondary">via {m.via}</Typography>
              {m.state === 'error' && <Typography fontSize={11} sx={{ color: st.color, mt: 0.5 }}>{m.message}</Typography>}
            </Box>
          </Tooltip>
        );
      })}
    </List>
  );
}
