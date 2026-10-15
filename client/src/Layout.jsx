import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Toolbar } from '@mui/material';
import MenuIcon from '@mui/icons-material/MenuOutlined';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import MonitorIcon from '@mui/icons-material/MonitorHeartOutlined';
import PrecisionIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import BadgeIcon from '@mui/icons-material/BadgeOutlined';
import GridIcon from '@mui/icons-material/GridOnOutlined';
import ShieldIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import { Logo } from './ui.jsx';
import { C } from './theme.js';

const WIDTH = 248;
const NAV = [
  ['OVERVIEW', [['/', 'Dashboard', DashboardIcon], ['/monitoring', 'Machine monitoring', MonitorIcon]]],
  ['MASTER DATA', [['/machines', 'Machines', PrecisionIcon], ['/operators', 'Operators', BadgeIcon], ['/skills', 'Skill matrix', GridIcon], ['/users', 'Users & roles', ShieldIcon]]],
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const nav = (
    <Box component="nav" aria-label="Main" sx={{ p: 1.5 }}>
      {NAV.map(([section, items]) => (
        <List key={section} subheader={<ListSubheader sx={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, letterSpacing: '0.06em', lineHeight: '32px' }}>{section}</ListSubheader>}>
          {items.map(([to, label, Icon]) => (
            <ListItemButton
              key={to}
              component={NavLink}
              to={to}
              end
              onClick={() => setOpen(false)}
              sx={{ borderRadius: 2.5, minHeight: 48, mb: 0.5, '&.active': { bgcolor: C.amber, fontWeight: 600, '&:hover': { bgcolor: C.amber } } }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: C.ink }}><Icon /></ListItemIcon>
              <ListItemText primary={label} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
            </ListItemButton>
          ))}
        </List>
      ))}
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
      <Drawer variant="permanent" sx={{ display: { xs: 'none', md: 'block' }, width: WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: WIDTH, boxSizing: 'border-box' } }}>
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
