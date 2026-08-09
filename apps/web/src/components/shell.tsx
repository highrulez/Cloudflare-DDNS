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
import { Badge, cx } from './ui';

const nav = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/records', label: 'DNS Records', icon: Globe2 },
  { to: '/cloudflare', label: 'Cloudflare', icon: Cloud },
  { to: '/history', label: 'Update History', icon: Activity },
  { to: '/system', label: 'System', icon: Server },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export function AppShell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(
    () =>
      localStorage.theme === 'dark' ||
      (!('theme' in localStorage) && matchMedia('(prefers-color-scheme: dark)').matches)
  );
  const [summary, setSummary] = useState<Pick<Dashboard, 'currentIp' | 'status'>>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    const load = () =>
      api
        .dashboard()
        .then(({ currentIp, status }) => setSummary({ currentIp, status }))
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-slate-950 text-white transition-transform lg:translate-x-0 dark:border-slate-800',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-500">
            <Wifi className="h-5 w-5" />
          </div>
          <div>
            <strong className="block text-sm">Cloudflare DDNS</strong>
            <span className="text-xs text-slate-400">Manager</span>
          </div>
          <button
            className="ml-auto rounded-lg p-2 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-1 p-3" aria-label="Primary navigation">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                )
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-3 bottom-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
          <span className="mb-1 block font-semibold text-slate-200">Service status</span>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            API connected
          </span>
        </div>
      </aside>
      {open && (
        <button
          className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
          aria-label="Close navigation overlay"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-6 dark:border-slate-800 dark:bg-slate-950/90">
          <button
            className="rounded-lg p-2 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <div className="text-right">
              <span className="block font-mono text-sm font-semibold">
                {summary?.currentIp ?? 'Detecting IP…'}
              </span>
              <span className="text-xs text-slate-500">Current public IP</span>
            </div>
            <Badge status={summary?.status ?? 'updating'} />
          </div>
          <button
            onClick={() => setDark(!dark)}
            aria-label={dark ? 'Use light theme' : 'Use dark theme'}
            className="rounded-lg border border-slate-200 p-2 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {user?.username?.[0]?.toUpperCase() ?? 'A'}
              </span>
              <span className="hidden max-w-32 truncate text-sm font-medium md:block">
                {user?.username}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {menu && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                  <strong className="block truncate text-sm">{user?.username}</strong>
                </div>
                <button
                  role="menuitem"
                  onClick={() => void logout()}
                  className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
