import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './components/shell';
import { Loading } from './components/ui';
import { CloudflarePage, DashboardPage, HistoryPage, LoginPage, RecordsPage, SettingsPage, SetupGuard, SetupWizard } from './pages';

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-950"><Loading label="Restoring session" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

export default function App() {
  return <Routes>
    <Route path="/setup" element={<SetupWizard />} />
    <Route path="/login" element={<SetupGuard><LoginPage /></SetupGuard>} />
    <Route element={<SetupGuard><Protected /></SetupGuard>}>
      <Route index element={<DashboardPage />} />
      <Route path="/records" element={<RecordsPage />} />
      <Route path="/cloudflare" element={<CloudflarePage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
