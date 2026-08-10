import {
  Edit3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Unlink,
  Zap,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  PageTitle,
  SelectField,
  cx,
  formatDate,
  useToast
} from '../components/ui';
import { safeOperationalTimestamp } from '../utils/date';
import {
  filterAndSortRecords,
  summarizeRecords,
  truncateIp
} from './records-helpers';

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
  const [moreOpen, setMoreOpen] = useState(false);

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
      filterAndSortRecords(records, {
        accountFilter,
        zoneFilter,
        typeFilter,
        ddnsFilter,
        statusFilter,
        proxyFilter,
        proxySort,
        search
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
  const summary = useMemo(() => summarizeRecords(records), [records]);
  const filtersActive = Boolean(
    accountFilter ||
      zoneFilter ||
      typeFilter ||
      ddnsFilter ||
      statusFilter ||
      proxyFilter ||
      proxySort ||
      search
  );

  const clearFilters = () => {
    setAccountFilter('');
    setZoneFilter('');
    setTypeFilter('');
    setDdnsFilter('');
    setStatusFilter('');
    setProxyFilter('');
    setProxySort('');
    setSearch('');
  };

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

  const toolbarSelect =
    'h-9 min-w-[7.5rem] rounded-lg border border-slate-200/90 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-900 dark:text-slate-100';

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageTitle
        eyebrow="DNS Records"
        title="DNS Records"
        description="Manage your DNS records, DDNS settings, and synchronization."
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

      {!loading && !error && records.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400">
          <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
            {summary.managed} managed records
          </span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{summary.a} A</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{summary.aaaa} AAAA</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{summary.proxied} proxied</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{summary.dnsOnly} DNS only</span>
        </p>
      )}

      <Card className="p-3">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Account"
              className={toolbarSelect}
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
            </select>
            <select
              aria-label="Zone"
              className={toolbarSelect}
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
            >
              <option value="">All zones</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Type"
              className={cx(toolbarSelect, 'min-w-[6.5rem]')}
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">All types</option>
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
            </select>
            <select
              aria-label="Proxy"
              className={toolbarSelect}
              value={proxyFilter}
              onChange={(event) => setProxyFilter(event.target.value)}
            >
              <option value="">All proxy states</option>
              <option value="proxied">Proxied</option>
              <option value="dns-only">DNS only</option>
            </select>
            <select
              aria-label="DDNS"
              className={toolbarSelect}
              value={ddnsFilter}
              onChange={(event) => setDdnsFilter(event.target.value)}
            >
              <option value="">All DDNS states</option>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <label className="relative min-w-[12rem] flex-1 lg:max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                aria-label="Search records"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search records…"
                className="h-9 w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-8 pr-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-900 dark:text-slate-100"
              />
            </label>
            <div className="relative">
              <Button
                type="button"
                variant="secondary"
                className="min-h-9 px-2.5"
                aria-label="More filters and sort"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              {moreOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-label="Close filter menu"
                    onClick={() => setMoreOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-panel dark:border-white/10 dark:bg-console-850 dark:shadow-panel-dark">
                    <p className="ops-eyebrow mb-2">More filters</p>
                    <div className="grid gap-2">
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
                        label="Sort"
                        value={proxySort}
                        onChange={(event) => setProxySort(event.target.value)}
                      >
                        <option value="">Default order</option>
                        <option value="proxied-first">Proxied first</option>
                        <option value="dns-only-first">DNS only first</option>
                      </SelectField>
                    </div>
                    {filtersActive && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-2 w-full"
                        onClick={() => {
                          clearFilters();
                          setMoreOpen(false);
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
            {filtersActive && (
              <Button type="button" variant="ghost" className="min-h-9 px-2.5" onClick={clearFilters}>
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {loading ? (
        <RecordsSkeleton />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : !records.length ? (
        <Empty
          title="No records managed"
          message="Select existing Cloudflare records from a zone or create a new DNS record."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Add DNS Record
            </Button>
          }
        />
      ) : !visible.length ? (
        <Empty
          title="No records match your filters"
          message="Try adjusting account, zone, type, proxy, DDNS, or search."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="ops-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-white/[0.06]">
                  {[
                    'Hostname',
                    'Type',
                    'TTL',
                    'Proxy',
                    'DDNS',
                    'Cloudflare IP',
                    'Last update',
                    'Status',
                    'Actions'
                  ].map((label) => (
                    <th
                      key={label}
                      className={cx(
                        'ops-eyebrow whitespace-nowrap px-3 py-2.5 font-semibold first:pl-4 last:pr-4',
                        label === 'Actions' && 'text-right'
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => (
                  <tr
                    key={record.id}
                    className="border-t border-slate-100/90 transition-colors hover:bg-slate-50/80 dark:border-white/[0.04] dark:hover:bg-white/[0.025]"
                  >
                    <td className="max-w-[18rem] px-3 py-3 first:pl-4">
                      <div className="flex min-w-0 items-start gap-2">
                        <span
                          className={cx(
                            'mt-1.5 status-dot shrink-0',
                            record.status === 'healthy'
                              ? 'status-dot-live'
                              : record.status === 'error'
                                ? 'bg-red-500'
                                : record.status === 'disabled'
                                  ? 'bg-slate-400'
                                  : 'bg-amber-500'
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-50">
                            {record.name}
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-slate-500">
                            {record.zoneName}
                            {record.accountName ? ` · ${record.accountName}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="ops-mono text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                        {record.type}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {record.type === 'A' ? 'IPv4' : 'IPv6'}
                      </span>
                    </td>
                    <td className="ops-mono px-3 py-3 text-[12px] text-slate-600 dark:text-slate-300">
                      {record.ttl === 1 ? 'Auto' : record.ttl}
                    </td>
                    <td className="px-3 py-3">
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
                        className={cx(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] transition disabled:cursor-wait disabled:opacity-60',
                          record.proxied
                            ? 'bg-orange-500/10 text-orange-700 hover:bg-orange-500/15 dark:text-orange-300'
                            : 'bg-slate-500/10 text-slate-600 hover:bg-slate-500/15 dark:text-slate-300'
                        )}
                      >
                        <span
                          className={cx(
                            'status-dot',
                            record.proxied ? 'bg-orange-500' : 'bg-slate-400'
                          )}
                          aria-hidden
                        />
                        {busy === `${record.id}-proxy`
                          ? 'Updating…'
                          : record.proxied
                            ? 'Proxied'
                            : 'DNS only'}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={record.enabled}
                        aria-label={`${record.enabled ? 'Disable' : 'Enable'} DDNS for ${record.name}`}
                        disabled={busy === `${record.id}-toggle`}
                        onClick={() => void run(record, 'toggle')}
                        className={cx(
                          'relative h-5 w-9 rounded-full p-0.5 transition',
                          record.enabled ? 'bg-accent dark:bg-sky-500' : 'bg-slate-300 dark:bg-slate-600'
                        )}
                      >
                        <span
                          className={cx(
                            'block h-4 w-4 rounded-full bg-white shadow-sm transition',
                            record.enabled && 'translate-x-4'
                          )}
                        />
                      </button>
                    </td>
                    <td className="max-w-[12rem] px-3 py-3">
                      <span
                        className="ops-mono block truncate text-[12px] text-slate-700 dark:text-slate-200"
                        title={record.content}
                      >
                        {truncateIp(record.content)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <LastUpdate value={record.lastUpdatedAt} />
                    </td>
                    <td className="px-3 py-3">
                      <Badge status={record.status} />
                    </td>
                    <td className="px-3 py-3 pr-4">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconAction
                          label={`Check ${record.name}`}
                          busy={busy === `${record.id}-check`}
                          onClick={() => void run(record, 'check')}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </IconAction>
                        <IconAction
                          label={`Force update ${record.name}`}
                          busy={busy === `${record.id}-force`}
                          onClick={() => void run(record, 'force')}
                        >
                          <Zap className="h-3.5 w-3.5" />
                        </IconAction>
                        <IconAction label={`Edit ${record.name}`} onClick={() => setEditing(record)}>
                          <Edit3 className="h-3.5 w-3.5" />
                        </IconAction>
                        <RowMenu
                          recordName={record.name}
                          onStop={() => setStop(record)}
                          onDelete={() => setRemove(record)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function LastUpdate({ value }: { value?: string }) {
  const stamp = safeOperationalTimestamp(value);
  if (!stamp) {
    return <span className="text-[12px] text-slate-400">—</span>;
  }
  return (
    <div>
      <p className="ops-mono text-[12px] text-slate-700 dark:text-slate-200">{stamp.absolute}</p>
      <p className="text-[11px] text-slate-500">{stamp.relative}</p>
    </div>
  );
}

function IconAction({
  label,
  busy,
  onClick,
  children
}: {
  label: string;
  busy?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-8 px-2"
      aria-label={label}
      title={label}
      busy={busy}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function RowMenu({
  recordName,
  onStop,
  onDelete
}: {
  recordName: string;
  onStop: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        className="min-h-8 px-2"
        aria-label={`More actions for ${recordName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-panel dark:border-white/10 dark:bg-console-850 dark:shadow-panel-dark"
        >
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
            onClick={() => {
              setOpen(false);
              onStop();
            }}
          >
            <Unlink className="h-3.5 w-3.5" />
            Stop Managing
          </button>
          <div className="my-1 border-t border-slate-100 dark:border-white/[0.06]" />
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete from Cloudflare
          </button>
        </div>
      )}
    </div>
  );
}

function RecordsSkeleton() {
  return (
    <div className="ops-panel overflow-hidden" role="status" aria-label="Loading managed DNS records">
      <div className="space-y-0 divide-y divide-slate-100 dark:divide-white/[0.04]">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <div className="h-8 flex-1 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
            <div className="hidden h-4 w-12 animate-pulse rounded bg-slate-200/70 sm:block dark:bg-white/5" />
            <div className="hidden h-4 w-20 animate-pulse rounded bg-slate-200/70 md:block dark:bg-white/5" />
            <div className="h-4 w-16 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
