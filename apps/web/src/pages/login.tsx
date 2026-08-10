import {
  ArrowRight,
  Eye,
  EyeOff,
  Globe2,
  Hexagon,
  LoaderCircle,
  Lock,
  Server,
  ShieldCheck,
  User
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Loading, cx } from '../components/ui';
import { APP_VERSION } from '../version';

type AuthPhase =
  | 'idle'
  | 'verifying'
  | 'authenticating'
  | 'mfa'
  | 'mfa-recovery'
  | 'authenticated';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

export function LoginPage() {
  const { user, loading, login, verifyMfa } = useAuth();
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<AuthPhase>('idle');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const [siteKey, setSiteKey] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const usernameId = useId();
  const passwordId = useId();
  const errorId = useId();
  const mfaCodeId = useId();
  const recoveryId = useId();
  const widgetHostRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>();

  const resetTurnstile = useCallback(() => {
    setTurnstileToken('');
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  const backToSignIn = () => {
    setPhase('idle');
    setError('');
    setMfaCode('');
    setRecoveryCode('');
    resetTurnstile();
  };

  useEffect(() => {
    let active = true;
    fetch('/api/health', { credentials: 'omit' })
      .then((response) => {
        if (active) setOnline(response.ok);
      })
      .catch(() => {
        if (active) setOnline(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .turnstileConfig()
      .then((config) => {
        if (!cancelled) setSiteKey(config.siteKey);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message || 'Security verification is unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!siteKey || !widgetHostRef.current) return;

    const mount = () => {
      if (!widgetHostRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(widgetHostRef.current, {
        sitekey: siteKey,
        theme: 'dark',
        appearance: 'interaction-only',
        action: 'login',
        callback: (token: string) => {
          setTurnstileToken(token);
          setTurnstileReady(true);
          setPhase((current) => (current === 'verifying' ? 'idle' : current));
        },
        'expired-callback': () => {
          setTurnstileToken('');
          setTurnstileReady(false);
        },
        'error-callback': () => {
          setTurnstileToken('');
          setTurnstileReady(false);
          setError('Security verification failed. Please try again.');
        },
        'timeout-callback': () => {
          setTurnstileToken('');
          setTurnstileReady(false);
        }
      });
      setTurnstileReady(true);
    };

    setPhase((current) => (current === 'idle' ? 'verifying' : current));
    if (window.turnstile) {
      mount();
      return () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = undefined;
        }
      };
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (existing) {
      window.onTurnstileLoad = mount;
    } else {
      const script = document.createElement('script');
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = 'true';
      window.onTurnstileLoad = mount;
      document.head.appendChild(script);
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = undefined;
      }
    };
  }, [siteKey]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!turnstileToken) {
      setError('Security verification is still in progress. Please wait.');
      return;
    }
    setPhase('authenticating');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await login(
        String(form.get('username') ?? ''),
        String(form.get('password') ?? ''),
        turnstileToken
      );
      if (result.mfaRequired) {
        setPhase('mfa');
        setMfaCode('');
        return;
      }
      setPhase('authenticated');
    } catch (caught) {
      setPhase('idle');
      setError(caught instanceof Error ? caught.message : 'Sign in failed');
      resetTurnstile();
    }
  };

  const submitMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPhase((current) => (current === 'mfa-recovery' ? 'mfa-recovery' : 'mfa'));
    setError('');
    try {
      if (phase === 'mfa-recovery') {
        await verifyMfa({ recoveryCode: recoveryCode.trim() });
      } else {
        await verifyMfa({ code: mfaCode.replace(/\s+/g, '') });
      }
      setPhase('authenticated');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification failed');
      setMfaCode('');
      setRecoveryCode('');
      if (
        caught instanceof Error &&
        /expired|sign in again|too many failed/i.test(caught.message)
      ) {
        backToSignIn();
      }
    }
  };

  if (loading)
    return (
      <div className="login-shell grid min-h-screen place-items-center">
        <Loading label="Restoring session" />
      </div>
    );
  if (user) return <Navigate to="/" replace />;

  const busy = phase === 'authenticating' || phase === 'authenticated';
  const mfaBusy = phase === 'authenticated';
  const buttonLabel =
    phase === 'authenticating'
      ? 'Authenticating...'
      : phase === 'authenticated'
        ? 'Authenticated'
        : 'Sign In';
  const onMfaStep = phase === 'mfa' || phase === 'mfa-recovery';

  return (
    <div className="login-shell relative min-h-screen overflow-hidden text-slate-100">
      <NetworkBackdrop />

      <div className="relative z-10 flex min-h-screen flex-col">
        <div className="grid flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <section className="relative flex flex-col px-6 pb-8 pt-6 sm:px-10 lg:px-14 lg:pb-10 lg:pt-8">
            <p
              className="inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400"
              aria-live="polite"
            >
              <span
                className={cx(
                  'h-2 w-2 rounded-full',
                  online ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]' : 'bg-rose-400'
                )}
                aria-hidden="true"
              />
              {online ? 'System Online' : 'System Offline'}
            </p>

            <div className="relative mx-auto mt-12 flex w-full max-w-xl flex-1 flex-col justify-center lg:mx-0 lg:mt-0">
              <BrandMark />
              <h1 className="mt-8 text-[clamp(2rem,4.2vw,3.4rem)] font-bold uppercase leading-[1.05] tracking-[0.28em] text-white">
                Cloudflare
              </h1>
              <p className="mt-2 text-[clamp(1.35rem,3vw,2.35rem)] font-bold uppercase leading-[1.1] tracking-[0.22em] text-[#3b82f6]">
                DDNS Manager
              </p>
              <div className="mt-5 h-px w-16 bg-[#3b82f6]" aria-hidden="true" />
              <p className="mt-6 text-base font-medium text-slate-300 sm:text-lg">
                Secure. Reliable. Always Online.
              </p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                Dynamic DNS management for your infrastructure.
              </p>

              <div className="mt-14 hidden gap-8 lg:grid lg:grid-cols-3">
                <TrustItem
                  icon={<ShieldCheck className="h-4 w-4" />}
                  title="Secure Connection"
                  detail="TLS Encrypted"
                />
                <TrustItem
                  icon={<Globe2 className="h-4 w-4" />}
                  title="Self-Hosted"
                  detail="Full Control"
                />
                <TrustItem
                  icon={<Server className="h-4 w-4" />}
                  title="Infrastructure"
                  detail="Always On"
                />
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center px-4 pb-10 pt-2 sm:px-8 lg:px-10 lg:pb-12 lg:pt-8">
            <div className="login-card w-full max-w-[420px] rounded-2xl border border-slate-700/70 bg-[#0b1220]/90 p-7 shadow-[0_0_0_1px_rgba(59,130,246,0.08),0_0_48px_-18px_rgba(59,130,246,0.45)] backdrop-blur-sm sm:p-9">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-slate-600/80 text-[#60a5fa]">
                <Lock className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-center text-xl font-bold uppercase tracking-[0.18em] text-white">
                {onMfaStep
                  ? phase === 'mfa-recovery'
                    ? 'Recovery Access'
                    : 'Security Verification'
                  : 'Welcome Back'}
              </h2>
              <div className="mx-auto mt-4 h-px w-10 bg-[#3b82f6]" aria-hidden="true" />
              <p className="mt-4 text-center text-sm text-slate-400">
                {onMfaStep
                  ? phase === 'mfa-recovery'
                    ? 'Enter one of your saved recovery codes.'
                    : 'Enter the 6-digit code from your authenticator app.'
                  : 'Sign in to access your dashboard'}
              </p>

              {error && (
                <div
                  id={errorId}
                  role="alert"
                  className="mt-6 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
                >
                  <strong className="block font-semibold text-rose-100">
                    Authentication failed
                  </strong>
                  <span className="mt-1 block text-rose-200/90">{error}</span>
                </div>
              )}

              {onMfaStep ? (
                <form
                  onSubmit={(event) => void submitMfa(event)}
                  className="mt-7 grid gap-5"
                  aria-describedby={error ? errorId : undefined}
                >
                  {phase === 'mfa' ? (
                    <label htmlFor={mfaCodeId} className="grid gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Authenticator code
                      </span>
                      <input
                        id={mfaCodeId}
                        name="mfaCode"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        disabled={mfaBusy}
                        value={mfaCode}
                        onChange={(event) =>
                          setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        }
                        placeholder="••••••"
                        className="login-input h-12 w-full rounded-lg border border-slate-700 bg-[#070d18] px-3 text-center font-mono text-lg tracking-[0.35em] text-slate-100 outline-none transition placeholder:tracking-[0.35em] placeholder:text-slate-600 focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 disabled:opacity-60"
                      />
                    </label>
                  ) : (
                    <label htmlFor={recoveryId} className="grid gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Recovery code
                      </span>
                      <input
                        id={recoveryId}
                        name="recoveryCode"
                        autoComplete="off"
                        required
                        disabled={mfaBusy}
                        value={recoveryCode}
                        onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
                        placeholder="XXXX-XXXX-XXXX"
                        className="login-input h-12 w-full rounded-lg border border-slate-700 bg-[#070d18] px-3 font-mono text-sm tracking-[0.12em] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 disabled:opacity-60"
                      />
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={mfaBusy || (phase === 'mfa' ? mfaCode.length !== 6 : !recoveryCode)}
                    className="login-submit mt-1 inline-flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-gradient-to-r from-[#2563eb] to-[#3b82f6] px-5 text-sm font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_30px_-16px_rgba(37,99,235,0.9)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1220] disabled:cursor-wait disabled:opacity-80"
                  >
                    {phase === 'mfa-recovery' ? 'Verify Recovery Code' : 'Verify'}
                  </button>

                  <div className="grid gap-2 text-center">
                    {phase === 'mfa' ? (
                      <button
                        type="button"
                        className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400 transition hover:text-[#60a5fa]"
                        onClick={() => {
                          setPhase('mfa-recovery');
                          setError('');
                          setRecoveryCode('');
                        }}
                      >
                        Use a recovery code
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400 transition hover:text-[#60a5fa]"
                        onClick={() => {
                          setPhase('mfa');
                          setError('');
                          setMfaCode('');
                        }}
                      >
                        Use authenticator code
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500 transition hover:text-slate-300"
                      onClick={backToSignIn}
                    >
                      ← Back to sign in
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={(event) => void submit(event)}
                  className="mt-7 grid gap-5"
                  aria-describedby={error ? errorId : undefined}
                >
                  <label htmlFor={usernameId} className="grid gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Username
                    </span>
                    <span className="relative block">
                      <User
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                        aria-hidden="true"
                      />
                      <input
                        id={usernameId}
                        name="username"
                        type="text"
                        autoComplete="username"
                        required
                        disabled={busy}
                        placeholder="Enter your username"
                        className="login-input h-12 w-full rounded-lg border border-slate-700 bg-[#070d18] py-2 pl-10 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 disabled:opacity-60"
                      />
                    </span>
                  </label>

                  <label htmlFor={passwordId} className="grid gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Password
                    </span>
                    <span className="relative block">
                      <Lock
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                        aria-hidden="true"
                      />
                      <input
                        id={passwordId}
                        name="password"
                        type={show ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        disabled={busy}
                        placeholder="Enter your password"
                        className="login-input h-12 w-full rounded-lg border border-slate-700 bg-[#070d18] py-2 pl-10 pr-12 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        aria-label={show ? 'Hide password' : 'Show password'}
                        onClick={() => setShow(!show)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 transition hover:bg-white/5 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                      >
                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>

                  <div className="grid gap-2">
                    {(phase === 'verifying' || (!turnstileToken && turnstileReady)) && (
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                        Verifying secure connection...
                      </p>
                    )}
                    <div ref={widgetHostRef} className="min-h-[65px]" />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || !turnstileToken}
                    className="login-submit mt-1 inline-flex h-12 w-full items-center justify-center gap-3 rounded-lg bg-gradient-to-r from-[#2563eb] to-[#3b82f6] px-5 text-sm font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_30px_-16px_rgba(37,99,235,0.9)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1220] active:translate-y-px active:brightness-95 disabled:cursor-wait disabled:opacity-80"
                  >
                    {phase === 'authenticating' && (
                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    <span>{buttonLabel}</span>
                    {phase === 'idle' && (
                      <ArrowRight className="ml-auto h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>

        <footer className="relative z-10 border-t border-white/5 px-6 py-4 text-center sm:px-10">
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">
            <span>
              Built by <span className="font-semibold text-[#3b82f6]">Highrulez</span>
            </span>
            <span className="hidden text-slate-700 sm:inline" aria-hidden="true">
              |
            </span>
            <span>v{APP_VERSION}</span>
            <span className="hidden text-slate-700 sm:inline" aria-hidden="true">
              |
            </span>
            <span>Self-Hosted</span>
            <span className="hidden text-slate-700 sm:inline" aria-hidden="true">
              |
            </span>
            <span>Secure Node</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="relative grid h-16 w-16 place-items-center text-[#3b82f6]" aria-hidden="true">
      <Hexagon className="absolute h-16 w-16 stroke-[1.25]" />
      <svg viewBox="0 0 40 40" className="relative h-7 w-7" fill="none">
        <circle cx="20" cy="10" r="2.2" fill="currentColor" />
        <circle cx="10" cy="28" r="2.2" fill="currentColor" />
        <circle cx="30" cy="28" r="2.2" fill="currentColor" />
        <path
          d="M20 12.2 11.7 26.4M20 12.2 28.3 26.4M12.4 28h15.2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function TrustItem({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 text-slate-400">
      <span className="mt-0.5 text-slate-500">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
          {title}
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function NetworkBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="login-grid absolute inset-0 opacity-[0.18]" />
      <div className="login-glow absolute -left-24 top-10 h-[28rem] w-[28rem] rounded-full bg-[#1d4ed8]/10 blur-3xl" />
      <div className="login-glow absolute bottom-0 right-0 h-[22rem] w-[22rem] rounded-full bg-[#0ea5e9]/8 blur-3xl" />
      <svg
        className="login-network absolute inset-0 hidden h-full w-full opacity-40 lg:block"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <g stroke="#3b82f6" strokeOpacity="0.22" strokeWidth="1" fill="none">
          <path d="M120 180 L260 240 L210 360 L90 320 Z" />
          <path d="M260 240 L420 160 L510 280 L360 340 Z" />
          <path d="M510 280 L680 220 L760 360 L600 420 Z" />
          <path d="M210 360 L360 340 L420 520 L250 500 Z" />
          <path d="M600 420 L760 360 L820 540 L640 560 Z" />
          <path d="M90 520 L250 500 L300 660 L120 680 Z" />
        </g>
        <g fill="#60a5fa">
          <circle className="login-node" cx="120" cy="180" r="2.5" />
          <circle className="login-node login-node-delay" cx="260" cy="240" r="2.5" />
          <circle className="login-node" cx="420" cy="160" r="2.2" />
          <circle className="login-node login-node-delay" cx="510" cy="280" r="2.8" />
          <circle className="login-node" cx="680" cy="220" r="2.2" />
          <circle className="login-node login-node-delay" cx="760" cy="360" r="2.5" />
          <circle className="login-node" cx="360" cy="340" r="2.2" />
          <circle className="login-node login-node-delay" cx="600" cy="420" r="2.5" />
          <circle className="login-node" cx="210" cy="360" r="2.2" />
          <circle className="login-node login-node-delay" cx="250" cy="500" r="2.2" />
        </g>
        <g className="login-radar" transform="translate(920 180)">
          <circle r="110" fill="none" stroke="#3b82f6" strokeOpacity="0.14" strokeWidth="1" />
          <circle
            r="78"
            fill="none"
            stroke="#3b82f6"
            strokeOpacity="0.16"
            strokeWidth="1"
            strokeDasharray="4 8"
          />
          <circle r="46" fill="none" stroke="#60a5fa" strokeOpacity="0.2" strokeWidth="1" />
          <path
            className="login-radar-sweep"
            d="M0 0 L46 0 A46 46 0 0 1 0 46 Z"
            fill="#3b82f6"
            fillOpacity="0.08"
          />
        </g>
      </svg>
    </div>
  );
}
