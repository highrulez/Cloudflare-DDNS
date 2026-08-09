import {
  Activity,
  Box,
  CheckCircle2,
  Clipboard,
  Cloud,
  Copy,
  Database,
  Download,
  Globe2,
  HardDrive,
  Network,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  api,
  detectionStatusText,
  type HealthState,
  type SystemLog,
  type SystemOverview,
  type SystemSelfTest
} from '../api';
import {
  Button,
  Card,
  ErrorState,
  Loading,
  PageTitle,
  SelectField,
  cx,
  formatDate,
  useToast
} from '../components/ui';

type Tab = 'overview' | 'tests' | 'logs';

export function SystemPage() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<SystemOverview>();
  const [tests, setTests] = useState<SystemSelfTest[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [logLevel, setLogLevel] = useState('');
  const [logCategory, setLogCategory] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await api.systemOverview());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load system information');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    const query = new URLSearchParams({ limit: '300' });
    if (logLevel) query.set('level', logLevel);
    if (logCategory) query.set('category', logCategory);
    const result = await api.systemLogs(query);
    setLogs(result.items);
  }, [logLevel, logCategory]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (tab !== 'logs') return;
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 30_000);
    return () => window.clearInterval(timer);
  }, [tab, loadLogs]);

  const refreshNetwork = async () => {
    setBusy('network');
    try {
      await api.refreshSystemNetwork();
      await load(true);
      toast('Public IP detection refreshed.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Network detection failed', 'error');
    } finally {
      setBusy('');
    }
  };
  const runTests = async () => {
    setBusy('tests');
    try {
      const result = await api.runSystemTests();
      setTests(result.tests);
      toast('System self-tests completed.');
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Self-tests failed', 'error');
    } finally {
      setBusy('');
    }
  };
  const copyDiagnostics = async () => {
    setBusy('copy');
    try {
      await navigator.clipboard.writeText(await api.systemDiagnostics());
      toast('Sanitized diagnostics copied.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not copy diagnostics', 'error');
    } finally {
      setBusy('');
    }
  };
  const copyLogs = async () => {
    await navigator.clipboard.writeText(logs.map((entry) => JSON.stringify(entry)).join('\n'));
    toast('Sanitized logs copied.');
  };

  if (loading) return <Loading label="Inspecting infrastructure health" />;
  if (error || !data)
    return (
      <ErrorState message={error || 'System information unavailable'} retry={() => void load()} />
    );

  const warningCount =
    data.reverseProxy.warnings.length +
    data.database.pendingMigrations.length +
    (data.cloudflare.status === 'healthy' ? 0 : 1);

  return (
    <div className="space-y-7">
      <PageTitle
        eyebrow="Infrastructure"
        title="System"
        description="Synology, Docker, network, database, Cloudflare, proxy, and DDNS diagnostics."
        actions={
          <>
            <Button
              variant="secondary"
              busy={busy === 'copy'}
              onClick={() => void copyDiagnostics()}
            >
              <Clipboard className="h-4 w-4" />
              Copy Diagnostics
            </Button>
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary
          label="Infrastructure"
          value={warningCount ? `${warningCount} warnings` : 'Healthy'}
          state={warningCount ? 'warning' : 'healthy'}
        />
        <Summary
          label="HTTPS / Proxy"
          value={data.reverseProxy.warnings.length ? 'Needs attention' : 'Healthy'}
          state={data.reverseProxy.warnings.length ? 'warning' : 'healthy'}
        />
        <Summary label="Last refreshed" value={relativeTime(data.generatedAt)} state="healthy" />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
        {(
          [
            ['overview', 'Overview', Activity],
            ['tests', 'Self Tests', ShieldCheck],
            ['logs', 'System Logs', Terminal]
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cx(
              'flex min-w-max items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium',
              tab === value
                ? 'bg-blue-600 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview data={data} busy={busy} refreshNetwork={refreshNetwork} />}
      {tab === 'tests' && (
        <SelfTests tests={tests} busy={busy === 'tests'} run={() => void runTests()} />
      )}
      {tab === 'logs' && (
        <Logs
          logs={logs}
          level={logLevel}
          category={logCategory}
          setLevel={setLogLevel}
          setCategory={setLogCategory}
          refresh={() => void loadLogs()}
          copy={() => void copyLogs()}
        />
      )}
    </div>
  );
}

function Overview({
  data,
  busy,
  refreshNetwork
}: {
  data: SystemOverview;
  busy: string;
  refreshNetwork: () => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section
        icon={<Network />}
        title="Network"
        state={data.network.ipv4 || data.network.ipv6 ? 'healthy' : 'error'}
        action={
          <Button variant="ghost" busy={busy === 'network'} onClick={refreshNetwork}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      >
        <Address
          family="IPv4"
          value={data.network.ipv4}
          status={detectionStatusText(data.network.ipv4Status ?? undefined, 'IPv4')}
          provider={host(data.network.ipv4Provider)}
          latency={data.network.ipv4LatencyMs}
        />
        <Address
          family="IPv6"
          value={data.network.ipv6}
          status={detectionStatusText(data.network.ipv6Status ?? undefined, 'IPv6')}
          provider={host(data.network.ipv6Provider)}
          latency={data.network.ipv6LatencyMs}
        />
        <Row label="Last detection" value={formatDate(data.network.detectedAt ?? undefined)} />
      </Section>

      <Section icon={<Server />} title="Synology" state="healthy">
        <Row label="Hostname" value={data.synology.hostname} mono />
        <Row label="Operating system" value={data.synology.operatingSystem} />
        <Row label="Kernel" value={data.synology.kernel} mono />
        <Row label="Architecture" value={data.synology.architecture} />
        <Row label="Timezone" value={data.synology.timezone} />
      </Section>

      <Section
        icon={<Box />}
        title="Docker"
        state={data.docker.hostNetworking ? 'healthy' : 'warning'}
      >
        <Row label="Container ID" value={data.docker.containerId} mono />
        <Row label="Container" value={data.docker.containerName} />
        <Row
          label="Docker mode"
          value={data.docker.hostNetworking ? 'Host networking' : data.docker.networkMode}
        />
        <Row label="Container uptime" value={duration(data.docker.uptimeSeconds)} />
        <Row label="Node" value={data.docker.nodeVersion} mono />
        <Row label="Platform" value={data.docker.platform} />
      </Section>

      <Section icon={<Database />} title="Database" state={data.database.status}>
        <Row label="Status" value="Connected" />
        <Row label="Database type" value={`${data.database.type} ${data.database.version}`} />
        <Row label="Database" value={data.database.database} mono />
        <Row label="Connection latency" value={`${data.database.latencyMs} ms`} chip />
        <Row label="Current migration" value={data.database.currentMigration ?? 'None'} mono />
        <Row
          label="Pending migrations"
          value={
            data.database.pendingMigrations.length
              ? data.database.pendingMigrations.join(', ')
              : 'Up to date'
          }
        />
      </Section>

      <Section icon={<Cloud />} title="Cloudflare" state={data.cloudflare.status}>
        <Row
          label="Cloudflare API"
          value={data.cloudflare.status === 'healthy' ? 'Healthy' : 'Degraded'}
        />
        <Row label="Connected accounts" value={String(data.cloudflare.accounts)} />
        <Row label="Accessible zones" value={String(data.cloudflare.zones)} />
        <Row label="API latency" value={`${data.cloudflare.latencyMs} ms`} chip />
        <Row
          label="Last successful request"
          value={formatDate(data.cloudflare.lastSuccessfulRequest ?? undefined)}
        />
        <Permission label="Zone Read" state={data.cloudflare.permissions.zoneRead} />
        <Permission label="DNS Edit" state={data.cloudflare.permissions.dnsEdit} />
      </Section>

      <Section
        icon={<Activity />}
        title="DDNS Engine"
        state={data.ddns.scheduler === 'running' ? 'healthy' : 'warning'}
      >
        <Row label="Scheduler" value={data.ddns.scheduler} />
        <Row label="Check interval" value={`${data.ddns.intervalMinutes} minutes`} />
        <Row label="Last run" value={formatDate(data.ddns.lastRunAt ?? undefined)} />
        <Row label="Next run" value={formatDate(data.ddns.nextRunAt ?? undefined)} />
        <Row
          label="Last successful update"
          value={formatDate(data.ddns.lastSuccessfulUpdate ?? undefined)}
        />
        <Row label="Current lease owner" value={data.ddns.leaseOwner} mono />
        <Row label="Scheduler version" value={data.ddns.schedulerVersion} />
      </Section>

      <Section
        icon={<Globe2 />}
        title="Reverse Proxy"
        state={data.reverseProxy.warnings.length ? 'warning' : 'healthy'}
      >
        {data.reverseProxy.warnings.map((warning) => (
          <div
            key={warning}
            className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {warning}
          </div>
        ))}
        <Row label="HTTPS" value={data.reverseProxy.https ? 'Enabled' : 'Not detected'} />
        <Row label="Original protocol" value={data.reverseProxy.protocol} mono />
        <Row label="Original host" value={data.reverseProxy.hostname} mono />
        <Row label="Forwarded IP" value={data.reverseProxy.clientIp} mono />
        <Row label="Forwarded port" value={data.reverseProxy.forwardedPort ?? 'Not provided'} />
        <Row label="APP_ORIGIN" value={data.reverseProxy.appOrigin ?? 'Not configured'} mono />
        <Row label="Cookie mode" value={data.reverseProxy.cookieSecure ? 'Secure' : 'Insecure'} />
        <Row label="trustProxy" value={data.reverseProxy.trustProxy ? 'Enabled' : 'Disabled'} />
      </Section>

      <Section icon={<HardDrive />} title="Application" state="healthy">
        <Row label="Application version" value={data.application.version} />
        <Row label="Git commit" value={data.application.commit} mono />
        <Row label="Build date" value={formatDate(data.application.buildDate ?? undefined)} />
        <Row label="Environment" value={data.application.environment} />
        <Row label="Configuration version" value={data.application.configurationVersion} />
        <Row label="Latest release" value={data.application.latestRelease ?? 'Not checked'} />
        <Row label="Started" value={formatDate(data.application.startedAt)} />
      </Section>
    </div>
  );
}

function SelfTests({
  tests,
  busy,
  run
}: {
  tests: SystemSelfTest[];
  busy: boolean;
  run: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <div>
          <h2 className="font-bold">Infrastructure self-tests</h2>
          <p className="text-sm text-slate-500">
            Tests are read-only and never expose credentials.
          </p>
        </div>
        <Button busy={busy} onClick={run}>
          <Play className="h-4 w-4" />
          Run All Tests
        </Button>
      </div>
      {!tests.length ? (
        <div className="p-10 text-center text-sm text-slate-500">
          Run tests to verify network, database, Cloudflare, scheduler, encryption, sessions, proxy,
          HTTPS, and DNS.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {tests.map((test) => (
            <div
              key={test.id}
              className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <TestIcon status={test.status} />
              <div>
                <strong className="text-sm">{test.name}</strong>
                <p className="text-xs text-slate-500">{test.message}</p>
                <time className="text-xs text-slate-400">{formatDate(test.timestamp)}</time>
              </div>
              <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs dark:bg-slate-800">
                {test.latencyMs} ms
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Logs({
  logs,
  level,
  category,
  setLevel,
  setCategory,
  refresh,
  copy
}: {
  logs: SystemLog[];
  level: string;
  category: string;
  setLevel: (value: string) => void;
  setCategory: (value: string) => void;
  refresh: () => void;
  copy: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <SelectField label="Level" value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </SelectField>
        <SelectField
          label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All categories</option>
          <option value="application">Application</option>
          <option value="cloudflare">Cloudflare</option>
          <option value="scheduler">Scheduler</option>
          <option value="authentication">Authentication</option>
          <option value="database">Database</option>
        </SelectField>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button variant="secondary" onClick={copy}>
            <Copy className="h-4 w-4" />
            Copy
          </Button>
          <a
            href={api.systemLogsDownloadUrl}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-100 px-4 text-sm font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>
      </div>
      {!logs.length ? (
        <div className="p-10 text-center text-sm text-slate-500">No matching log entries.</div>
      ) : (
        <div className="max-h-[680px] divide-y divide-slate-100 overflow-auto font-mono text-xs dark:divide-slate-800">
          {logs.map((entry) => (
            <div key={entry.id} className="grid gap-2 p-3 sm:grid-cols-[150px_90px_110px_1fr]">
              <time className="text-slate-500">{new Date(entry.time).toLocaleString()}</time>
              <span className={levelColor(entry.level)}>{entry.level.toUpperCase()}</span>
              <span className="text-blue-600">{entry.category}</span>
              <div className="min-w-0">
                <p className="break-words">{entry.message}</p>
                {entry.details && (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-slate-500">
                    {JSON.stringify(entry.details)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Section({
  icon,
  title,
  state,
  action,
  children
}: {
  icon: ReactNode;
  title: string;
  state: HealthState;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950">
          {icon}
        </span>
        <h2 className="font-bold">{title}</h2>
        <HealthDot state={state} />
        <div className="ml-auto">{action}</div>
      </div>
      <div className="grid gap-1 p-4">{children}</div>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
  chip
}: {
  label: string;
  value: string;
  mono?: boolean;
  chip?: boolean;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <span className="text-sm text-slate-500">{label}</span>
      <span
        className={cx(
          'max-w-[65%] break-words text-right text-sm font-medium',
          mono && 'font-mono text-xs',
          chip && 'rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs dark:bg-slate-800'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Address({
  family,
  value,
  status,
  provider,
  latency
}: {
  family: string;
  value: string | null;
  status: string;
  provider: string;
  latency: number | null;
}) {
  return (
    <div className="rounded-xl bg-slate-950 p-4 text-white">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-blue-300">{family}</span>
        {latency !== null && (
          <span className="rounded-full bg-white/10 px-2 py-1 text-xs">{latency} ms</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <strong className="min-w-0 break-all font-mono text-base">{value ?? '—'}</strong>
        {value && (
          <button
            type="button"
            aria-label={`Copy ${family}`}
            onClick={() => void navigator.clipboard.writeText(value)}
            className="rounded p-1 text-slate-300 hover:bg-white/10"
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {status} · {provider}
      </p>
    </div>
  );
}

function Summary({ label, value, state }: { label: string; value: string; state: HealthState }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <HealthDot state={state} />
      <div>
        <span className="block text-xs text-slate-500">{label}</span>
        <strong>{value}</strong>
      </div>
    </Card>
  );
}

function HealthDot({ state }: { state: HealthState }) {
  return (
    <span
      title={state}
      className={cx(
        'ml-auto h-2.5 w-2.5 rounded-full',
        state === 'healthy' && 'bg-emerald-500',
        state === 'warning' && 'bg-amber-500',
        state === 'error' && 'bg-red-500'
      )}
    />
  );
}

function Permission({
  label,
  state
}: {
  label: string;
  state: 'granted' | 'denied' | 'not_verified';
}) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span
        className={
          state === 'granted'
            ? 'text-emerald-600'
            : state === 'denied'
              ? 'text-red-600'
              : 'text-amber-600'
        }
      >
        {state === 'granted' ? 'Granted' : state === 'denied' ? 'Denied' : 'Not verified'}
      </span>
    </div>
  );
}

function TestIcon({ status }: { status: SystemSelfTest['status'] }) {
  if (status === 'success') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === 'warning') return <TriangleAlert className="h-5 w-5 text-amber-500" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function duration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`]
    .filter(Boolean)
    .join(' ');
}
function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
}
function host(value: string | null) {
  if (!value) return 'No provider';
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}
function levelColor(level: SystemLog['level']) {
  return level === 'error'
    ? 'text-red-600'
    : level === 'warning'
      ? 'text-amber-600'
      : 'text-emerald-600';
}
