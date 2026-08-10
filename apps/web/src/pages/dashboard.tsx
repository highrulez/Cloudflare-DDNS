import { ArrowRight, RefreshCw, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  detectionStatusText,
  type Dashboard,
  type DetectionStatus,
  type HistoryItem
} from '../api';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Loading,
  MaskedValue,
  PageTitle,
  cx,
  formatDate,
  useToast
} from '../components/ui';

export function DashboardPage() {
  const toast = useToast();
  const [data, setData] = useState<Dashboard>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState<'check' | 'force'>();

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.dashboard());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async () => {
    if (!action) return;
    try {
      if (action === 'check') await api.checkAll();
      else await api.forceAll();
      toast(
        action === 'check' ? 'All enabled records checked.' : 'All enabled records force-updated.'
      );
      setAction(undefined);
      await load();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'DDNS run failed', 'error');
    }
  };

  if (loading) return <Loading label="Loading DDNS dashboard" />;
  if (error || !data)
    return <ErrorState message={error || 'Dashboard unavailable'} retry={() => void load()} />;

  const managed = data.totalRecords;
  const proxied = data.proxiedRecords;
  const dnsOnly = data.dnsOnlyRecords;
  const proxiedPct = managed > 0 ? Math.round((proxied / managed) * 100) : 0;
  const dnsOnlyPct = managed > 0 ? Math.max(0, 100 - proxiedPct) : 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageTitle
        eyebrow="Overview"
        title="Dashboard"
        description="Network address detection, record coverage, and recent DDNS synchronization."
        actions={
          <>
            <Button variant="secondary" onClick={() => setAction('check')}>
              <RefreshCw className="h-4 w-4" />
              Check Now
            </Button>
            <Button onClick={() => setAction('force')}>
              <Zap className="h-4 w-4" />
              Force Update
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <NetworkStatus data={data} />
        <SystemHealth data={data} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="ops-eyebrow">Record coverage</p>
          <div className="mt-4 flex items-center gap-5">
            <CoverageDonut proxied={proxied} dnsOnly={dnsOnly} />
            <div className="min-w-0 flex-1">
              <strong className="block text-3xl font-semibold tracking-tight tabular-nums">
                {managed}
              </strong>
              <span className="text-sm text-slate-500">Managed records</span>
              <ul className="mt-3 space-y-1.5 text-sm">
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span className="status-dot bg-teal-500" aria-hidden />
                    Proxied
                  </span>
                  <span className="tabular-nums text-slate-800 dark:text-slate-100">
                    {proxied}{' '}
                    <span className="text-slate-500">({proxiedPct}%)</span>
                  </span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span className="status-dot bg-accent dark:bg-sky-400" aria-hidden />
                    DNS only
                  </span>
                  <span className="tabular-nums text-slate-800 dark:text-slate-100">
                    {dnsOnly}{' '}
                    <span className="text-slate-500">({dnsOnlyPct}%)</span>
                  </span>
                </li>
              </ul>
            </div>
          </div>
          <div className="ops-divider mt-5 pt-4">
            <div
              className="flex h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10"
              role="img"
              aria-label={`${proxied} proxied (${proxiedPct}%), ${dnsOnly} DNS only (${dnsOnlyPct}%)`}
            >
              {managed > 0 ? (
                <>
                  <div
                    className="h-full bg-teal-500 transition-[width]"
                    style={{ width: `${proxiedPct}%` }}
                  />
                  <div
                    className="h-full bg-accent transition-[width] dark:bg-sky-400"
                    style={{ width: `${dnsOnlyPct}%` }}
                  />
                </>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {proxied} proxied / {dnsOnly} DNS only
              </span>
              <span className="tabular-nums">{proxiedPct}% proxied</span>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <p className="ops-eyebrow">Record types</p>
          <div className="mt-4 space-y-3">
            <TypeRow label="A" note="IPv4" value={data.aRecords} total={managed} />
            <TypeRow label="AAAA" note="IPv6" value={data.aaaaRecords} total={managed} />
          </div>
          <div className="ops-divider mt-5 pt-4 text-xs text-slate-500">
            {data.enabledRecords} of {managed} records currently enabled for DDNS
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/[0.06]">
          <div>
            <p className="ops-eyebrow">Live activity</p>
            <h2 className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
              Recent DDNS events
            </h2>
          </div>
          <Link
            to="/history"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline dark:text-sky-300"
          >
            View history
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        {!data.recentUpdates.length ? (
          <p className="px-5 py-8 text-sm text-slate-500">No update history yet.</p>
        ) : (
          <ol className="relative px-5 py-2">
            {data.recentUpdates.map((item, index) => (
              <ActivityRow
                key={item.id}
                item={item}
                last={index === data.recentUpdates.length - 1}
              />
            ))}
          </ol>
        )}
      </Card>

      <Dialog
        open={Boolean(action)}
        onClose={() => setAction(undefined)}
        title={
          action === 'force' ? 'Force update every enabled record?' : 'Check every enabled record?'
        }
        description={
          action === 'force'
            ? 'Only records explicitly managed with DDNS enabled are written. Unselected and disabled records remain untouched.'
            : 'Cloudflare values are compared with the detected public IP.'
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAction(undefined)}>
            Cancel
          </Button>
          <Button variant={action === 'force' ? 'danger' : 'primary'} onClick={() => void run()}>
            {action === 'force' ? 'Force Update' : 'Check Now'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function NetworkStatus({ data }: { data: Dashboard }) {
  const synced = data.status === 'healthy';
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ops-eyebrow">Network status</p>
          <p className="mt-1 text-sm text-slate-500">Current network addresses</p>
        </div>
        <Badge status={synced ? 'healthy' : data.status}>
          {synced ? 'Synchronized' : data.status}
        </Badge>
      </div>

      <div className="mt-5 space-y-4">
        <AddressRow family="IPv4" value={data.currentIp} status={data.ipv4Status} />
        <div className="ops-divider" />
        <AddressRow family="IPv6" value={data.currentIpv6} status={data.ipv6Status} />
      </div>

      <div className="ops-divider mt-5 flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
        <span className="text-slate-500">Next automatic check</span>
        <time className="ops-mono text-slate-800 dark:text-slate-100">
          {formatDate(data.nextCheckAt)}
        </time>
      </div>
    </Card>
  );
}

function SystemHealth({ data }: { data: Dashboard }) {
  const healthy = data.status === 'healthy';
  return (
    <Card className="flex flex-col p-5">
      <p className="ops-eyebrow">System health</p>
      <div className="mt-3 flex items-center gap-2.5">
        <span
          className={cx(
            'status-dot h-2 w-2',
            healthy ? 'status-dot-live animate' : data.status === 'error' ? 'bg-red-500' : 'bg-amber-500'
          )}
          aria-hidden
        />
        <strong className="text-base font-semibold tracking-tight">
          {healthy
            ? 'All systems operational'
            : data.status === 'updating'
              ? 'Synchronization in progress'
              : data.status === 'degraded'
                ? 'Attention required'
                : data.status === 'error'
                  ? 'System error'
                  : 'Status unknown'}
        </strong>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        Overall status: <span className="capitalize text-slate-700 dark:text-slate-300">{data.status}</span>
      </p>

      <div className="mt-auto grid gap-3 pt-6">
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3.5 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Next DDNS check</p>
          <p className="ops-mono mt-1 text-slate-900 dark:text-slate-100">
            {formatDate(data.nextCheckAt)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3.5 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Managed coverage</p>
          <p className="mt-1 text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">
            {data.enabledRecords} / {data.totalRecords} records enabled
          </p>
        </div>
      </div>
    </Card>
  );
}

function AddressRow({
  family,
  value,
  status
}: {
  family: 'IPv4' | 'IPv6';
  value?: string;
  status?: DetectionStatus;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <span className="ops-mono text-[12px] font-medium text-slate-500">{family}</span>
      <div className="min-w-0">
        <MaskedValue value={value} label={family} />
        <p className="mt-1 text-xs text-slate-500">{detectionStatusText(status, family)}</p>
      </div>
      <Badge status={status === 'DETECTED' ? 'healthy' : status === 'DISABLED' ? 'disabled' : 'warning'}>
        {status === 'DETECTED' ? 'Detected' : status ? status.replaceAll('_', ' ').toLowerCase() : 'Unknown'}
      </Badge>
    </div>
  );
}

function TypeRow({
  label,
  note,
  value,
  total
}: {
  label: string;
  note: string;
  value: number;
  total: number;
}) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="ops-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
            {label}
          </span>
          <span className="text-xs text-slate-500">{note}</span>
        </div>
        <span className="tabular-nums text-sm font-semibold text-slate-800 dark:text-slate-100">
          {value}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-slate-500/70 dark:bg-slate-300/50"
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

function ActivityRow({ item, last }: { item: HistoryItem; last: boolean }) {
  const detail =
    item.oldValue && item.newValue
      ? `${item.oldValue} → ${item.newValue}`
      : item.message || activityDetail(item);

  return (
    <li className="relative flex gap-3 py-3.5">
      <div className="relative flex w-3 shrink-0 justify-center">
        <span
          className={cx(
            'relative z-[1] mt-1.5 status-dot',
            item.status === 'success'
              ? 'bg-emerald-500'
              : item.status === 'failed'
                ? 'bg-red-500'
                : item.status === 'skipped'
                  ? 'bg-slate-400'
                  : 'bg-amber-500'
          )}
          aria-hidden
        />
        {!last && (
          <span
            className="absolute top-3 bottom-[-0.9rem] w-px bg-slate-200 dark:bg-white/10"
            aria-hidden
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              {item.recordName ?? item.action}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{detail}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge status={item.status} />
            <time className="ops-mono text-[11px] text-slate-500">{formatDate(item.createdAt)}</time>
          </div>
        </div>
      </div>
    </li>
  );
}

function CoverageDonut({ proxied, dnsOnly }: { proxied: number; dnsOnly: number }) {
  const total = proxied + dnsOnly;
  const size = 72;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const proxiedLength = total > 0 ? (proxied / total) * circumference : 0;
  const dnsOnlyLength = total > 0 ? (dnsOnly / total) * circumference : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
      role="img"
      aria-label={
        total > 0
          ? `${proxied} proxied, ${dnsOnly} DNS only`
          : 'No managed records'
      }
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-slate-200 dark:text-white/10"
      />
      {total > 0 && (
        <>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#14b8a6"
            strokeWidth={stroke}
            strokeDasharray={`${proxiedLength} ${circumference - proxiedLength}`}
            strokeLinecap="butt"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#2F6FED"
            strokeWidth={stroke}
            strokeDasharray={`${dnsOnlyLength} ${circumference - dnsOnlyLength}`}
            strokeDashoffset={-proxiedLength}
            strokeLinecap="butt"
          />
        </>
      )}
    </svg>
  );
}

function activityDetail(item: HistoryItem) {
  if (item.status === 'skipped') return 'No address change';
  if (item.status === 'success' && item.action === 'update') return 'Address synchronized';
  if (item.status === 'success' && item.action === 'check') return 'Record checked';
  if (item.status === 'failed') return 'Update failed';
  return item.action.replaceAll('-', ' ');
}
