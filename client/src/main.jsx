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
import DowntimeReasons from './pages/DowntimeReasons.jsx';
import MachineDetail from './pages/MachineDetail.jsx';
import { Operators, Users } from './pages/People.jsx';

// 3D bundle (three.js) loads only when the 3D Floor page is opened.
const Floor = lazy(() => import('./pages/Floor.jsx'));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="monitoring/:id" element={<MachineDetail />} />
            <Route path="floor" element={<Suspense fallback={<LinearProgress />}><Floor /></Suspense>} />
            <Route path="machines" element={<Machines />} />
            <Route path="oee-calculation" element={<OeeCalculation />} />
            <Route path="downtime-reasons" element={<DowntimeReasons />} />
            <Route path="operators" element={<Operators />} />
            <Route path="skills" element={<SkillMatrix />} />
            <Route path="users" element={<Users />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
