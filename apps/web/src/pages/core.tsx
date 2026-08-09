import {
  ArrowRight,
  Eye,
  EyeOff,
  Globe2,
  RefreshCw,
  Save,
  ShieldCheck,
  Wifi,
  Zap
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api, type HistoryItem, type Settings } from '../api';
import { useAuth } from '../auth';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  SelectField,
  formatDate,
  useToast
} from '../components/ui';

function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    loader()
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [loader]);
  useEffect(load, [load]);
  return { data, setData, loading, error, reload: load };
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await login(String(form.get('username') ?? ''), String(form.get('password') ?? ''));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950">
        <Loading label="Restoring session" />
      </div>
    );
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="relative grid min-h-screen bg-slate-950 px-4 py-10 text-white lg:grid-cols-2">
      <div className="hidden items-center justify-center p-12 lg:flex">
        <div className="max-w-lg">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-500">
            <Wifi />
          </span>
          <p className="mt-8 text-sm font-bold uppercase tracking-[.2em] text-blue-300">
            Cloudflare DDNS Manager
          </p>
          <h1 className="mt-4 text-5xl font-bold">Every selected record, always pointing home.</h1>
          <div className="mt-10 grid grid-cols-3 gap-3">
            <Feature icon={<Zap />} label="Automatic" />
            <Feature icon={<ShieldCheck />} label="Secure" />
            <Feature icon={<Globe2 />} label="Multi-zone" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center">
        <Card className="w-full max-w-md p-8 text-slate-950 dark:text-white">
          <h2 className="text-2xl font-bold">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to manage dynamic DNS.</p>
          {error && (
            <div
              role="alert"
              className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </div>
          )}
          <form onSubmit={(event) => void submit(event)} className="mt-6 grid gap-5">
            <Field label="Username" name="username" autoComplete="username" required />
            <div className="relative">
              <Field
                label="Password"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                aria-label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow(!show)}
                className="absolute bottom-2 right-2 p-2"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button busy={busy}>
              Sign in <ArrowRight className="h-4 w-4" />
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
function Feature({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 p-4">
      {icon}
      <strong className="mt-2 block">{label}</strong>
    </div>
  );
}

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [record, setRecord] = useState('');
  const query = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) value.set('status', status);
    if (record) value.set('record', record);
    return value;
  }, [page, status, record]);
  const load = useCallback(() => api.history(query), [query]);
  const state = useLoad(load);
  const pages = state.data ? Math.max(1, Math.ceil(state.data.total / state.data.pageSize)) : 1;
  return (
    <div className="space-y-7">
      <PageTitle
        eyebrow="Audit log"
        title="Update History"
        description="Checks, updates, creation, management changes, and Cloudflare deletion events."
        actions={
          <Button variant="secondary" onClick={state.reload}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field
          label="Record"
          value={record}
          onChange={(event) => {
            setRecord(event.target.value);
            setPage(1);
          }}
        />
        <SelectField
          label="Result"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All results</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </SelectField>
      </Card>
      {state.loading ? (
        <Loading label="Loading update history" />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.reload} />
      ) : (
        <Card>
          <HistoryRows items={state.data?.items ?? []} />
          <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm dark:border-slate-800">
            <span>
              {state.data?.total ?? 0} events · Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
function HistoryRows({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <p className="p-6 text-sm text-slate-500">No matching events.</p>;
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <strong className="block truncate">{item.recordName ?? item.action}</strong>
            <span className="text-xs text-slate-500">
              {item.message ?? [item.oldValue, item.newValue].filter(Boolean).join(' → ')}
            </span>
          </div>
          <Badge status={item.status} />
          <time className="text-xs text-slate-500">{formatDate(item.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

const settingsLoad = () => api.settings();
export function SettingsPage() {
  const { user, setUser } = useAuth();
  const state = useLoad<Settings>(settingsLoad);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('settings');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.updateSettings({
        intervalMinutes: Number(form.get('interval')),
        ipv4Enabled: form.get('ipv4Enabled') === 'on',
        ipv6Enabled: form.get('ipv6Enabled') === 'on',
        automaticUpdates: form.get('automaticUpdates') === 'on',
        requestTimeoutMs: Number(form.get('requestTimeoutMs')),
        retentionDays: Number(form.get('retentionDays')),
        timezone: String(form.get('timezone') ?? '')
      });
      state.setData(result.settings);
      toast('DDNS settings saved.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not save settings', 'error');
    } finally {
      setBusy('');
    }
  };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('profile');
    try {
      const form = new FormData(event.currentTarget);
      const result = await api.updateProfile({ username: String(form.get('username') ?? '') });
      setUser(result.user);
      toast('Username updated.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not update username', 'error');
    } finally {
      setBusy('');
    }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword') ?? '');
    if (next !== String(form.get('confirmPassword') ?? ''))
      return toast('New passwords do not match.', 'error');
    setBusy('password');
    try {
      await api.changePassword({
        currentPassword: String(form.get('currentPassword') ?? ''),
        newPassword: next
      });
      event.currentTarget.reset();
      toast('Password changed. Sign in again with the new password.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not change password', 'error');
    } finally {
      setBusy('');
    }
  };
  if (state.loading) return <Loading label="Loading settings" />;
  if (state.error || !state.data)
    return <ErrorState message={state.error || 'Settings unavailable'} retry={state.reload} />;
  const settings = state.data;
  return (
    <div className="space-y-7">
      <PageTitle
        eyebrow="Configuration"
        title="Settings"
        description="Polling, public IP detection, retention, and administrator security."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-lg font-bold">DDNS behavior</h2>
          <form onSubmit={(event) => void saveSettings(event)} className="mt-5 grid gap-4">
            <SelectField
              label="Check interval"
              name="interval"
              defaultValue={settings.intervalMinutes}
            >
              <option value="1">Every minute</option>
              <option value="5">Every 5 minutes</option>
              <option value="10">Every 10 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
            </SelectField>
            <Field
              label="HTTP timeout (ms)"
              name="requestTimeoutMs"
              type="number"
              min={1000}
              max={30000}
              defaultValue={settings.requestTimeoutMs}
              required
            />
            <Field
              label="History retention (days)"
              name="retentionDays"
              type="number"
              min={1}
              max={3650}
              defaultValue={settings.retentionDays}
              required
            />
            <Field label="Timezone" name="timezone" defaultValue={settings.timezone} required />
            <CheckField
              name="ipv4Enabled"
              defaultChecked={settings.ipv4Enabled}
              label="Detect IPv4 and manage A records"
            />
            <CheckField
              name="ipv6Enabled"
              defaultChecked={settings.ipv6Enabled}
              label="Detect IPv6 and manage AAAA records"
            />
            <CheckField
              name="automaticUpdates"
              defaultChecked={settings.automaticUpdates}
              label="Enable scheduled DDNS updates"
            />
            <Button busy={busy === 'settings'}>
              <Save className="h-4 w-4" />
              Save settings
            </Button>
          </form>
        </Card>
        <div className="grid content-start gap-5">
          <Card className="p-6">
            <h2 className="text-lg font-bold">Administrator</h2>
            <form onSubmit={(event) => void saveProfile(event)} className="mt-5 grid gap-4">
              <Field label="Username" name="username" defaultValue={user?.username} required />
              <Button busy={busy === 'profile'}>Save username</Button>
            </form>
          </Card>
          <Card className="p-6">
            <h2 className="text-lg font-bold">Password</h2>
            <form onSubmit={(event) => void changePassword(event)} className="mt-5 grid gap-4">
              <Field label="Current password" name="currentPassword" type="password" required />
              <Field
                label="New password"
                name="newPassword"
                type="password"
                minLength={12}
                required
              />
              <Field
                label="Confirm password"
                name="confirmPassword"
                type="password"
                minLength={12}
                required
              />
              <Button busy={busy === 'password'}>Change password</Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
function CheckField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}

export function SetupGuard({ children }: { children: ReactNode }) {
  const state = useLoad(api.setupStatus);
  if (state.loading)
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950">
        <Loading label="Checking setup" />
      </div>
    );
  if (state.data?.required) return <Navigate to="/setup" replace />;
  if (state.error) return <ErrorState message={state.error} retry={state.reload} />;
  return children;
}
