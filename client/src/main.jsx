import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { theme } from './theme.js';
import Layout from './Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Monitoring from './pages/Monitoring.jsx';
import Machines from './pages/Machines.jsx';
import SkillMatrix from './pages/SkillMatrix.jsx';
import { Operators, Users } from './pages/People.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="machines" element={<Machines />} />
            <Route path="operators" element={<Operators />} />
            <Route path="skills" element={<SkillMatrix />} />
            <Route path="users" element={<Users />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
