import {
  Activity,
  Bell,
  Box,
  ChevronsLeft,
  ChevronsRight,
  Cloud,
  Container,
  Gauge,
  Globe2,
  KeyRound,
  LogOut,
  Menu,
  Network,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { cx } from './ui';

const groups = [
  { label: '', links: [{ to: '/', label: 'Dashboard', icon: Gauge }] },
  {
    label: 'DNS',
    links: [
      { to: '/dns/providers', label: 'Providers', icon: Cloud },
      { to: '/dns/domains', label: 'Domains', icon: Globe2 },
      { to: '/dns/records', label: 'Records', icon: Network },
      { to: '/dns/ddns', label: 'DDNS', icon: SlidersHorizontal },
      { to: '/dns/activity', label: 'Activity', icon: Activity }
    ]
  },
  {
    label: 'Infrastructure',
    links: [
      { to: '/infrastructure/docker', label: 'Docker', icon: Container },
      { to: '/infrastructure/system', label: 'System', icon: Box },
      { to: '/infrastructure/ssl', label: 'SSL', icon: ShieldCheck }
    ]
  },
  {
    label: '',
    links: [
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/settings', label: 'Settings', icon: Settings }
    ]
  }
];

function Navigation({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary navigation">
      {groups.map((group, index) => (
        <div className="nav-group" key={`${group.label}-${index}`}>
          {group.label && <div className="nav-label">{group.label}</div>}
          {group.links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              className={({ isActive }) => cx('nav-link', isActive && 'active')}
            >
              <Icon aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { user, logout } = useAuth();
  return (
    <div className={cx('shell', collapsed && 'shell--collapsed')}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <KeyRound />
          </div>
          <div>
            <strong>Infrastructure</strong>
            <span>HUB</span>
          </div>
        </div>
        <Navigation collapsed={collapsed} />
        <div className="sidebar-bottom">
          <div className="user-chip">
            <div className="avatar">
              {(user?.name ?? user?.email ?? 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{user?.name ?? 'Administrator'}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
          <button className="nav-link" onClick={() => void logout()} title="Sign out">
            <LogOut />
            <span>Sign out</span>
          </button>
          <button
            className="collapse-button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            <span>Collapse</span>
          </button>
        </div>
      </aside>
      <header className="mobile-header">
        <button
          className="icon-button"
          onClick={() => setDrawer(true)}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <div className="brand">
          <div className="brand-mark">
            <KeyRound />
          </div>
          <strong>Infrastructure Hub</strong>
        </div>
      </header>
      {drawer && (
        <div
          className="drawer-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}
        >
          <aside className="drawer">
            <div className="drawer-head">
              <div className="brand">
                <div className="brand-mark">
                  <KeyRound />
                </div>
                <strong>Infrastructure Hub</strong>
              </div>
              <button
                className="icon-button"
                onClick={() => setDrawer(false)}
                aria-label="Close navigation"
              >
                <X />
              </button>
            </div>
            <Navigation collapsed={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
