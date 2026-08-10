import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useStrongAuth } from './strong-auth';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  PasswordField,
  cx,
  useToast
} from './ui';
import { safeFormatDate, safeOperationalTimestamp } from '../utils/date';
import {
  accountSecurityStatus,
  formatRecoverySummary,
  mfaBadge,
  type MfaStatusSnapshot
} from '../pages/settings-helpers';

export type SessionRow = {
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  stronglyAuthenticated: boolean;
};

type EnrollState = {
  qrDataUrl: string;
  setupKey: string;
};

type EnrollStep = 'password' | 'scan' | 'verify' | 'recovery';

export function SecuritySettingsPanel({
  onSessionsChange,
  onPasswordClick
}: {
  onSessionsChange?: (sessions: SessionRow[]) => void;
  onPasswordClick: () => void;
}) {
  const { setUser } = useAuth();
  const { setMfaEnabled } = useStrongAuth();
  const toast = useToast();
  const [status, setStatus] = useState<MfaStatusSnapshot | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [turnstileActive, setTurnstileActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<EnrollStep>('password');
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [showSetupKey, setShowSetupKey] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [mfa, sessionList, turnstile] = await Promise.all([
        api.mfaStatus(),
        api.listSessions().catch(() => ({ items: [] as SessionRow[] })),
        api.turnstileConfig().then(() => true).catch(() => false)
      ]);
      setStatus(mfa);
      setMfaEnabled(mfa.enabled);
      setSessions(sessionList.items);
      onSessionsChange?.(sessionList.items);
      setTurnstileActive(turnstile);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load security status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const startEnroll = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('enroll-start');
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const result = await api.mfaEnrollStart(String(form.get('password') ?? ''));
      setEnroll({ qrDataUrl: result.qrDataUrl, setupKey: result.setupKey });
      setShowSetupKey(false);
      setEnrollStep('scan');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start MFA enrollment');
    } finally {
      setBusy('');
    }
  };

  const confirmEnroll = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('enroll-confirm');
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const result = await api.mfaEnrollConfirm(String(form.get('code') ?? ''));
      setRecoveryCodes(result.recoveryCodes);
      setEnroll(null);
      setEnrollStep('recovery');
      await reload();
      toast('MFA enabled');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not confirm MFA');
    } finally {
      setBusy('');
    }
  };

  const regenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('regen');
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const result = await api.mfaRegenerateRecovery({
        password: String(form.get('password') ?? ''),
        code: String(form.get('code') ?? '')
      });
      setRecoveryCodes(result.recoveryCodes);
      setRegenOpen(false);
      setEnrollOpen(true);
      setEnrollStep('recovery');
      await reload();
      toast('Recovery codes regenerated');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not regenerate recovery codes');
    } finally {
      setBusy('');
    }
  };

  const disable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('disable');
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      await api.mfaDisable({
        password: String(form.get('password') ?? ''),
        code: String(form.get('code') ?? '')
      });
      setUser(null);
      toast('MFA disabled. Sign in again.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not disable MFA');
      setBusy('');
    }
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    toast('Recovery codes copied.');
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [
        'Cloudflare DDNS Manager recovery codes\n',
        'Store these securely. Each code can be used once.\n\n',
        recoveryCodes.join('\n'),
        '\n'
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ddns-manager-recovery-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const closeEnrollment = () => {
    if (enrollStep === 'recovery' && recoveryCodes.length > 0) return;
    setEnrollOpen(false);
    setEnroll(null);
    setEnrollStep('password');
    setShowSetupKey(false);
    setError('');
  };

  const finishRecovery = () => {
    setRecoveryCodes([]);
    setEnrollOpen(false);
    setEnrollStep('password');
    setError('');
  };

  const overview = accountSecurityStatus(status?.enabled ?? null);
  const mfa = mfaBadge(status?.enabled ?? null);

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <p className="ops-eyebrow">Security overview</p>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading security status…</p>
        ) : error && !status ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button variant="secondary" onClick={() => void reload()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-0">
            <OverviewRow
              label="Multi-factor authentication"
              badge={<Badge status={mfa.status}>{mfa.label}</Badge>}
            />
            <OverviewRow
              label="Password protection"
              badge={<Badge status="active">Active</Badge>}
            />
            <OverviewRow
              label="Turnstile protection"
              badge={
                turnstileActive ? (
                  <Badge status="active">Active</Badge>
                ) : (
                  <Badge status="disabled">Not available</Badge>
                )
              }
            />
            <OverviewRow
              label="Strong authentication"
              badge={<Badge status="active">Active</Badge>}
            />
            <OverviewRow label="Active sessions" value={String(sessions.length)} />
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-[13px] dark:border-white/[0.04]">
              <span
                className={cx(
                  'status-dot',
                  overview.tone === 'active'
                    ? 'status-dot-live animate'
                    : overview.tone === 'attention'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                )}
                aria-hidden
              />
              <span className="font-medium text-slate-800 dark:text-slate-100">{overview.label}</span>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <p className="ops-eyebrow">Multi-factor authentication</p>
        <div className="mt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                Authenticator app
              </p>
              <p className="mt-1 text-[12px] text-slate-500">
                Protect sensitive actions with a time-based one-time password.
              </p>
            </div>
            <Badge status={status?.enabled ? 'enabled' : 'warning'}>
              {status?.enabled ? 'Enabled' : 'Not configured'}
            </Badge>
          </div>

          {status?.enabled ? (
            <div className="mt-4 space-y-3">
              <InfoLine label="Enabled" value={formatStamp(status.enabledAt)} />
              <InfoLine label="Recovery codes" value={formatRecoverySummary(status)} />
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="secondary" onClick={() => setRegenOpen(true)}>
                  Regenerate recovery codes
                </Button>
                <Button variant="danger" onClick={() => setDisableOpen(true)}>
                  <ShieldOff className="h-4 w-4" />
                  Disable MFA
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-[12px] text-slate-500">
                Works with standard TOTP authenticator applications.
              </p>
              <Button
                onClick={() => {
                  setEnrollOpen(true);
                  setEnrollStep('password');
                  setError('');
                }}
              >
                <ShieldCheck className="h-4 w-4" />
                Set up MFA
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <p className="ops-eyebrow">Password</p>
        <p className="mt-2 text-[13px] text-slate-500">
          Change the password used to access this manager.
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={onPasswordClick}>
            Change Password
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          Minimum 12 characters. Authenticator code required when MFA is enabled.
        </p>
      </Card>

      {status?.enabled && (
        <Card className="border-red-500/20 p-5 dark:border-red-500/20">
          <p className="ops-eyebrow text-red-600 dark:text-red-400">Danger zone</p>
          <p className="mt-2 text-[13px] text-slate-500">
            Disabling multi-factor authentication reduces account protection.
          </p>
          <div className="mt-4">
            <Button variant="danger" onClick={() => setDisableOpen(true)}>
              Disable multi-factor authentication
            </Button>
          </div>
        </Card>
      )}

      <Dialog
        open={enrollOpen}
        title={
          enrollStep === 'recovery'
            ? 'Recovery Codes'
            : enrollStep === 'verify'
              ? 'Verify Authenticator'
              : enrollStep === 'scan'
                ? 'Set Up MFA'
                : 'Set Up MFA'
        }
        description={
          enrollStep === 'recovery'
            ? 'Save your recovery codes'
            : enrollStep === 'verify'
              ? 'Enter the 6-digit code generated by your authenticator.'
              : enrollStep === 'scan'
                ? 'Use your authenticator application to scan this QR code.'
                : 'Confirm your password to begin enrollment.'
        }
        onClose={closeEnrollment}
      >
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
          >
            {error}
          </p>
        )}

        {enrollStep === 'scan' && (
          <p className="mb-4 ops-mono text-[11px] text-slate-500">Step 1 of 3 — Scan</p>
        )}
        {enrollStep === 'verify' && (
          <p className="mb-4 ops-mono text-[11px] text-slate-500">Step 2 of 3 — Verify</p>
        )}
        {enrollStep === 'recovery' && (
          <p className="mb-4 ops-mono text-[11px] text-slate-500">Step 3 of 3 — Recovery codes</p>
        )}

        {enrollStep === 'password' && (
          <form onSubmit={(event) => void startEnroll(event)} className="grid gap-4">
            <PasswordField label="Current password" name="password" autoComplete="current-password" required />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeEnrollment}>
                Cancel
              </Button>
              <Button busy={busy === 'enroll-start'}>Continue</Button>
            </div>
          </form>
        )}

        {enrollStep === 'scan' && enroll && (
          <div className="grid gap-4">
            <p className="text-sm text-slate-500">Scan QR code</p>
            <img
              src={enroll.qrDataUrl}
              alt="Authenticator QR code"
              className="mx-auto h-[200px] w-[200px] rounded-xl border border-slate-200 bg-white p-2 dark:border-white/10"
            />
            <button
              type="button"
              className="text-left text-sm font-medium text-accent hover:underline dark:text-sky-300"
              onClick={() => setShowSetupKey((value) => !value)}
            >
              {showSetupKey ? 'Hide setup key' : "Can't scan the QR code? Show setup key"}
            </button>
            {showSetupKey && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-console-950/60">
                <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="ops-mono min-w-0 flex-1 break-all text-[12px]">{enroll.setupKey}</span>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-8 px-2"
                  onClick={() => void navigator.clipboard.writeText(enroll.setupKey)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeEnrollment}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setEnrollStep('verify')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {enrollStep === 'verify' && (
          <form onSubmit={(event) => void confirmEnroll(event)} className="grid gap-4">
            <Field
              label="Authenticator code"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEnrollStep('scan')}>
                Back
              </Button>
              <Button busy={busy === 'enroll-confirm'}>Verify</Button>
            </div>
          </form>
        )}

        {enrollStep === 'recovery' && recoveryCodes.length > 0 && (
          <div className="grid gap-4">
            <p className="text-sm text-slate-500">
              Each code can be used once if you lose access to your authenticator.
            </p>
            <div
              className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm dark:border-white/10 dark:bg-console-950/60 sm:grid-cols-2"
              role="list"
              aria-label="Recovery codes"
            >
              {recoveryCodes.map((code) => (
                <div key={code} role="listitem" className="ops-mono text-[12px]">
                  {code}
                </div>
              ))}
            </div>
            <p className="text-[12px] font-medium text-amber-700 dark:text-amber-300" role="status">
              These codes will not be shown again.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void copyCodes()}>
                <Copy className="h-4 w-4" />
                Copy all
              </Button>
              <Button type="button" variant="secondary" onClick={downloadCodes}>
                <Download className="h-4 w-4" />
                Download .txt
              </Button>
            </div>
            <Button type="button" onClick={finishRecovery}>
              I have saved my codes
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        open={disableOpen}
        title="Disable MFA"
        description="Disabling MFA requires your current password and a valid authenticator code."
        onClose={() => {
          setDisableOpen(false);
          setError('');
        }}
      >
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        )}
        <form onSubmit={(event) => void disable(event)} className="grid gap-4">
          <PasswordField label="Current password" name="password" required />
          <Field
            label="Authenticator code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy === 'disable'}>
              Disable MFA
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={regenOpen}
        title="Regenerate Recovery Codes"
        description="Regenerating recovery codes invalidates all previous codes."
        onClose={() => {
          setRegenOpen(false);
          setError('');
        }}
      >
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        )}
        <form onSubmit={(event) => void regenerate(event)} className="grid gap-4">
          <PasswordField label="Current password" name="password" required />
          <Field
            label="Authenticator code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRegenOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy === 'regen'}>Regenerate</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function SessionsSettingsPanel() {
  const { withStrongAuth } = useStrongAuth();
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const result = await api.listSessions();
      setSessions(result.items);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load active sessions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const revokeOthers = async () => {
    setBusy(true);
    try {
      await withStrongAuth(() => api.revokeOtherSessions());
      toast('Other sessions signed out.');
      await reload();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not sign out other sessions', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <p className="ops-eyebrow">Active sessions</p>
      <p className="mt-2 text-[13px] text-slate-500">
        Devices currently signed in to your account.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading sessions…</p>
      ) : error ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <Button variant="secondary" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No session details available.</p>
      ) : (
        <div className="mt-4 divide-y divide-slate-100 dark:divide-white/[0.04]">
          {sessions.map((session, index) => (
            <div key={`${session.createdAt}-${index}`} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {session.current ? 'Current session' : 'Other session'}
                </p>
                {session.current && <Badge status="active">This device</Badge>}
              </div>
              <p className="mt-1 text-[12px] text-slate-500">
                Signed in {formatStamp(session.createdAt)}
              </p>
              <p className="text-[12px] text-slate-500">
                Last activity {formatStamp(session.lastSeenAt)}
              </p>
              {session.stronglyAuthenticated && (
                <p className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300">
                  Strong verification active
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {sessions.some((session) => !session.current) && (
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/[0.04]">
          <Button variant="secondary" busy={busy} onClick={() => void revokeOthers()}>
            Sign out other sessions
          </Button>
        </div>
      )}
    </Card>
  );
}

/** @deprecated Prefer SecuritySettingsPanel — kept for import compatibility during redesign. */
export function MfaSettingsCard() {
  return (
    <SecuritySettingsPanel
      onPasswordClick={() => undefined}
    />
  );
}

function OverviewRow({
  label,
  badge,
  value
}: {
  label: string;
  badge?: ReactNode;
  value?: string;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 border-t border-slate-100 py-2 first:border-t-0 first:pt-0 dark:border-white/[0.04]">
      <span className="text-[13px] text-slate-600 dark:text-slate-300">{label}</span>
      {badge ?? <span className="ops-mono text-[13px] font-medium">{value}</span>}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

function formatStamp(value: string | null | undefined) {
  const stamp = safeOperationalTimestamp(value);
  if (!stamp) return safeFormatDate(value);
  return stamp.absolute;
}
