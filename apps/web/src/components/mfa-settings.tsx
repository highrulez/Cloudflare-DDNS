import { Copy, Download, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, Card, Field, Loading, useToast } from './ui';
import { safeFormatDate } from '../utils/date';

type MfaStatus = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  recoveryCodesTotal: number;
};

type EnrollState = {
  qrDataUrl: string;
  setupKey: string;
};

export function MfaSettingsCard() {
  const { setUser } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<'idle' | 'password' | 'enroll' | 'recovery' | 'disable' | 'regen'>(
    'idle'
  );
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [showSetupKey, setShowSetupKey] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const reload = async () => {
    setLoading(true);
    try {
      setStatus(await api.mfaStatus());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load MFA status');
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
      setStep('enroll');
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
      setStep('recovery');
      await reload();
      toast('Multi-factor authentication enabled.');
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
      setStep('recovery');
      await reload();
      toast('Recovery codes regenerated.');
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

  if (loading) {
    return (
      <Card className="p-6">
        <Loading label="Loading MFA status" />
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-sky-600 dark:border-slate-700 dark:text-sky-400">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Multi-factor authentication</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Add an authenticator app as an additional security layer for your account.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {step === 'recovery' && recoveryCodes.length > 0 ? (
        <div className="mt-5 grid gap-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.14em]">Save your recovery codes</h3>
          <p className="text-sm text-slate-500">
            Recovery codes can be used if you lose access to your authenticator. Each code can only
            be used once. They will not be shown again.
          </p>
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm dark:border-slate-800 dark:bg-slate-950/50 sm:grid-cols-2">
            {recoveryCodes.map((code) => (
              <div key={code}>{code}</div>
            ))}
          </div>
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
          <Button
            type="button"
            onClick={() => {
              setRecoveryCodes([]);
              setStep('idle');
            }}
          >
            I have saved my codes
          </Button>
        </div>
      ) : step === 'password' ? (
        <form onSubmit={(event) => void startEnroll(event)} className="mt-5 grid gap-4">
          <Field label="Current password" name="password" type="password" required />
          <div className="flex flex-wrap gap-2">
            <Button busy={busy === 'enroll-start'}>Continue</Button>
            <Button type="button" variant="secondary" onClick={() => setStep('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      ) : step === 'enroll' && enroll ? (
        <form onSubmit={(event) => void confirmEnroll(event)} className="mt-5 grid gap-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.14em]">Set up authenticator</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-500">
            <li>Open your authenticator app</li>
            <li>Add a new account</li>
            <li>Scan this QR code</li>
            <li>Enter the 6-digit code to confirm</li>
          </ol>
          <img
            src={enroll.qrDataUrl}
            alt="Authenticator QR code"
            className="mx-auto h-[220px] w-[220px] rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700"
          />
          <button
            type="button"
            className="text-left text-sm font-medium text-sky-600 hover:underline dark:text-sky-400"
            onClick={() => setShowSetupKey((value) => !value)}
          >
            {showSetupKey ? 'Hide setup key' : "Can't scan the QR code? Show setup key"}
          </button>
          {showSetupKey && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-950/50">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="break-all">{enroll.setupKey}</span>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void navigator.clipboard.writeText(enroll.setupKey)}
              >
                <Copy className="h-4 w-4" />
                Copy setup key
              </Button>
            </div>
          )}
          <Field
            label="6-digit confirmation code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button busy={busy === 'enroll-confirm'}>Confirm &amp; enable</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEnroll(null);
                setStep('idle');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : step === 'disable' ? (
        <form onSubmit={(event) => void disable(event)} className="mt-5 grid gap-4">
          <p className="text-sm text-slate-500">
            Disabling MFA requires your current password and a valid authenticator code.
          </p>
          <Field label="Current password" name="password" type="password" required />
          <Field
            label="Authenticator code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button busy={busy === 'disable'}>
              <ShieldOff className="h-4 w-4" />
              Disable MFA
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      ) : step === 'regen' ? (
        <form onSubmit={(event) => void regenerate(event)} className="mt-5 grid gap-4">
          <p className="text-sm text-slate-500">
            Regenerating recovery codes invalidates all previous codes.
          </p>
          <Field label="Current password" name="password" type="password" required />
          <Field
            label="Authenticator code"
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button busy={busy === 'regen'}>Regenerate recovery codes</Button>
            <Button type="button" variant="secondary" onClick={() => setStep('idle')}>
              Cancel
            </Button>
          </div>
        </form>
      ) : status?.enabled ? (
        <div className="mt-5 grid gap-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="font-semibold text-emerald-700 dark:text-emerald-300">● Enabled</p>
            <p className="mt-1 text-emerald-800/80 dark:text-emerald-200/80">Authenticator app</p>
            {status.enabledAt && (
              <p className="mt-1 text-emerald-800/70 dark:text-emerald-200/70">
                Enabled: {safeFormatDate(status.enabledAt)}
              </p>
            )}
            <p className="mt-1 text-emerald-800/70 dark:text-emerald-200/70">
              Recovery codes: {status.recoveryCodesRemaining} of {status.recoveryCodesTotal}{' '}
              remaining
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep('regen')}>
              Regenerate recovery codes
            </Button>
            <Button type="button" variant="danger" onClick={() => setStep('disable')}>
              Disable MFA
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Status: Not enabled
          </p>
          <Button type="button" onClick={() => setStep('password')}>
            Enable MFA
          </Button>
        </div>
      )}
    </Card>
  );
}
