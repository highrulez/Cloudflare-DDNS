import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { RouteErrorBoundary } from './components/error-boundary';
import { AppShell } from './components/shell';
import { Loading } from './components/ui';
import { HistoryPage, LoginPage, SettingsPage, SetupGuard } from './pages/core';

const CloudflarePage = lazy(() =>
  import('./pages/cloudflare').then((module) => ({ default: module.CloudflarePage }))
);
const DashboardPage = lazy(() =>
  import('./pages/dashboard').then((module) => ({ default: module.DashboardPage }))
);
const RecordsPage = lazy(() =>
  import('./pages/records').then((module) => ({ default: module.RecordsPage }))
);
const SetupWizard = lazy(() =>
  import('./pages/setup').then((module) => ({ default: module.SetupWizard }))
);
const SystemPage = lazy(() =>
  import('./pages/system').then((module) => ({ default: module.SystemPage }))
);

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950">
        <Loading label="Restoring session" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

export default function App() {
  return (
    <Suspense fallback={<Loading label="Loading page" />}>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route
          path="/login"
          element={
            <SetupGuard>
              <LoginPage />
            </SetupGuard>
          }
        />
        <Route
          element={
            <SetupGuard>
              <Protected />
            </SetupGuard>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/cloudflare" element={<CloudflarePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route
            path="/system"
            element={
              <RouteErrorBoundary message="System information could not be displayed. Refresh the data or try again.">
                <SystemPage />
              </RouteErrorBoundary>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
