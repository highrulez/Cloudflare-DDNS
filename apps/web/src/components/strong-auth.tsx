import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react';
import { api, ApiError } from '../api';
import { Button, Dialog, Field, PasswordField } from './ui';

type StrongAuthContextValue = {
  /** Run an API action; on STRONG_AUTH_REQUIRED open reauth modal and retry once. */
  withStrongAuth: <T>(action: () => Promise<T>) => Promise<T>;
  mfaEnabled: boolean | null;
  setMfaEnabled: (value: boolean | null) => void;
};

const StrongAuthContext = createContext<StrongAuthContextValue | null>(null);

export function StrongAuthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const resolverRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const close = useCallback((error?: Error) => {
    setOpen(false);
    setBusy(false);
    setError('');
    const pending = resolverRef.current;
    resolverRef.current = null;
    if (!pending) return;
    if (error) pending.reject(error);
    else pending.resolve();
  }, []);

  const requestReauth = useCallback(async () => {
    if (mfaEnabled === null) {
      try {
        const status = await api.mfaStatus();
        setMfaEnabled(status.enabled);
      } catch {
        setMfaEnabled(false);
      }
    }
    await new Promise<void>((resolve, reject) => {
      resolverRef.current = { resolve, reject };
      setError('');
      setOpen(true);
    });
  }, [mfaEnabled]);

  const withStrongAuth = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.code !== 'STRONG_AUTH_REQUIRED') throw caught;
        await requestReauth();
        return await action();
      }
    },
    [requestReauth]
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const password = String(form.get('password') ?? '');
      const code = String(form.get('code') ?? '').trim();
      await api.reauth({
        password,
        ...(code ? { code } : {})
      });
      close();
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Verification failed');
    }
  };

  const value = useMemo(
    () => ({ withStrongAuth, mfaEnabled, setMfaEnabled }),
    [withStrongAuth, mfaEnabled]
  );

  return (
    <StrongAuthContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        title="Security Verification"
        description="Confirm your identity to continue."
        onClose={() => close(new Error('Security verification cancelled'))}
      >
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {error}
            </p>
          )}
          <PasswordField label="Password" name="password" autoComplete="current-password" required />
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(new Error('Security verification cancelled'))}
            >
              Cancel
            </Button>
            <Button busy={busy}>Verify</Button>
          </div>
        </form>
      </Dialog>
    </StrongAuthContext.Provider>
  );
}

export function useStrongAuth() {
  const context = useContext(StrongAuthContext);
  if (!context) throw new Error('useStrongAuth must be used within StrongAuthProvider');
  return context;
}
