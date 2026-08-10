import { Edit3, Plus, RefreshCw, Trash2, Unlink, Zap } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, type Account, type PublicIp, type RecordItem } from '../api';
import { CreateDnsRecordDialog } from '../components/dns';
import { useStrongAuth } from '../components/strong-auth';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageTitle,
  SelectField,
  formatDate,
  useToast
} from '../components/ui';

export function RecordsPage() {
  const toast = useToast();
  const { withStrongAuth } = useStrongAuth();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [publicIp, setPublicIp] = useState<PublicIp>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<RecordItem>();
  const [stop, setStop] = useState<RecordItem>();
  const [remove, setRemove] = useState<RecordItem>();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ddnsFilter, setDdnsFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const [proxySort, setProxySort] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ pageSize: '100' });
      const [recordResult, accountResult, detected] = await Promise.all([
        api
          .refreshRecordMetadata()
          .catch(() => undefined)
          .then(() => api.records(query)),
        api.accounts(),
        api.detectIp().catch(() => ({ ipv4: null, ipv6: null }))
      ]);
      setRecords(recordResult.records);
      setAccounts(accountResult.accounts);
      setPublicIp(detected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load DNS records');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const zones = accountFilter
    ? (accounts.find((account) => account.id === accountFilter)?.zoneItems ?? [])
    : accounts.flatMap((account) => account.zoneItems);
  const visible = useMemo(
    () =>
      records
        .filter(
          (record) =>
            (!accountFilter || record.accountId === accountFilter) &&
            (!zoneFilter || record.zoneId === zoneFilter) &&
            (!typeFilter || record.type === typeFilter) &&
            (!ddnsFilter || (ddnsFilter === 'on' ? record.enabled : !record.enabled)) &&
            (!statusFilter || record.status === statusFilter) &&
            (!proxyFilter || (proxyFilter === 'proxied' ? record.proxied : !record.proxied)) &&
            (!search ||
              `${record.name} ${record.zoneName} ${record.content}`
                .toLowerCase()
                .includes(search.toLowerCase()))
        )
        .sort((left, right) => {
          if (!proxySort || left.proxied === right.proxied) return 0;
          return proxySort === 'proxied-first' ? (left.proxied ? -1 : 1) : left.proxied ? 1 : -1;
        }),
    [
      records,
      accountFilter,
      zoneFilter,
      typeFilter,
      ddnsFilter,
      statusFilter,
      proxyFilter,
      proxySort,
      search
    ]
  );

  const run = async (record: RecordItem, action: 'check' | 'force' | 'toggle') => {
    setBusy(`${record.id}-${action}`);
    try {
      if (action === 'check') await api.checkRecord(record.id);
      if (action === 'force') await api.forceRecord(record.id);
      if (action === 'toggle') {
        const result = await api.toggleRecord(record.id, !record.enabled);
        setRecords((items) => items.map((item) => (item.id === record.id ? result.record : item)));
      }
      toast(
        action === 'toggle'
          ? `DDNS ${record.enabled ? 'disabled' : 'enabled'}.`
          : action === 'check'
            ? 'Record checked.'
            : 'Record force-updated.'
      );
      if (action !== 'toggle') await load();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Record action failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleProxy = async (record: RecordItem) => {
    const proxied = !record.proxied;
    setBusy(`${record.id}-proxy`);
    setRecords((items) =>
      items.map((item) => (item.id === record.id ? { ...item, proxied } : item))
    );
    try {
      const result = await api.updateRecord(record.id, { proxied });
      setRecords((items) => items.map((item) => (item.id === record.id ? result.record : item)));
      toast(`Proxy mode changed to ${proxied ? 'Proxied' : 'DNS Only'}.`);
    } catch (caught) {
      setRecords((items) => items.map((item) => (item.id === record.id ? record : item)));
      toast(caught instanceof Error ? caught.message : 'Could not change proxy mode', 'error');
    } finally {
      setBusy('');
    }
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setBusy('edit');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.updateRecord(editing.id, {
        name: String(form.get('hostname') ?? ''),
        proxied: form.get('proxy') === 'proxied',
        ttl: Number(form.get('ttl')),
        enabled: form.get('enabled') === 'on'
      });
      setRecords((items) => items.map((item) => (item.id === editing.id ? result.record : item)));
      setEditing(undefined);
      toast('Cloudflare record updated.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not update record', 'error');
    } finally {
      setBusy('');
    }
  };

  const stopManaging = async () => {
    if (!stop) return;
    setBusy('stop');
    try {
      await api.stopManagingRecord(stop.id);
      setRecords((items) => items.filter((item) => item.id !== stop.id));
      setStop(undefined);
      toast('Stopped managing record. The Cloudflare DNS record was not changed.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not stop managing record', 'error');
    } finally {
      setBusy('');
    }
  };

  const deleteFromCloudflare = async () => {
    if (!remove) return;
    setBusy('delete');
    try {
      await withStrongAuth(() => api.deleteCloudflareRecord(remove.id, confirmation));
      setRecords((items) => items.filter((item) => item.id !== remove.id));
      setRemove(undefined);
      setConfirmation('');
      toast('DNS record permanently deleted from Cloudflare.');
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Could not delete Cloudflare record',
        'error'
      );
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-7">
      <PageTitle
        eyebrow="DNS"
        title="DNS Records"
        description="Manage selected DDNS records across every Cloudflare account and zone."
        actions={
          <>
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Add DNS Record
            </Button>
          </>
        }
      />
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Hostname or IP"
        />
        <SelectField
          label="Account"
          value={accountFilter}
          onChange={(event) => {
            setAccountFilter(event.target.value);
            setZoneFilter('');
          }}
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Domain / Zone"
          value={zoneFilter}
          onChange={(event) => setZoneFilter(event.target.value)}
        >
          <option value="">All zones</option>
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">A and AAAA</option>
          <option>A</option>
          <option>AAAA</option>
        </SelectField>
        <SelectField
          label="DDNS"
          value={ddnsFilter}
          onChange={(event) => setDdnsFilter(event.target.value)}
        >
          <option value="">On and off</option>
          <option value="on">Enabled</option>
          <option value="off">Disabled</option>
        </SelectField>
        <SelectField
          label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="healthy">Synchronized</option>
          <option value="degraded">Needs update</option>
          <option value="error">Failed</option>
          <option value="disabled">Disabled</option>
        </SelectField>
        <SelectField
          label="Proxy"
          value={proxyFilter}
          onChange={(event) => setProxyFilter(event.target.value)}
        >
          <option value="">All</option>
          <option value="proxied">Proxied</option>
          <option value="dns-only">DNS Only</option>
        </SelectField>
        <SelectField
          label="Sort"
          value={proxySort}
          onChange={(event) => setProxySort(event.target.value)}
        >
          <option value="">Default order</option>
          <option value="proxied-first">Proxy Status: Proxied first</option>
          <option value="dns-only-first">Proxy Status: DNS Only first</option>
        </SelectField>
      </Card>
      {loading ? (
        <Loading label="Loading managed DNS records" />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : !visible.length ? (
        <Empty
          title="No matching managed records"
          message="Select existing Cloudflare records from a zone or create a new DNS record."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Add DNS Record
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="min-w-[1280px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr>
                <th className="p-4">Domain</th>
                <th className="p-4">Hostname</th>
                <th className="p-4">Type</th>
                <th className="p-4">Cloudflare IP</th>
                <th className="p-4">TTL</th>
                <th
                  className="p-4"
                  title="Proxied routes HTTP traffic through Cloudflare. DNS Only publishes the origin IP directly."
                >
                  Proxy
                </th>
                <th className="p-4">Status</th>
                <th className="p-4">Last Updated</th>
                <th className="p-4">DDNS</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="p-4">
                    <span className="block font-medium">{record.zoneName}</span>
                    <span className="text-xs text-slate-500">{record.accountName}</span>
                  </td>
                  <td className="p-4 font-medium">{record.name}</td>
                  <td className="p-4 font-mono">{record.type}</td>
                  <td className="p-4 font-mono text-xs">{record.content}</td>
                  <td className="p-4 font-mono text-xs">
                    {record.ttl === 1 ? 'Auto' : record.ttl}
                  </td>
                  <td className="p-4">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={record.proxied}
                      aria-label={`Set ${record.name} to ${record.proxied ? 'DNS Only' : 'Proxied'}`}
                      title={
                        record.proxied
                          ? 'Proxied: HTTP traffic is routed through Cloudflare. Click for DNS Only.'
                          : 'DNS Only: the origin IP is returned directly. Click to enable Cloudflare proxying.'
                      }
                      disabled={busy === `${record.id}-proxy`}
                      onClick={() => void toggleProxy(record)}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                        record.proxied
                          ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-950 dark:text-orange-300'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          record.proxied ? 'bg-orange-500' : 'border border-slate-400 bg-white'
                        }`}
                      />
                      {busy === `${record.id}-proxy`
                        ? 'Updating…'
                        : record.proxied
                          ? 'Proxied'
                          : 'DNS Only'}
                    </button>
                  </td>
                  <td className="p-4">
                    <Badge status={record.status} />
                  </td>
                  <td className="p-4 whitespace-nowrap text-xs text-slate-500">
                    {formatDate(record.lastUpdatedAt)}
                  </td>
                  <td className="p-4">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={record.enabled}
                      onClick={() => void run(record, 'toggle')}
                      className={`h-6 w-11 rounded-full p-1 ${record.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <span
                        className={`block h-4 w-4 rounded-full bg-white transition ${record.enabled ? 'translate-x-5' : ''}`}
                      />
                    </button>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        title="Check now"
                        busy={busy === `${record.id}-check`}
                        onClick={() => void run(record, 'check')}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        title="Force update"
                        busy={busy === `${record.id}-force`}
                        onClick={() => void run(record, 'force')}
                      >
                        <Zap className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" title="Edit" onClick={() => setEditing(record)}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" title="Stop managing" onClick={() => setStop(record)}>
                        <Unlink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        title="Delete from Cloudflare"
                        className="text-red-600"
                        onClick={() => setRemove(record)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateDnsRecordDialog
        open={createOpen}
        accounts={accounts}
        publicIp={publicIp}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => (await api.createRecord(input)).record}
        onManageExisting={async (input) => (await api.manageRecords([input])).records[0]}
        onCreated={(record) => setRecords((items) => [record, ...items])}
      />
      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(undefined)}
        title="Edit DNS Record"
        description="Cloudflare is updated before local state is committed. Record type cannot be changed."
      >
        {editing && (
          <form onSubmit={(event) => void saveEdit(event)} className="grid gap-4">
            <Field label="Hostname" name="hostname" defaultValue={editing.name} required />
            <SelectField label="TTL" name="ttl" defaultValue={editing.ttl}>
              <option value="1">Auto</option>
              <option value="60">1 minute</option>
              <option value="120">2 minutes</option>
              <option value="300">5 minutes</option>
              <option value="600">10 minutes</option>
              <option value="900">15 minutes</option>
              <option value="1800">30 minutes</option>
              <option value="3600">1 hour</option>
              <option value="7200">2 hours</option>
              <option value="18000">5 hours</option>
              <option value="43200">12 hours</option>
              <option value="86400">1 day</option>
            </SelectField>
            <SelectField
              label="Proxy"
              name="proxy"
              defaultValue={editing.proxied ? 'proxied' : 'dns-only'}
            >
              <option value="dns-only">DNS Only</option>
              <option value="proxied">Proxied</option>
            </SelectField>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={editing.enabled} />
              DDNS enabled
            </label>
            <p className="text-xs text-slate-500">
              Last checked: {formatDate(editing.lastCheckedAt)}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(undefined)}>
                Cancel
              </Button>
              <Button busy={busy === 'edit'}>Save changes</Button>
            </div>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(stop)}
        onClose={() => setStop(undefined)}
        title="Stop Managing"
        description="This removes the record from DDNS Manager. The Cloudflare DNS record will remain completely untouched."
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setStop(undefined)}>
            Cancel
          </Button>
          <Button busy={busy === 'stop'} onClick={() => void stopManaging()}>
            Stop Managing
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(remove)}
        onClose={() => {
          setRemove(undefined);
          setConfirmation('');
        }}
        title={`Delete ${remove?.name ?? 'record'} from Cloudflare?`}
        description="This permanently deletes the Cloudflare DNS record. This action cannot be undone."
      >
        {remove && (
          <div className="grid gap-4">
            <p className="text-sm">
              Type <strong>{remove.name}</strong> to confirm.
            </p>
            <Field
              label="Confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemove(undefined)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={confirmation !== remove.name}
                busy={busy === 'delete'}
                onClick={() => void deleteFromCloudflare()}
              >
                Delete from Cloudflare
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
