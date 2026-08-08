import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { AppLayout } from './layout';
import {
  ActivityPage,
  DashboardPage,
  DomainsPage,
  FuturePage,
  LoginPage,
  ProvidersPage,
  RecordsPage,
  SettingsPage
} from './pages';
import { Spinner } from './ui';
import './styles.css';

function Protected({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth();
  const location = useLocation();
  if (restoring)
    return (
      <div className="app-loading">
        <Spinner label="Restoring your workspace" />
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.mustChangePassword && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />;
  }
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="dns/providers" element={<ProvidersPage />} />
        <Route path="dns/domains" element={<DomainsPage />} />
        <Route path="dns/records" element={<RecordsPage />} />
        <Route path="dns/ddns" element={<RecordsPage ddns />} />
        <Route path="dns/activity" element={<ActivityPage />} />
        <Route
          path="infrastructure/docker"
          element={
            <FuturePage
              module="Docker"
              description="Container inventory, health, and runtime operations."
            />
          }
        />
        <Route
          path="infrastructure/system"
          element={
            <FuturePage
              module="System"
              description="Host resources, services, and performance telemetry."
            />
          }
        />
        <Route
          path="infrastructure/ssl"
          element={
            <FuturePage
              module="SSL"
              description="Certificate inventory, expiry tracking, and renewals."
            />
          }
        />
        <Route
          path="notifications"
          element={
            <FuturePage
              module="Notifications"
              description="Alert routing, delivery channels, and escalation policies."
            />
          }
        />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
