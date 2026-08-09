import { Copy, RefreshCw, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, detectionStatusText, type Dashboard, type DetectionStatus } from '../api';
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Loading,
  PageTitle,
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
  return (
    <div className="space-y-7">
      <PageTitle
        eyebrow="Overview"
        title="Dashboard"
        description="Public addresses and DDNS health across all accounts and zones."
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
      <div className="grid gap-4 lg:grid-cols-2">
        <IpCard family="IPv4" value={data.currentIp} status={data.ipv4Status} />
        <IpCard family="IPv6" value={data.currentIpv6} status={data.ipv6Status} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="DDNS enabled"
          value={data.enabledRecords}
          note={`${data.totalRecords} managed records`}
        />
        <Metric
          label="Synchronized"
          value={Math.max(0, data.enabledRecords - data.failedRecords)}
          note="Matching public IP"
        />
        <Metric label="Needs attention" value={data.failedRecords} note="Drifted or failed" />
        <Card className="p-5">
          <span className="text-sm text-slate-500">Overall status</span>
          <div className="mt-3">
            <Badge status={data.status} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Next check {formatDate(data.nextCheckAt)}</p>
        </Card>
      </div>
      <Card>
        <div className="border-b border-slate-200 p-5 dark:border-slate-800">
          <h2 className="font-bold">Recent DDNS activity</h2>
        </div>
        {!data.recentUpdates.length ? (
          <p className="p-6 text-sm text-slate-500">No update history yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.recentUpdates.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {item.recordName ?? item.action}
                  </strong>
                  <span className="text-xs text-slate-500">
                    {item.oldValue && item.newValue
                      ? `${item.oldValue} → ${item.newValue}`
                      : item.message}
                  </span>
                </div>
                <Badge status={item.status} />
                <time className="text-xs text-slate-500">{formatDate(item.createdAt)}</time>
              </div>
            ))}
          </div>
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

function IpCard({
  family,
  value,
  status
}: {
  family: 'IPv4' | 'IPv6';
  value?: string;
  status?: DetectionStatus;
}) {
  return (
    <Card className="bg-gradient-to-br from-slate-950 to-blue-950 p-6 text-white">
      <span className="text-sm text-blue-200">{detectionStatusText(status, family)}</span>
      <div className="mt-2 flex items-center gap-2">
        <strong className="break-all font-mono text-2xl">{value ?? '—'}</strong>
        {value && (
          <Button
            variant="ghost"
            aria-label={`Copy ${family}`}
            onClick={() => void navigator.clipboard.writeText(value)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}
function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <Card className="p-5">
      <span className="text-sm text-slate-500">{label}</span>
      <strong className="mt-2 block text-3xl">{value}</strong>
      <span className="text-xs text-slate-500">{note}</span>
    </Card>
  );
}
