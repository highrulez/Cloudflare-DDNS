import {
  Activity as ActivityIcon,
  ArrowRight,
  Check,
  Cloud,
  CloudCog,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  LockKeyhole,
  Network,
  Plus,
  RefreshCw,
  SearchX,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Wifi,
  Zap
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  api,
  type Activity,
  type Dashboard,
  type DnsRecord,
  type Domain,
  type Provider
} from './api';
import { useAuth } from './auth';
import {
  Button,
  Card,
  EmptyState,
  Input,
  LoadState,
  Modal,
  PageHeader,
  SearchBox,
  Spinner,
  Status,
  Toast,
  cx,
  formatDate
} from './ui';

function useApi<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    load()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(refresh, [refresh]);
  return { data, setData, error, loading, refresh };
}

export function LoginPage() {
  const { user, restoring, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (restoring)
    return (
      <div className="auth-page">
        <Spinner label="Restoring your session" />
      </div>
    );
  if (user)
    return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;
  return (
    <div className="auth-page">
      <div className="auth-orb" />
      <Card className="login-card">
        <div className="login-brand">
          <div className="brand-mark brand-mark--large">
            <KeyRound />
          </div>
          <div>
            <span>INFRASTRUCTURE</span>
            <strong>HUB</strong>
          </div>
        </div>
        <div className="login-copy">
          <div className="eyebrow">
            <span className="pulse" /> SECURE OPERATIONS CONSOLE
          </div>
          <h1>Welcome back</h1>
          <p>Sign in to monitor and manage your infrastructure.</p>
        </div>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="form-stack"
        >
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <label className="field" htmlFor="password">
            <span>Password</span>
            <div className="input-action">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? (
              <>
                <RefreshCw className="spin" /> Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight />
              </>
            )}
          </Button>
        </form>
        <div className="security-note">
          <ShieldCheck /> Protected by encrypted, secure session authentication
        </div>
      </Card>
    </div>
  );
}

const dashboardLoad = () => api.dashboard();
export function DashboardPage() {
  const { data, loading, error, refresh } = useApi<Dashboard>(dashboardLoad);
  const stats = [
    { label: 'Current public IP', value: data?.publicIp ?? '—', icon: Wifi, tone: 'cyan' },
    {
      label: 'Connected providers',
      value: data?.connectedProviders ?? 0,
      icon: Cloud,
      tone: 'blue'
    },
    { label: 'Managed domains', value: data?.managedDomains ?? 0, icon: Globe2, tone: 'purple' },
    { label: 'Managed records', value: data?.managedRecords ?? 0, icon: Network, tone: 'green' }
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="A live view of your DNS and infrastructure operations."
        actions={
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {loading ? (
        <Spinner label="Loading your infrastructure" />
      ) : (
        <LoadState error={error} onRetry={refresh}>
          <div className="stats-grid">
            {stats.map(({ label, value, icon: Icon, tone }) => (
              <Card className="stat-card" key={label}>
                <div className={cx('stat-icon', `tone-${tone}`)}>
                  <Icon />
                </div>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              </Card>
            ))}
          </div>
          <div className="dashboard-grid">
            <Card>
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Synchronization</span>
                  <h2>DNS health</h2>
                </div>
                <div className="health-ring">
                  <Check />
                </div>
              </div>
              <div className="detail-list">
                <div>
                  <span>Last successful sync</span>
                  <strong>{formatDate(data?.lastSyncAt)}</strong>
                </div>
                <div>
                  <span>Last IP change</span>
                  <strong>{formatDate(data?.lastIpChangeAt)}</strong>
                </div>
                <div>
                  <span>System state</span>
                  <Status value="connected" />
                </div>
              </div>
            </Card>
            <Card>
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Event stream</span>
                  <h2>Recent activity</h2>
                </div>
                <ActivityIcon />
              </div>
              <ActivityRows items={data?.activity?.slice(0, 5) ?? []} compact />
            </Card>
          </div>
        </LoadState>
      )}
    </div>
  );
}

function ActivityRows({ items, compact = false }: { items: Activity[]; compact?: boolean }) {
  if (!items.length)
    return (
      <EmptyState
        icon={<ActivityIcon />}
        title="No recent activity"
        description="Provider and DNS events will show up here."
      />
    );
  return (
    <div className="activity-list">
      {items.map((item) => (
        <div className="activity-row" key={item.id}>
          <div className={cx('activity-dot', `activity-dot--${item.status ?? 'success'}`)} />
          <div>
            <strong>{item.action}</strong>
            {!compact && <p>{item.description}</p>}
            <span>
              {formatDate(item.createdAt)}
              {item.actor ? ` · ${item.actor}` : ''}
            </span>
          </div>
          <Status value={item.status} />
        </div>
      ))}
    </div>
  );
}

const providersLoad = () => api.providers();
export function ProvidersPage() {
  const state = useApi<Provider[]>(providersLoad);
  const [connect, setConnect] = useState(false);
  const [replace, setReplace] = useState<Provider>();
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('Cloudflare');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ text: string; kind?: 'success' | 'error' }>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('connect');
    try {
      await api.connectCloudflare(token, label);
      setConnect(false);
      setToken('');
      state.refresh();
      setMessage({ text: 'Cloudflare connection queued for verification.' });
    } catch (e) {
      setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  };
  const act = async (provider: Provider, action: 'sync' | 'test' | 'revoke') => {
    if (
      action === 'revoke' &&
      !confirm(`Revoke ${provider.label}? Managed DNS data will remain until removed.`)
    )
      return;
    setBusy(`${provider.id}-${action}`);
    try {
      if (action === 'revoke') await api.revokeProvider(provider.id);
      else await api.providerAction(provider.id, action);
      setMessage({
        text:
          action === 'revoke'
            ? 'Provider revoked.'
            : `${action === 'sync' ? 'Sync' : 'Connection test'} started.`
      });
      state.refresh();
    } catch (e) {
      setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  };
  const replaceToken = async (event: FormEvent) => {
    event.preventDefault();
    if (!replace) return;
    setBusy('replace');
    try {
      await api.replaceCredential(replace.id, token);
      setReplace(undefined);
      setToken('');
      state.refresh();
      setMessage({ text: 'Credential replaced securely.' });
    } catch (e) {
      setMessage({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="DNS"
        title="Providers"
        description="Connect authoritative DNS providers and control synchronization."
        actions={
          <Button onClick={() => setConnect(true)}>
            <Plus /> Connect provider
          </Button>
        }
      />
      <div className="section-heading">
        <div>
          <h2>Provider catalog</h2>
          <p>Choose a service to connect to Infrastructure Hub.</p>
        </div>
      </div>
      <div className="catalog-grid">
        <Card className="catalog-card">
          <div className="provider-logo cloudflare-logo">
            <CloudCog />
          </div>
          <div>
            <h3>Cloudflare</h3>
            <p>Manage zones, DNS records, proxy settings, and automated IP updates.</p>
          </div>
          <Status value="available" />
          <Button variant="secondary" onClick={() => setConnect(true)}>
            Connect <ArrowRight />
          </Button>
        </Card>
        {['AWS Route 53', 'DigitalOcean', 'Google Cloud DNS'].map((name) => (
          <Card className="catalog-card disabled" key={name}>
            <div className="provider-logo">
              <Server />
            </div>
            <div>
              <h3>{name}</h3>
              <p>Provider integration is on the product roadmap.</p>
            </div>
            <span className="coming-soon">Coming soon</span>
            <Button variant="secondary" disabled>
              Unavailable
            </Button>
          </Card>
        ))}
      </div>
      <div className="section-heading section-heading--spaced">
        <div>
          <h2>Connections</h2>
          <p>Credentials are encrypted at rest and never displayed in full.</p>
        </div>
      </div>
      {state.loading ? (
        <Spinner label="Loading providers" />
      ) : (
        <LoadState error={state.error} empty={!state.data?.length} onRetry={state.refresh}>
          <div className="connections">
            {state.data?.map((provider) => (
              <Card className="connection-card" key={provider.id}>
                <div className="connection-main">
                  <div className="provider-logo cloudflare-logo">
                    <Cloud />
                  </div>
                  <div>
                    <div className="connection-title">
                      <h3>{provider.label}</h3>
                      <Status value={provider.status} />
                    </div>
                    <span>{provider.type}</span>
                  </div>
                </div>
                <div className="connection-meta">
                  <div>
                    <span>Credential</span>
                    <code>{provider.maskedToken ?? '••••••••••••'}</code>
                  </div>
                  <div>
                    <span>Last sync</span>
                    <strong>{formatDate(provider.lastSyncAt)}</strong>
                  </div>
                  {provider.error && <div className="inline-error">{provider.error}</div>}
                </div>
                <div className="connection-actions">
                  <Button
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() => void act(provider, 'test')}
                  >
                    <Zap /> Test
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!!busy}
                    onClick={() => void act(provider, 'sync')}
                  >
                    <RefreshCw className={busy === `${provider.id}-sync` ? 'spin' : ''} /> Sync
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setReplace(provider);
                      setToken('');
                    }}
                  >
                    <KeyRound /> Replace credential
                  </Button>
                  <Button variant="danger" onClick={() => void act(provider, 'revoke')}>
                    <Trash2 /> Revoke
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </LoadState>
      )}
      <Modal
        open={connect}
        onClose={() => setConnect(false)}
        title="Connect Cloudflare"
        description="Use a scoped API token with Zone:Read and DNS:Edit permissions."
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Input
            label="Connection label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
          <Input
            label="Cloudflare API token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            hint="The token is sent once and stored encrypted."
            required
            minLength={10}
          />
          <div className="modal-actions">
            <Button variant="ghost" type="button" onClick={() => setConnect(false)}>
              Cancel
            </Button>
            <Button disabled={!!busy} type="submit">
              {busy ? 'Connecting…' : 'Connect Cloudflare'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!replace}
        onClose={() => setReplace(undefined)}
        title="Replace credential"
        description={`Update the API token for ${replace?.label ?? 'this connection'}.`}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            void replaceToken(event);
          }}
        >
          <Input
            label="New API token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            minLength={10}
          />
          <div className="modal-actions">
            <Button variant="ghost" type="button" onClick={() => setReplace(undefined)}>
              Cancel
            </Button>
            <Button disabled={!!busy}>Replace token</Button>
          </div>
        </form>
      </Modal>
      {message && (
        <Toast message={message.text} kind={message.kind} onDone={() => setMessage(undefined)} />
      )}
    </div>
  );
}

const domainsLoad = () => api.domains();
export function DomainsPage() {
  const state = useApi<Domain[]>(domainsLoad);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const providers = [
    ...new Set(state.data?.map((item) => item.providerLabel).filter(Boolean) as string[])
  ];
  const filtered = state.data?.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) &&
      (provider === 'all' || item.providerLabel === provider)
  );
  return (
    <DataPage
      title="Domains"
      description="Zones discovered across your connected DNS providers."
      loading={state.loading}
      error={state.error}
      refresh={state.refresh}
      toolbar={
        <>
          <SearchBox
            placeholder="Search domains…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Filter by provider"
          >
            <option value="all">All providers</option>
            {providers.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </>
      }
    >
      {!filtered?.length ? (
        <EmptyState
          icon={<SearchX />}
          title="No matching domains"
          description={
            state.data?.length
              ? 'Adjust your search or provider filter.'
              : 'Connect and sync a DNS provider to discover domains.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Provider</th>
                <th>Records</th>
                <th>Status</th>
                <th>Last sync</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="primary-cell">
                      <Globe2 /> <strong>{item.name}</strong>
                    </div>
                  </td>
                  <td>{item.providerLabel ?? '—'}</td>
                  <td>{item.recordsCount ?? 0}</td>
                  <td>
                    <Status value={item.status ?? 'active'} />
                  </td>
                  <td>{formatDate(item.syncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataPage>
  );
}

const recordsLoad = () => api.records();
export function RecordsPage({ ddns = false }: { ddns?: boolean }) {
  const state = useApi<DnsRecord[]>(recordsLoad);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [working, setWorking] = useState('');
  const visible = state.data?.filter(
    (item) =>
      (!ddns || (item.eligibleForDdns !== false && (item.type === 'A' || item.type === 'AAAA'))) &&
      (type === 'all' || item.type === type) &&
      `${item.name} ${item.content} ${item.domain}`.toLowerCase().includes(query.toLowerCase())
  );
  const toggle = async (record: DnsRecord) => {
    setWorking(record.id);
    try {
      const updated = await api.toggleDdns(record.id, !record.ddnsEnabled);
      state.setData(
        state.data?.map((item) =>
          item.id === record.id ? { ...item, ...updated, ddnsEnabled: !record.ddnsEnabled } : item
        )
      );
    } finally {
      setWorking('');
    }
  };
  return (
    <DataPage
      title={ddns ? 'Dynamic DNS' : 'DNS records'}
      description={
        ddns
          ? 'Choose which eligible A and AAAA records follow your public IP.'
          : 'Search and inspect records across every managed domain.'
      }
      loading={state.loading}
      error={state.error}
      refresh={state.refresh}
      toolbar={
        <>
          <SearchBox
            placeholder="Search records…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter record type"
          >
            <option value="all">All record types</option>
            {['A', 'AAAA', 'CNAME', 'MX', 'TXT'].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </>
      }
    >
      {!visible?.length ? (
        <EmptyState
          icon={<Network />}
          title={ddns ? 'No eligible records' : 'No matching records'}
          description={
            ddns
              ? 'A and AAAA records become available after a provider sync.'
              : 'Adjust your filters or sync a connected provider.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Content</th>
                <th>Domain</th>
                {ddns ? (
                  <th>Dynamic updates</th>
                ) : (
                  <>
                    <th>TTL</th>
                    <th>Proxy</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="record-type">{item.type}</span>
                  </td>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>
                    <code>{item.content}</code>
                  </td>
                  <td>{item.domain ?? '—'}</td>
                  {ddns ? (
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!item.ddnsEnabled}
                          disabled={working === item.id}
                          onChange={() => void toggle(item)}
                        />
                        <span />
                        <b>{item.ddnsEnabled ? 'Enabled' : 'Disabled'}</b>
                      </label>
                    </td>
                  ) : (
                    <>
                      <td>{item.ttl ?? 'Auto'}</td>
                      <td>
                        <Status value={item.proxied ? 'active' : 'DNS only'} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DataPage>
  );
}

function DataPage({
  title,
  description,
  toolbar,
  loading,
  error,
  refresh,
  children
}: {
  title: string;
  description: string;
  toolbar: ReactNode;
  loading: boolean;
  error: string;
  refresh: () => void;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="DNS"
        title={title}
        description={description}
        actions={
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw /> Sync view
          </Button>
        }
      />
      {!loading && !error && <div className="toolbar">{toolbar}</div>}
      {loading ? (
        <Spinner />
      ) : (
        <LoadState error={error} onRetry={refresh}>
          {children}
        </LoadState>
      )}
    </div>
  );
}

const activityLoad = () => api.activity();
export function ActivityPage() {
  const state = useApi<Activity[]>(activityLoad);
  return (
    <div className="page">
      <PageHeader
        eyebrow="DNS"
        title="Activity"
        description="An audit-friendly stream of provider, zone, and record events."
        actions={
          <Button variant="secondary" onClick={state.refresh}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {state.loading ? (
        <Spinner />
      ) : (
        <LoadState error={state.error} onRetry={state.refresh}>
          <Card>
            <ActivityRows items={state.data ?? []} />
          </Card>
        </LoadState>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState({ name: user?.name ?? '', email: user?.email ?? '' });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState<{ text: string; kind?: 'success' | 'error' }>();
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setUser(await api.updateProfile(profile));
      setMessage({ text: 'Profile updated.' });
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: 'error' });
    }
  };
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (passwords.next !== passwords.confirm)
      return setMessage({ text: 'New passwords do not match.', kind: 'error' });
    try {
      await api.changePassword(passwords.current, passwords.next);
      setPasswords({ current: '', next: '', confirm: '' });
      setUser(null);
    } catch (err) {
      setMessage({ text: (err as Error).message, kind: 'error' });
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your identity and secure access to Infrastructure Hub."
      />
      <div className="settings-grid">
        <Card>
          <div className="card-heading">
            <div>
              <span className="eyebrow">Profile</span>
              <h2>Personal information</h2>
            </div>
            <UserRound />
          </div>
          <form
            className="form-stack"
            onSubmit={(event) => {
              void saveProfile(event);
            }}
          >
            <Input
              label="Display name"
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              required
            />
            <Input
              label="Email address"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              required
            />
            <Button>Save profile</Button>
          </form>
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <span className="eyebrow">Security</span>
              <h2>Change password</h2>
            </div>
            <LockKeyhole />
          </div>
          <form
            className="form-stack"
            onSubmit={(event) => {
              void savePassword(event);
            }}
          >
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
              required
            />
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={passwords.next}
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
              hint="Use at least 12 characters."
              required
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={passwords.confirm}
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
              required
            />
            <Button>Update password</Button>
          </form>
        </Card>
      </div>
      {message && (
        <Toast message={message.text} kind={message.kind} onDone={() => setMessage(undefined)} />
      )}
    </div>
  );
}

export function FuturePage({ module, description }: { module: string; description: string }) {
  return (
    <div className="page">
      <PageHeader eyebrow="Infrastructure Hub" title={module} description={description} />
      <Card className="future-card">
        <div className="future-icon">
          <Sparkles />
        </div>
        <span className="coming-soon">Future module</span>
        <h2>{module} is on the way</h2>
        <p>
          This workspace is reserved for a future Infrastructure Hub module. Navigation and
          responsive layout are ready for the integration.
        </p>
        <Button variant="secondary" disabled>
          Not yet available
        </Button>
      </Card>
    </div>
  );
}
