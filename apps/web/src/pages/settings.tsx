import { Save } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes
} from 'react';
import { api, type Settings } from '../api';
import { useAuth } from '../auth';
import { SecuritySettingsPanel, SessionsSettingsPanel } from '../components/mfa-settings';
import { useStrongAuth } from '../components/strong-auth';
import {
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  PasswordField,
  SelectField,
  cx,
  useToast
} from '../components/ui';

type Section = 'profile' | 'security' | 'sessions' | 'preferences';

const navGroups: Array<{
  label: string;
  items: Array<{ id: Section; label: string }>;
}> = [
  {
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'security', label: 'Security' },
      { id: 'sessions', label: 'Sessions' }
    ]
  },
  {
    label: 'Application',
    items: [{ id: 'preferences', label: 'Preferences' }]
  }
];

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { mfaEnabled } = useStrongAuth();
  const toast = useToast();
  const [section, setSection] = useState<Section>('security');
  const [settings, setSettings] = useState<Settings>();
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [busy, setBusy] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      setSettings(await api.settings());
      setSettingsError('');
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : 'Could not load preferences');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.theme = next;
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
    if (next !== String(form.get('confirmPassword') ?? '')) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setBusy('password');
    setPasswordError('');
    try {
      const code = String(form.get('code') ?? '').trim();
      await api.changePassword({
        currentPassword: String(form.get('currentPassword') ?? ''),
        newPassword: next,
        ...(code ? { code } : {})
      });
      setPasswordOpen(false);
      toast('Password updated');
      setUser(null);
    } catch (caught) {
      setPasswordError(
        caught instanceof Error ? caught.message : 'Could not change password'
      );
    } finally {
      setBusy('');
    }
  };

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
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
      setSettings(result.settings);
      toast('Preferences saved.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not save preferences', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageTitle
        eyebrow="Settings"
        title="Settings"
        description="Manage your account, authentication, sessions, and application preferences."
      />

      <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="ops-panel h-fit p-2 lg:sticky lg:top-20"
        >
          {navGroups.map((group) => (
            <div key={group.label} className="mb-3 last:mb-0">
              <p className="ops-eyebrow px-2.5 py-2">{group.label}</p>
              <div className="grid gap-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSection(item.id)}
                    className={cx(
                      'rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition',
                      section === item.id
                        ? 'bg-accent/10 text-slate-950 dark:bg-white/[0.06] dark:text-white'
                        : 'text-slate-500 hover:bg-slate-100/80 dark:hover:bg-white/[0.04]'
                    )}
                    aria-current={section === item.id ? 'page' : undefined}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {section === 'profile' && (
            <Card className="p-5">
              <p className="ops-eyebrow">Profile</p>
              <form onSubmit={(event) => void saveProfile(event)} className="mt-4 grid max-w-md gap-4">
                <Field
                  label="Username"
                  name="username"
                  defaultValue={user?.username}
                  required
                  autoComplete="username"
                />
                <Button busy={busy === 'profile'} className="w-fit">
                  Save username
                </Button>
              </form>
            </Card>
          )}

          {section === 'security' && (
            <SecuritySettingsPanel onPasswordClick={() => setPasswordOpen(true)} />
          )}

          {section === 'sessions' && <SessionsSettingsPanel />}

          {section === 'preferences' && (
            <div className="grid gap-4">
              <Card className="p-5">
                <p className="ops-eyebrow">Appearance</p>
                <p className="mt-2 text-[13px] text-slate-500">Theme</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(
                    [
                      ['light', 'Light'],
                      ['dark', 'Dark']
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => applyTheme(value)}
                      className={cx(
                        'rounded-lg border px-3 py-2 text-[13px] font-medium transition',
                        theme === value
                          ? 'border-accent/40 bg-accent/10 text-slate-950 dark:border-sky-400/30 dark:text-white'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
                      )}
                      aria-pressed={theme === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Card>

              {settingsLoading ? (
                <Card className="p-5">
                  <Loading label="Loading preferences" />
                </Card>
              ) : settingsError || !settings ? (
                <ErrorState
                  message={settingsError || 'Preferences unavailable'}
                  retry={() => void loadSettings()}
                />
              ) : (
                <Card className="p-5">
                  <p className="ops-eyebrow">DDNS preferences</p>
                  <form
                    onSubmit={(event) => void savePreferences(event)}
                    className="mt-4 grid max-w-xl gap-4"
                  >
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
                    <Field
                      label="Timezone"
                      name="timezone"
                      defaultValue={settings.timezone}
                      required
                    />
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
                    <Button busy={busy === 'settings'} className="w-fit">
                      <Save className="h-4 w-4" />
                      Save preferences
                    </Button>
                  </form>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={passwordOpen}
        title="Change Password"
        description="Choose a new password for this administrator account."
        onClose={() => {
          setPasswordOpen(false);
          setPasswordError('');
        }}
      >
        {passwordError && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          >
            {passwordError}
          </p>
        )}
        <form onSubmit={(event) => void changePassword(event)} className="grid gap-4">
          <PasswordField
            label="Current password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
          <PasswordField
            label="New password"
            name="newPassword"
            autoComplete="new-password"
            minLength={12}
            required
            hint="At least 12 characters"
          />
          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={12}
            required
          />
          {mfaEnabled ? (
            <Field
              label="Authenticator code"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPasswordOpen(false);
                setPasswordError('');
              }}
            >
              Cancel
            </Button>
            <Button busy={busy === 'password'}>Update password</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function CheckField({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-slate-200/90 px-3 py-2.5 text-sm dark:border-white/10">
      <input type="checkbox" {...props} />
      {label}
    </label>
  );
}
