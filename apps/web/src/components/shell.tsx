import {
  Activity,
  ChevronDown,
  Cloud,
  Gauge,
  Globe2,
  LogOut,
  Menu,
  Moon,
  Server,
  Settings,
  Sun,
  Wifi,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, type Dashboard } from '../api';
import { useAuth } from '../auth';
import { cx } from './ui';

const nav = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/records', label: 'DNS Records', icon: Globe2 },
  { to: '/cloudflare', label: 'Cloudflare', icon: Cloud },
  { to: '/history', label: 'Update History', icon: Activity },
  { to: '/system', label: 'System', icon: Server },
  { to: '/settings', label: 'Settings', icon: Settings }
];

function networkGlobalState(status: Dashboard['status'] | undefined) {
  if (status === 'error') {
    return {
      badge: 'Action required',
      detail: 'Action required',
      badgeClass: 'bg-red-500/10 text-red-700 dark:text-red-300',
      dotClass: 'bg-red-500'
    };
  }
  if (status === 'degraded' || status === 'updating' || status === 'disabled') {
    return {
      badge: 'Attention',
      detail: 'Some issues detected',
      badgeClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
      dotClass: 'bg-amber-500'
    };
  }
  if (status === 'healthy') {
    return {
      badge: 'Synchronized',
      detail: 'All systems operational',
      badgeClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      dotClass: 'status-dot-live animate'
    };
  }
  return {
    badge: 'Checking',
    detail: 'Status updating',
    badgeClass: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
    dotClass: 'bg-slate-400'
  };
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(
    () =>
      localStorage.theme === 'dark' ||
      (!('theme' in localStorage) && matchMedia('(prefers-color-scheme: dark)').matches)
  );
  const [summary, setSummary] = useState<Pick<Dashboard, 'status'>>();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.theme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    const load = () =>
      api
        .dashboard()
        .then(({ status }) => setSummary({ status }))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) =>
      !menuRef.current?.contains(event.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const network = networkGlobalState(summary?.status);

  return (
    <div className="min-h-screen bg-console-50 text-slate-950 dark:bg-console-950 dark:text-slate-100">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-[15.5rem] flex-col border-r border-slate-200/80 bg-white transition-transform lg:translate-x-0 dark:border-white/[0.06] dark:bg-console-900',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center gap-3 border-b border-slate-200/80 px-4 dark:border-white/[0.06]">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300">
            <Wifi className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 leading-tight">
            <strong className="block truncate text-[13px] font-semibold tracking-tight">
              Cloudflare DDNS
            </strong>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Manager
            </span>
          </div>
          <button
            className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-white/5"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 p-2.5" aria-label="Primary navigation">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition',
                  isActive
                    ? 'bg-accent/10 text-slate-950 dark:bg-white/[0.06] dark:text-white'
                    : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-100'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'absolute inset-y-1.5 left-0 w-0.5 rounded-full transition',
                      isActive ? 'bg-accent dark:bg-sky-400' : 'bg-transparent'
                    )}
                    aria-hidden
                  />
                  <Icon
                    className={cx(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-accent dark:text-sky-300' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                    )}
                    aria-hidden
                  />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="m-2.5 rounded-lg border border-slate-200/80 px-3 py-2.5 dark:border-white/[0.06]">
          <p className="ops-eyebrow mb-1.5">System</p>
          <p className="flex items-center gap-2 text-[12px] font-medium text-slate-700 dark:text-slate-200">
            <span className="status-dot-live animate" aria-hidden />
            Cloudflare connected
          </p>
        </div>
      </aside>

      {open && (
        <button
          className="fixed inset-0 z-30 bg-console-950/50 lg:hidden"
          aria-label="Close navigation overlay"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="lg:pl-[15.5rem]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200/80 bg-console-50/90 px-3 backdrop-blur-md sm:gap-3 sm:px-5 dark:border-white/[0.06] dark:bg-console-950/90">
          <button
            className="rounded-md p-2 text-slate-600 hover:bg-slate-200/60 lg:hidden dark:text-slate-300 dark:hover:bg-white/5"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden min-w-0 sm:block">
            <div className="flex items-center gap-2">
              <p className="ops-eyebrow">Network</p>
              <span
                className={cx(
                  'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]',
                  network.badgeClass
                )}
              >
                {network.badge}
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400">
              <span className={cx('status-dot', network.dotClass)} aria-hidden />
              {network.detail}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => setDark(!dark)}
              aria-label={dark ? 'Use light theme' : 'Use dark theme'}
              className="rounded-md border border-slate-200/90 p-2 text-slate-600 hover:bg-white dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="relative" ref={menuRef}>
              <button
                className="flex items-center gap-2 rounded-md p-1.5 hover:bg-slate-200/50 dark:hover:bg-white/5"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/20 bg-accent/10 text-[11px] font-bold text-accent dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300">
                  {user?.username?.[0]?.toUpperCase() ?? 'A'}
                </span>
                <span className="hidden max-w-28 truncate text-[13px] font-medium md:block">
                  {user?.username}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              </button>
              {menu && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-panel dark:border-white/10 dark:bg-console-850 dark:shadow-panel-dark"
                >
                  <div className="border-b border-slate-100 px-3 py-2 dark:border-white/[0.06]">
                    <strong className="block truncate text-sm">{user?.username}</strong>
                    <span className="text-[11px] text-slate-500">Signed in</span>
                  </div>
                  <button
                    role="menuitem"
                    onClick={() => void logout()}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-5 sm:py-6 lg:px-8 lg:py-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
