import { AlertCircle, CheckCircle2, LoaderCircle, Search, X } from 'lucide-react';
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react';

export const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return <button className={cx('button', `button--${variant}`, className)} {...props} />;
}

export function Input({
  label,
  id,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const inputId = id ?? `input-${label.toLowerCase().replace(/\W/g, '-')}`;
  return (
    <label className="field" htmlFor={inputId}>
      <span>{label}</span>
      <input id={inputId} {...props} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function PageHeader({
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
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('card', className)}>{children}</section>;
}

export function Status({ value }: { value?: string | undefined }) {
  const kind =
    value === 'connected' || value === 'success' || value === 'active'
      ? 'good'
      : value === 'pending'
        ? 'warn'
        : value === 'error'
          ? 'bad'
          : 'muted';
  return (
    <span className={cx('status', `status--${kind}`)}>
      <i />
      {value ?? 'unknown'}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadState({
  error,
  empty,
  children,
  onRetry
}: {
  error?: string;
  empty?: boolean;
  children: ReactNode;
  onRetry?: () => void;
}) {
  if (error)
    return (
      <EmptyState
        icon={<AlertCircle />}
        title="Unable to load data"
        description={error}
        action={
          onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      />
    );
  if (empty)
    return (
      <EmptyState
        title="Nothing here yet"
        description="Data will appear here once it is available."
      />
    );
  return <>{children}</>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function SearchBox(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="search">
      <Search size={16} aria-hidden />
      <span className="sr-only">Search</span>
      <input aria-label="Search" {...props} />
    </label>
  );
}

export function Modal({
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
  useEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog">
          <X />
        </button>
        <h2 id="modal-title">{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </div>
    </div>
  );
}

export function Toast({
  message,
  kind = 'success',
  onDone
}: {
  message: string;
  kind?: 'success' | 'error' | undefined;
  onDone: () => void;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setVisible(false);
      onDone();
    }, 3500);
    return () => clearTimeout(id);
  }, [onDone]);
  return visible ? (
    <div className={cx('toast', `toast--${kind}`)} role="status">
      {kind === 'success' ? <CheckCircle2 /> : <AlertCircle />}
      {message}
    </div>
  ) : null;
}

export const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value)
      )
    : 'Never';
