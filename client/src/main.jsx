import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { CssBaseline, LinearProgress, ThemeProvider } from '@mui/material';
import { theme } from './theme.js';
import Layout from './Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Machines from './pages/Machines.jsx';
import SkillMatrix from './pages/SkillMatrix.jsx';
import OeeCalculation from './pages/OeeCalculation.jsx';
import PlannedBreaks from './pages/PlannedBreaks.jsx';
import Settings from './pages/Settings.jsx';
import DowntimeReasons from './pages/DowntimeReasons.jsx';
import MachineDetail from './pages/MachineDetail.jsx';
import { Operators } from './pages/People.jsx';

// Dr. Macx Live, the kiosk next to each machine (3D character), runs full screen, outside the side menu.
const Soul = lazy(() => import('./soul/Soul.jsx'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="soul" element={<Suspense fallback={<LinearProgress />}><Soul /></Suspense>} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="monitoring/:id" element={<MachineDetail />} />
            <Route path="machines" element={<Machines />} />
            <Route path="oee-calculation" element={<OeeCalculation />} />
            <Route path="planned-breaks" element={<PlannedBreaks />} />
            <Route path="settings" element={<Settings />} />
            <Route path="downtime-reasons" element={<DowntimeReasons />} />
            <Route path="operators" element={<Operators />} />
            <Route path="skills" element={<SkillMatrix />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
