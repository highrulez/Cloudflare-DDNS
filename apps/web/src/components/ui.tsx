import { AlertCircle, CheckCircle2, Copy, Eye, EyeOff, LoaderCircle, Search, X } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react';
import { safeFormatDate } from '../utils/date';

export const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');
export const formatDate = safeFormatDate;

export function Button({
  className,
  variant = 'primary',
  busy,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  busy?: boolean;
}) {
  const variants = {
    primary:
      'bg-accent text-white hover:bg-brand-600 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset] dark:bg-accent-soft dark:hover:bg-accent',
    secondary:
      'border border-slate-300/90 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-console-850 dark:text-slate-200 dark:hover:bg-console-800',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost:
      'text-slate-600 hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-white/[0.05]'
  };
  return (
    <button
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-console-950',
        variants[variant],
        className
      )}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200"
    >
      {label}
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
        className={cx(
          'h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-950 dark:text-white',
          error && 'border-red-500',
          className
        )}
        {...props}
      />
      {(hint || error) && (
        <span
          id={`${id}-help`}
          className={cx(
            'text-xs font-normal',
            error ? 'text-red-600 dark:text-red-400' : 'text-slate-500'
          )}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200"
    >
      {label}
      <select
        id={id}
        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-950 dark:text-white"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cx(
        'ops-panel shadow-panel dark:shadow-panel-dark',
        className
      )}
    >
      {children}
    </section>
  );
}

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  const key = status.toLowerCase();
  const healthy = ['healthy', 'success', 'active', 'enabled', 'synchronized'].includes(key);
  const bad = ['error', 'failed', 'degraded', 'critical'].includes(key);
  const warn = ['warning', 'proxied', 'updating', 'pending'].includes(key);
  const skipped = ['skipped', 'unchanged', 'disabled', 'dns only', 'dns-only'].includes(key);
  const tone = healthy
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : bad
      ? 'bg-red-500/10 text-red-700 dark:text-red-300'
      : warn
        ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
        : skipped
          ? 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
          : 'bg-sky-500/10 text-sky-800 dark:text-sky-300';
  const dot = healthy
    ? 'status-dot-live animate'
    : bad
      ? 'status-dot bg-red-500'
      : warn
        ? 'status-dot bg-amber-500'
        : skipped
          ? 'status-dot bg-slate-400'
          : 'status-dot bg-sky-500';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]',
        tone
      )}
    >
      <span className={dot} aria-hidden />
      {children ?? status}
    </span>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="flex min-h-56 flex-col items-center justify-center gap-3 text-sm text-slate-500"
      role="status"
    >
      <LoaderCircle className="h-7 w-7 animate-spin text-blue-600" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Card className="flex min-h-56 flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertCircle className="h-9 w-9 text-red-500" />
      <h2 className="font-semibold">Something went wrong</h2>
      <p className="max-w-md text-sm text-slate-500">{message}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </Card>
  );
}

export function Empty({
  title,
  message,
  action
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      <Search className="mb-3 h-8 w-8 text-slate-400" />
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-panel dark:border-white/10 dark:bg-console-850 dark:shadow-panel-dark"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            ref={first}
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-slate-100 focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

type Toast = { id: number; message: string; kind: 'success' | 'error' };
const ToastContext = createContext<(message: string, kind?: Toast['kind']) => void>(
  () => undefined
);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now();
    setToasts((items) => [...items, { id, message, kind }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4000);
  };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[60] grid w-[min(24rem,calc(100vw-2rem))] gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'flex items-center gap-3 rounded-xl border bg-white p-4 text-sm font-medium shadow-xl dark:bg-slate-900',
              toast.kind === 'error'
                ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                : 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300'
            )}
          >
            {toast.kind === 'error' ? (
              <AlertCircle className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function PageTitle({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        {eyebrow && <p className="ops-eyebrow mb-1.5 text-accent dark:text-sky-400">{eyebrow}</p>}
        <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl dark:text-slate-50">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Mask a technical value (IP, etc.) with hide + copy — presentation only. Visible by default. */
export function MaskedValue({
  value,
  label,
  empty = '—',
  initiallyVisible = true
}: {
  value?: string | null;
  label: string;
  empty?: string;
  /** When true (default), the value is shown until the user hides it. */
  initiallyVisible?: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  const [copied, setCopied] = useState(false);
  if (!value) {
    return <span className="ops-mono text-slate-400">{empty}</span>;
  }
  const masked =
    value.length <= 8 ? '••••••••' : `${'•'.repeat(Math.min(value.length, 14))}`;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="ops-mono truncate text-slate-800 dark:text-slate-100">
        {visible ? value : masked}
      </span>
      <button
        type="button"
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {copied && (
        <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300">Copied</span>
      )}
    </span>
  );
}
