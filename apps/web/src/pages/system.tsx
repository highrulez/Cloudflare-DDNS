import {
  Activity,
  CheckCircle2,
  Clipboard,
  Cloud,
  Copy,
  Database,
  Download,
  Globe2,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  type SystemLog,
  type SystemOverview,
  type SystemSelfTest
} from '../api';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  MaskedValue,
  PageTitle,
  SelectField,
  cx,
  useToast
} from '../components/ui';
import { safeFormatDate, safeOperationalTimestamp, safeRelativeTime } from '../utils/date';
import {
  detectionLabel,
  detectionTone,
  durationLabel,
  formatGitCommit,
  healthLabel,
  healthTone,
  hostLabel,
  ipDetectionSummary,
  isGitCommitAvailable,
  overallSystemStatus,
  type ServiceTone
} from './system-helpers';

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
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [overview, mfa] = await Promise.all([
        api.systemOverview(),
        api.mfaStatus().catch(() => null)
      ]);
      setData(overview);
      if (mfa) setMfaEnabled(mfa.enabled);
      setError('');
    } catch (caught) {
      if (!quiet || !dataRef.current) {
        setError(caught instanceof Error ? caught.message : 'Could not load system information');
      } else {
        toast(caught instanceof Error ? caught.message : 'Could not refresh system status', 'error');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

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

  if (loading && !data) return <SystemSkeleton />;
  if ((error || !data) && !data) {
    return (
      <ErrorState message={error || 'System information unavailable'} retry={() => void load()} />
    );
  }
  if (!data) return null;

  const overall = overallSystemStatus(data);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageTitle
        eyebrow="System"
        title="System Status"
        description="Runtime, connectivity, scheduler, and deployment diagnostics."
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
            <Button
              variant="secondary"
              busy={busy === 'refresh'}
              onClick={() => {
                setBusy('refresh');
                void load(true).finally(() => setBusy(''));
              }}
            >
              <RefreshCw className="h-4 w-4" />
              {busy === 'refresh' ? 'Refreshing…' : 'Refresh Status'}
            </Button>
          </>
        }
      />

      <p className="flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
        <StatusDot tone={overall.tone} />
        <span className="font-medium">{overall.label}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500">Updated {safeRelativeTime(data.generatedAt)}</span>
      </p>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200/80 bg-white p-1 dark:border-white/[0.06] dark:bg-console-850">
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
              'flex min-w-max items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition',
              tab === value
                ? 'bg-accent/10 text-slate-950 dark:bg-white/[0.06] dark:text-white'
                : 'text-slate-500 hover:bg-slate-100/80 dark:hover:bg-white/[0.04]'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Overview
          data={data}
          mfaEnabled={mfaEnabled}
          busy={busy}
          refreshNetwork={() => void refreshNetwork()}
        />
      )}
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
  mfaEnabled,
  busy,
  refreshNetwork
}: {
  data: SystemOverview;
  mfaEnabled: boolean | null;
  busy: string;
  refreshNetwork: () => void;
}) {
  const proxyTone: ServiceTone = data.reverseProxy.warnings.length
    ? 'warning'
    : data.reverseProxy.https
      ? 'secure'
      : 'warning';
  const commit = formatGitCommit(data.application.commit);
  const commitAvailable = isGitCommitAvailable(data.application.commit);

  return (
    <div className="grid gap-4">
      <Panel title="Service health">
        <ServiceRow
          icon={<Cloud className="h-4 w-4" />}
          name="Cloudflare API"
          detail={data.cloudflare.message || `${data.cloudflare.accounts} accounts · ${data.cloudflare.zones} zones`}
          tone={healthTone(data.cloudflare.status)}
        />
        <ServiceRow
          icon={<Database className="h-4 w-4" />}
          name="Database"
          detail={
            data.database.status === 'healthy'
              ? 'Application database reachable'
              : 'Database connectivity issue'
          }
          tone={healthTone(data.database.status)}
        />
        <ServiceRow
          icon={<Activity className="h-4 w-4" />}
          name="DDNS Scheduler"
          detail={
            data.ddns.nextRunAt
              ? `Next run ${safeFormatDate(data.ddns.nextRunAt)}`
              : data.ddns.scheduler
          }
          tone={healthTone(data.ddns.scheduler)}
          label={data.ddns.scheduler === 'running' ? 'Running' : healthLabel(healthTone(data.ddns.scheduler))}
        />
        <ServiceRow
          icon={<Network className="h-4 w-4" />}
          name="IP Detection"
          detail={ipDetectionSummary(data)}
          tone={
            data.network.ipv4Status === 'DETECTED' || data.network.ipv6Status === 'DETECTED'
              ? 'operational'
              : 'warning'
          }
        />
        <ServiceRow
          icon={<Globe2 className="h-4 w-4" />}
          name="HTTPS / Reverse Proxy"
          detail={
            data.reverseProxy.https
              ? 'Secure external connection detected'
              : data.reverseProxy.reverseProxyDetected
                ? 'Proxy headers present'
                : 'Secure connection not detected'
          }
          tone={proxyTone}
          label={proxyTone === 'secure' ? 'Secure' : healthLabel(proxyTone)}
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Network"
          action={
            <Button variant="ghost" className="min-h-8 px-2" busy={busy === 'network'} onClick={refreshNetwork}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        >
          <div className="grid gap-4">
            <AddressBlock
              family="IPv4"
              value={data.network.ipv4}
              status={data.network.ipv4Status}
              provider={hostLabel(data.network.ipv4Provider)}
              latency={data.network.ipv4LatencyMs}
            />
            <div className="ops-divider" />
            <AddressBlock
              family="IPv6"
              value={data.network.ipv6}
              status={data.network.ipv6Status}
              provider={hostLabel(data.network.ipv6Provider)}
              latency={data.network.ipv6LatencyMs}
            />
          </div>
          <div className="ops-divider mt-4 pt-4">
            <p className="ops-eyebrow mb-3">Network environment</p>
            <InfoRow label="Hostname" value={data.synology.hostname} mono copyable />
            <InfoRow
              label="Network mode"
              value={data.docker.hostNetworking ? 'Host Network' : data.docker.networkMode}
            />
            <InfoRow label="Runtime" value="Docker" />
            <InfoRow label="Platform" value={data.synology.operatingSystem || data.docker.platform} />
            <InfoRow label="Architecture" value={data.synology.architecture} />
            <InfoRow label="Timezone" value={data.synology.timezone} />
          </div>
        </Panel>

        <Panel title="DDNS Scheduler">
          <InfoRow
            label="Status"
            value={
              <Badge status={data.ddns.scheduler === 'running' ? 'healthy' : 'warning'}>
                {data.ddns.scheduler === 'running' ? 'Running' : data.ddns.scheduler}
              </Badge>
            }
          />
          <InfoRow label="Last check" value={formatStamp(data.ddns.lastRunAt)} />
          <InfoRow label="Next check" value={formatStamp(data.ddns.nextRunAt)} />
          <InfoRow label="Interval" value={`${data.ddns.intervalMinutes} minutes`} />
          <InfoRow label="Last successful update" value={formatStamp(data.ddns.lastSuccessfulUpdate)} />
          <InfoRow label="Managed records" value={String(data.ddns.managedRecords)} />
          {data.ddns.lastError && (
            <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-medium">Last error</p>
              <p className="mt-1">{data.ddns.lastError}</p>
            </div>
          )}
          <SchedulerTimeline last={data.ddns.lastRunAt} next={data.ddns.nextRunAt} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Application">
          <InfoRow label="Application" value="Cloudflare DDNS Manager" />
          <InfoRow label="Environment" value={data.application.environment} />
          <InfoRow label="App version" value={data.application.version} mono />
          <InfoRow
            label="Build date"
            value={data.application.buildDate ? formatStamp(data.application.buildDate) : 'Not available'}
          />
          <InfoRow
            label="Git commit"
            value={commit}
            mono={commitAvailable}
            copyable={commitAvailable}
            copyValue={data.application.commit}
          />
          <InfoRow label="Config version" value={data.application.configurationVersion} mono />
          <InfoRow label="Timezone" value={data.synology.timezone} />
          <InfoRow label="Node runtime" value={data.docker.nodeVersion} mono />
          <InfoRow label="Container uptime" value={durationLabel(data.docker.uptimeSeconds)} />
          <InfoRow label="Started" value={formatStamp(data.application.startedAt)} />
        </Panel>

        <Panel title="Security">
          <ServiceRow
            name="HTTPS"
            detail={data.security.https ? 'Active on this request' : 'Not detected on this request'}
            tone={data.security.https ? 'secure' : 'warning'}
            label={data.security.https ? 'Active' : 'Not detected'}
          />
          <ServiceRow
            name="Reverse proxy"
            detail={
              data.security.reverseProxyDetected
                ? 'Forwarding headers detected'
                : 'No proxy headers detected'
            }
            tone={data.security.reverseProxyDetected ? 'operational' : 'warning'}
            label={data.security.reverseProxyDetected ? 'Detected' : 'Not detected'}
          />
          <ServiceRow
            name="Secure cookies"
            detail={data.security.cookieSecure ? 'Secure cookie flag enabled' : 'Secure cookie flag disabled'}
            tone={data.security.cookieSecure ? 'operational' : 'warning'}
            label={data.security.cookieSecure ? 'Active' : 'Disabled'}
          />
          <ServiceRow
            name="Turnstile"
            detail={
              data.security.turnstileConfigured
                ? 'Login protection configured'
                : 'Turnstile not configured'
            }
            tone={data.security.turnstileConfigured ? 'operational' : 'unknown'}
            label={data.security.turnstileConfigured ? 'Enabled' : 'Disabled'}
          />
          <ServiceRow
            name="MFA"
            detail={
              mfaEnabled === null
                ? 'Status unavailable'
                : mfaEnabled
                  ? 'Multi-factor authentication enabled'
                  : 'Available — not enabled for this account'
            }
            tone={mfaEnabled === null ? 'unknown' : mfaEnabled ? 'operational' : 'warning'}
            label={mfaEnabled === null ? 'Unknown' : mfaEnabled ? 'Enabled' : 'Available'}
          />
          <ServiceRow
            name="Strong authentication"
            detail={
              data.security.strongAuthAvailable
                ? 'Step-up verification available for sensitive actions'
                : 'Strong authentication status unavailable'
            }
            tone={data.security.strongAuthAvailable ? 'operational' : 'unknown'}
            label={data.security.strongAuthAvailable ? 'Enabled' : 'Unknown'}
          />
          <ServiceRow
            name="Session protection"
            detail="HttpOnly session cookies with server-side storage"
            tone="operational"
            label="Active"
          />
          {data.reverseProxy.warnings.length > 0 && (
            <div className="mt-3 space-y-2">
              {data.reverseProxy.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                >
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {warning}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Database">
        <div className="grid gap-1 sm:grid-cols-2">
          <InfoRow
            label="Status"
            value={
              <Badge status={data.database.status === 'healthy' ? 'healthy' : data.database.status}>
                {data.database.status === 'healthy' ? 'Connected' : data.database.status}
              </Badge>
            }
          />
          <InfoRow label="Engine" value={`${data.database.type}`} />
          <InfoRow
            label="Migration status"
            value={
              data.database.pendingMigrations.length
                ? `${data.database.pendingMigrations.length} pending`
                : 'Up to date'
            }
          />
          <InfoRow label="Connection latency" value={`${data.database.latencyMs} ms`} mono />
          <InfoRow
            label="Current migration"
            value={data.database.currentMigration ?? 'None'}
            mono
          />
        </div>
      </Panel>
    </div>
  );
}

function AddressBlock({
  family,
  value,
  status,
  provider,
  latency
}: {
  family: 'IPv4' | 'IPv6';
  value: string | null;
  status: SystemOverview['network']['ipv4Status'];
  provider: string;
  latency: number | null;
}) {
  const tone = detectionTone(status);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="ops-eyebrow">Public {family}</p>
        <div className="flex items-center gap-2">
          {latency !== null && (
            <span className="ops-mono text-[11px] text-slate-500">{latency} ms</span>
          )}
          <Badge status={tone === 'operational' ? 'healthy' : tone === 'warning' ? 'warning' : 'disabled'}>
            {detectionLabel(status)}
          </Badge>
        </div>
      </div>
      <div className="mt-2">
        <MaskedValue value={value} label={family} />
      </div>
      <p className="mt-1 text-[12px] text-slate-500">{provider}</p>
    </div>
  );
}

function SchedulerTimeline({ last, next }: { last: string | null; next: string | null }) {
  if (!last && !next) return null;
  return (
    <div className="mt-4 rounded-lg border border-slate-200/80 px-3 py-3 dark:border-white/[0.06]">
      <p className="ops-eyebrow mb-3">Schedule</p>
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span className="min-w-0 flex-1 truncate">Last check</span>
        <span className="text-slate-400">——</span>
        <span className="font-medium text-slate-700 dark:text-slate-200">Now</span>
        <span className="text-slate-400">——</span>
        <span className="min-w-0 flex-1 truncate text-right">Next check</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate ops-mono text-slate-600 dark:text-slate-300">
          {formatStamp(last)}
        </span>
        <span className="status-dot-live animate" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-right ops-mono text-slate-600 dark:text-slate-300">
          {formatStamp(next)}
        </span>
      </div>
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/[0.06]">
        <div>
          <p className="ops-eyebrow">Diagnostics</p>
          <h2 className="mt-1 text-sm font-semibold">Infrastructure self-tests</h2>
          <p className="mt-1 text-[12px] text-slate-500">
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
        <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
          {tests.map((test) => (
            <div
              key={test.id}
              className="grid gap-3 px-5 py-3.5 sm:grid-cols-[auto_1fr_auto] sm:items-center"
            >
              <TestIcon status={test.status} />
              <div>
                <strong className="text-sm">{test.name}</strong>
                <p className="text-[12px] text-slate-500">{test.message}</p>
                <time className="text-[11px] text-slate-400">{safeFormatDate(test.timestamp)}</time>
              </div>
              <span className="ops-mono w-fit rounded-md bg-slate-100 px-2 py-1 text-[11px] dark:bg-white/5">
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
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200/80 p-4 dark:border-white/[0.06]">
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
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200/90 px-4 text-sm font-semibold hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>
      </div>
      {!logs.length ? (
        <div className="p-10 text-center text-sm text-slate-500">No matching log entries.</div>
      ) : (
        <div className="max-h-[680px] divide-y divide-slate-100 overflow-auto font-mono text-xs dark:divide-white/[0.04]">
          {logs.map((entry) => (
            <div key={entry.id} className="grid gap-2 p-3 sm:grid-cols-[150px_90px_110px_1fr]">
              <time className="text-slate-500">{safeFormatDate(entry.time)}</time>
              <span className={levelColor(entry.level)}>{entry.level.toUpperCase()}</span>
              <span className="text-accent dark:text-sky-300">{entry.category}</span>
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

function Panel({
  title,
  action,
  children
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="ops-eyebrow">{title}</p>
        {action}
      </div>
      {children}
    </Card>
  );
}

function ServiceRow({
  icon,
  name,
  detail,
  tone,
  label
}: {
  icon?: ReactNode;
  name: string;
  detail: string;
  tone: ServiceTone;
  label?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-slate-100 py-3 first:border-t-0 first:pt-0 dark:border-white/[0.04]">
      {icon && (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200/80 text-slate-500 dark:border-white/10 dark:text-slate-300">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{name}</p>
          <Badge
            status={
              tone === 'operational' || tone === 'secure'
                ? 'healthy'
                : tone === 'warning'
                  ? 'warning'
                  : tone === 'error'
                    ? 'error'
                    : 'disabled'
            }
          >
            {label ?? healthLabel(tone)}
          </Badge>
        </div>
        <p className="mt-0.5 text-[12px] text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  copyable,
  copyValue
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  copyable?: boolean;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === 'string' ? value : copyValue;
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 py-1.5">
      <span className="text-[12px] text-slate-500">{label}</span>
      <span className="inline-flex max-w-[70%] items-center gap-1.5 text-right text-[13px] font-medium text-slate-800 dark:text-slate-100">
        <span className={cx('min-w-0 break-words', mono && 'ops-mono text-[12px]')}>{value}</span>
        {copyable && text && text !== 'Not available' && text !== '—' && (
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5"
            aria-label={`Copy ${label}`}
            title={`Copy ${label}`}
            onClick={() => {
              void navigator.clipboard.writeText(String(copyValue ?? text)).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {copied && (
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300">
            Copied
          </span>
        )}
      </span>
    </div>
  );
}

function StatusDot({ tone }: { tone: ServiceTone }) {
  return (
    <span
      className={cx(
        'status-dot',
        tone === 'operational' || tone === 'secure'
          ? 'status-dot-live animate'
          : tone === 'warning'
            ? 'bg-amber-500'
            : tone === 'error'
              ? 'bg-red-500'
              : 'bg-slate-400'
      )}
      aria-hidden
    />
  );
}

function TestIcon({ status }: { status: SystemSelfTest['status'] }) {
  if (status === 'success') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === 'warning') return <TriangleAlert className="h-5 w-5 text-amber-500" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

function formatStamp(value: string | null | undefined) {
  const stamp = safeOperationalTimestamp(value);
  if (!stamp) return '—';
  return stamp.absolute;
}

function levelColor(level: SystemLog['level']) {
  return level === 'error'
    ? 'text-red-600'
    : level === 'warning'
      ? 'text-amber-600'
      : 'text-emerald-600';
}

function SystemSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Inspecting infrastructure health">
      <div className="h-16 max-w-xl animate-pulse rounded-lg bg-slate-200/70 dark:bg-white/5" />
      <div className="ops-panel h-48 animate-pulse bg-slate-100/80 dark:bg-white/[0.03]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="ops-panel h-64 animate-pulse bg-slate-100/80 dark:bg-white/[0.03]" />
        <div className="ops-panel h-64 animate-pulse bg-slate-100/80 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}
