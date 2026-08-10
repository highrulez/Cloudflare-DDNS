import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  Edit3,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  api,
  detectionStatusText,
  type Account,
  type DetectionStatus,
  type DiscoveredRecord,
  type Zone,
  type ZoneDiscovery
} from '../api';
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
  MaskedValue,
  PageTitle,
  cx,
  useToast
} from '../components/ui';
import { safeRelativeTime } from '../utils/date';
import {
  accountConnectionLabel,
  filterZonesBySearch,
  summarizeAccounts,
  visibleZoneChips
} from './cloudflare-helpers';

export function CloudflarePage() {
  const toast = useToast();
  const { withStrongAuth } = useStrongAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [edit, setEdit] = useState<Account>();
  const [account, setAccount] = useState<Account>();
  const [zone, setZone] = useState<Zone>();
  const [discovery, setDiscovery] = useState<ZoneDiscovery>();
  const [selected, setSelected] = useState<Record<string, DiscoveredRecord>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [remove, setRemove] = useState<Account>();
  const [removeConfirm, setRemoveConfirm] = useState('');
  const [zoneSearch, setZoneSearch] = useState('');
  const [expandedZones, setExpandedZones] = useState<Record<string, boolean>>({});

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.accounts();
      setAccounts(result.accounts);
      if (account) setAccount(result.accounts.find((item) => item.id === account.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load Cloudflare accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
  }, []);

  const loadZone = async (selectedAccount: Account, selectedZone: Zone) => {
    setBusy('zone');
    setError('');
    setAccount(selectedAccount);
    setZone(selectedZone);
    setSelected({});
    try {
      setDiscovery(await api.zoneRecords(selectedAccount.id, selectedZone.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not discover DNS records');
    } finally {
      setBusy('');
    }
  };

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('connect');
    const form = new FormData(event.currentTarget);
    try {
      const result = await withStrongAuth(() =>
        api.addAccount({
          name: String(form.get('name') ?? ''),
          token: String(form.get('token') ?? '')
        })
      );
      setAccounts((items) => [...items, result.account]);
      setConnectOpen(false);
      toast('Cloudflare account connected and zones discovered.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not connect Cloudflare', 'error');
    } finally {
      setBusy('');
    }
  };

  const refresh = async (target?: Account) => {
    const current = target ?? account;
    if (!current) return;
    setBusy(target ? `refresh-${target.id}` : 'refresh');
    try {
      await api.syncAccount(current.id);
      await loadAccounts();
      if (zone && account?.id === current.id) {
        const refreshedAccount = (await api.accounts()).accounts.find(
          (item) => item.id === current.id
        );
        const refreshedZone = refreshedAccount?.zoneItems.find((item) => item.id === zone.id);
        if (refreshedAccount && refreshedZone) await loadZone(refreshedAccount, refreshedZone);
      }
      toast('Cloudflare zones and records refreshed.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Refresh failed', 'error');
    } finally {
      setBusy('');
    }
  };

  const manageSelected = async () => {
    if (!account || !zone) return;
    setBusy('manage');
    try {
      await api.manageRecords(
        Object.values(selected).map((record) => ({
          accountId: account.id,
          zoneId: zone.id,
          cloudflareRecordId: record.id,
          ddnsEnabled: true
        }))
      );
      await loadZone(account, zone);
      toast('Selected records are now managed by DDNS.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not manage records', 'error');
    } finally {
      setBusy('');
    }
  };

  const deleteAccount = async () => {
    if (!remove || removeConfirm !== 'DELETE') return;
    setBusy('delete');
    try {
      await withStrongAuth(() => api.deleteAccount(remove.id));
      setAccounts((items) => items.filter((item) => item.id !== remove.id));
      if (account?.id === remove.id) {
        setAccount(undefined);
        setZone(undefined);
        setDiscovery(undefined);
      }
      setRemove(undefined);
      setRemoveConfirm('');
      toast('Cloudflare account removed. Cloudflare DNS records were not changed.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not remove account', 'error');
    } finally {
      setBusy('');
    }
  };

  const updateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!edit) return;
    setBusy('edit');
    const form = new FormData(event.currentTarget);
    const token = String(form.get('token') ?? '');
    try {
      const payload = {
        name: String(form.get('name') ?? ''),
        ...(token ? { token } : {})
      };
      const result = await (token
        ? withStrongAuth(() => api.updateAccount(edit.id, payload))
        : api.updateAccount(edit.id, payload));
      setAccounts((items) => items.map((item) => (item.id === edit.id ? result.account : item)));
      if (account?.id === edit.id) setAccount(result.account);
      setEdit(undefined);
      toast('Cloudflare account updated and zones refreshed.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not update account', 'error');
    } finally {
      setBusy('');
    }
  };

  const summary = useMemo(() => summarizeAccounts(accounts), [accounts]);
  const filteredZones = useMemo(
    () => (account ? filterZonesBySearch(account.zoneItems, zoneSearch) : []),
    [account, zoneSearch]
  );

  if (loading && !accounts.length) {
    return <AccountsSkeleton />;
  }
  if (error && !accounts.length) {
    return <ErrorState message={error} retry={() => void loadAccounts()} />;
  }

  if (zone && account) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Button
          variant="ghost"
          className="min-h-9 px-2"
          onClick={() => {
            setZone(undefined);
            setDiscovery(undefined);
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to zones
        </Button>
        <PageTitle
          eyebrow={account.name}
          title={zone.name}
          description={`${zone.recordCount} A/AAAA records · ${zone.managedCount} DDNS managed`}
          actions={
            <>
              <Button variant="secondary" busy={busy === 'refresh'} onClick={() => void refresh()}>
                <RefreshCw className="h-4 w-4" />
                Refresh from Cloudflare
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add DNS Record
              </Button>
            </>
          }
        />
        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        )}
        {discovery && (
          <div className="grid gap-3 sm:grid-cols-2">
            <IpCard
              family="IPv4"
              value={discovery.publicIp.ipv4}
              status={discovery.publicIp.ipv4Status}
            />
            <IpCard
              family="IPv6"
              value={discovery.publicIp.ipv6}
              status={discovery.publicIp.ipv6Status}
            />
          </div>
        )}
        {busy === 'zone' ? (
          <RecordsSkeleton label="Retrieving A and AAAA records from Cloudflare" />
        ) : (
          <div className="ops-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-white/[0.06]">
                    {['Manage', 'Hostname', 'Type', 'Cloudflare IP', 'Detected IP', 'Status', 'Proxy'].map(
                      (label) => (
                        <th key={label} className="ops-eyebrow px-3 py-2.5 first:pl-4 last:pr-4">
                          {label}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {discovery?.items.map((record) => (
                    <tr
                      key={record.id}
                      className="border-t border-slate-100/90 transition-colors hover:bg-slate-50/80 dark:border-white/[0.04] dark:hover:bg-white/[0.025]"
                    >
                      <td className="px-3 py-3 first:pl-4">
                        {record.managed ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
                            <Check className="h-3.5 w-3.5" />
                            Managed
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`Select ${record.name}`}
                            checked={Boolean(selected[record.id])}
                            onChange={() =>
                              setSelected((current) => {
                                const next = { ...current };
                                if (next[record.id]) delete next[record.id];
                                else next[record.id] = record;
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-900 dark:text-slate-50">
                        {record.name}
                      </td>
                      <td className="ops-mono px-3 py-3 text-[12px]">{record.type}</td>
                      <td className="ops-mono px-3 py-3 text-[12px] text-slate-700 dark:text-slate-200">
                        {record.content}
                      </td>
                      <td className="ops-mono px-3 py-3 text-[12px] text-slate-500">
                        {record.detectedIp ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          status={
                            record.syncStatus === 'SYNCHRONIZED'
                              ? 'healthy'
                              : record.syncStatus === 'NEEDS_UPDATE'
                                ? 'warning'
                                : 'disabled'
                          }
                        >
                          {record.syncStatus.replaceAll('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-[12px] text-slate-600 dark:text-slate-300">
                        {record.proxied ? 'Proxied' : 'DNS only'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {Object.keys(selected).length > 0 && (
          <div className="sticky bottom-4 flex justify-end">
            <Button busy={busy === 'manage'} onClick={() => void manageSelected()}>
              Manage {Object.keys(selected).length} selected record
              {Object.keys(selected).length === 1 ? '' : 's'}
            </Button>
          </div>
        )}
        <CreateDnsRecordDialog
          open={createOpen}
          accounts={accounts}
          publicIp={discovery?.publicIp}
          initialAccountId={account.id}
          initialZoneId={zone.id}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => (await api.createRecord(input)).record}
          onManageExisting={async (input) => (await api.manageRecords([input])).records[0]}
          onCreated={() => void loadZone(account, zone)}
        />
      </div>
    );
  }

  if (account) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Button variant="ghost" className="min-h-9 px-2" onClick={() => setAccount(undefined)}>
          <ArrowLeft className="h-4 w-4" />
          Back to accounts
        </Button>
        <PageTitle
          eyebrow="Accessible Zones"
          title={account.name}
          description={`${account.zoneItems.length} zones available to this API token`}
          actions={
            <Button
              variant="secondary"
              busy={busy === 'refresh' || busy === `refresh-${account.id}`}
              onClick={() => void refresh(account)}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh zones
            </Button>
          }
        />
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            aria-label="Search zones"
            value={zoneSearch}
            onChange={(event) => setZoneSearch(event.target.value)}
            placeholder="Search zones…"
            className="h-9 w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-8 pr-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-900 dark:text-slate-100"
          />
        </div>
        {!account.zoneItems.length ? (
          <Empty
            title="No accessible zones"
            message="This API token does not currently expose any zones. Replace the token or refresh after updating Cloudflare permissions."
            action={
              <Button variant="secondary" onClick={() => setEdit(account)}>
                Replace token
              </Button>
            }
          />
        ) : !filteredZones.length ? (
          <Empty
            title="No zones match your search"
            message="Try a different zone name."
            action={
              <Button variant="secondary" onClick={() => setZoneSearch('')}>
                Clear search
              </Button>
            }
          />
        ) : (
          <div className="ops-panel overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-white/[0.06]">
                  <th className="ops-eyebrow px-4 py-2.5">Zone</th>
                  <th className="ops-eyebrow px-4 py-2.5">Records</th>
                  <th className="ops-eyebrow px-4 py-2.5">Managed</th>
                  <th className="ops-eyebrow px-4 py-2.5">Status</th>
                  <th className="ops-eyebrow px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredZones.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-100/90 transition-colors hover:bg-slate-50/80 dark:border-white/[0.04] dark:hover:bg-white/[0.025]"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-50">
                      {item.name}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                      {item.recordCount}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                      {item.managedCount}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={item.status === 'active' ? 'healthy' : 'degraded'}>
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        className="min-h-8"
                        onClick={() => void loadZone(account, item)}
                      >
                        View Records
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editDialog()}
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageTitle
        eyebrow="Provider"
        title="Cloudflare Accounts"
        description="Connect Cloudflare API credentials and manage accessible DNS zones."
        actions={
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Cloudflare Account
          </Button>
        }
      />

      {!loading && accounts.length > 0 && (
        <p className="text-[12px] text-slate-500 dark:text-slate-400">{summary.summary}</p>
      )}

      {!accounts.length ? (
        <Empty
          title="No Cloudflare accounts connected"
          message="Connect an API token to discover zones and begin managing DDNS records."
          action={
            <Button onClick={() => setConnectOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Cloudflare Account
            </Button>
          }
        />
      ) : (
        <div
          className={cx(
            'grid gap-4',
            accounts.length === 1 ? 'max-w-3xl' : 'lg:grid-cols-2'
          )}
        >
          {accounts.map((item) => {
            const chips = visibleZoneChips(item, expandedZones[item.id]);
            const verified = item.lastTestedAt
              ? safeRelativeTime(item.lastTestedAt)
              : null;
            return (
              <Card key={item.id} className="flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
                    <Cloud className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-50">
                        {item.name}
                      </h2>
                      <Badge status={item.status}>{accountConnectionLabel(item.status)}</Badge>
                    </div>
                    <p className="mt-0.5 text-[12px] text-slate-500">Cloudflare API</p>
                  </div>
                </div>

                {item.status === 'error' && (
                  <div className="mt-4 rounded-lg border border-rose-200/80 bg-rose-50/80 px-3 py-2.5 text-sm dark:border-rose-900/60 dark:bg-rose-950/30">
                    <p className="font-medium text-rose-700 dark:text-rose-300">
                      Connection issue
                    </p>
                    <p className="mt-1 text-[12px] text-rose-700/80 dark:text-rose-200/80">
                      Cloudflare authentication or API access failed for this connection.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3 min-h-8"
                      onClick={() => setEdit(item)}
                    >
                      Replace token
                    </Button>
                  </div>
                )}

                <div className="mt-4">
                  <p className="ops-eyebrow">API token</p>
                  <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">
                    <span className="ops-mono tracking-wider">••••••••••••••••</span>
                    <span className="ml-2 text-slate-500">Configured ({item.tokenHint})</span>
                  </p>
                </div>

                <div className="mt-4">
                  <p className="ops-eyebrow">Accessible zones</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-slate-50">
                    {item.zoneItems.length}
                  </p>
                  {!item.zoneItems.length ? (
                    <p className="mt-2 text-[12px] text-slate-500">No zones available to this token.</p>
                  ) : (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {chips.zones.map((zoneItem) => (
                        <span
                          key={zoneItem.id}
                          className="rounded-md border border-slate-200/80 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
                        >
                          {zoneItem.name}
                        </span>
                      ))}
                      {chips.remaining > 0 && (
                        <button
                          type="button"
                          className="rounded-md border border-slate-200/80 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/5 dark:border-white/10 dark:text-sky-300"
                          onClick={() =>
                            setExpandedZones((current) => ({ ...current, [item.id]: true }))
                          }
                        >
                          +{chips.remaining} more
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {verified && verified !== '—' && (
                  <p className="mt-4 text-[12px] text-slate-500">
                    Last verified <span className="text-slate-700 dark:text-slate-300">{verified}</span>
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                  <Button variant="secondary" className="min-h-9" onClick={() => setAccount(item)}>
                    View Zones
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-9 px-2.5"
                    aria-label={`Edit ${item.name}`}
                    title="Edit account"
                    onClick={() => setEdit(item)}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span className="text-[13px]">Edit</span>
                  </Button>
                  <AccountMenu
                    accountName={item.name}
                    busy={busy === `refresh-${item.id}`}
                    onRefresh={() => void refresh(item)}
                    onRemove={() => setRemove(item)}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Add Cloudflare Account"
        description="All zones accessible to this scoped API token will be discovered."
      >
        <form onSubmit={(event) => void connect(event)} className="grid gap-4">
          <Field label="Account name" name="name" placeholder="Example Cloudflare" required />
          <Field
            label="API token"
            name="token"
            type="password"
            autoComplete="off"
            required
          />
          <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
            <KeyRound className="mr-1.5 inline h-3.5 w-3.5 text-accent" aria-hidden />
            Requires Zone Read and DNS Edit permissions.
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConnectOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy === 'connect'}>Connect Account</Button>
          </div>
        </form>
      </Dialog>

      {editDialog()}

      <Dialog
        open={Boolean(remove)}
        onClose={() => {
          setRemove(undefined);
          setRemoveConfirm('');
        }}
        title="Remove Cloudflare connection?"
        description="This removes the Cloudflare account connection from DDNS Manager. It does not delete your Cloudflare account. Managed records must already be stopped. Cloudflare DNS records are never deleted by this action."
      >
        <div className="grid gap-4">
          <Field
            label="Type DELETE to confirm"
            name="confirmDelete"
            value={removeConfirm}
            onChange={(event) => setRemoveConfirm(event.target.value)}
            autoComplete="off"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRemove(undefined);
                setRemoveConfirm('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={busy === 'delete'}
              disabled={removeConfirm !== 'DELETE'}
              onClick={() => void deleteAccount()}
            >
              Delete connection
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );

  function editDialog() {
    return (
      <Dialog
        open={Boolean(edit)}
        onClose={() => setEdit(undefined)}
        title="Edit Cloudflare Account"
        description="The existing token cannot be viewed. Enter a new token to replace it, or leave blank to keep the current one."
      >
        {edit && (
          <form onSubmit={(event) => void updateAccount(event)} className="grid gap-4">
            <Field label="Account name" name="name" defaultValue={edit.name} required />
            <Field
              label="New API token"
              name="token"
              type="password"
              autoComplete="off"
              hint={`Currently configured (${edit.tokenHint}). Leave blank to keep it.`}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEdit(undefined)}>
                Cancel
              </Button>
              <Button busy={busy === 'edit'}>Save account</Button>
            </div>
          </form>
        )}
      </Dialog>
    );
  }
}

function AccountMenu({
  accountName,
  busy,
  onRefresh,
  onRemove
}: {
  accountName: string;
  busy?: boolean;
  onRefresh: () => void;
  onRemove: () => void;
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
    <div className="relative ml-auto" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        className="min-h-9 px-2"
        aria-label={`More actions for ${accountName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        busy={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-panel dark:border-white/10 dark:bg-console-850 dark:shadow-panel-dark"
        >
          <MenuItem
            onClick={() => {
              setOpen(false);
              onRefresh();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh zones
          </MenuItem>
          <div className="my-1 border-t border-slate-100 dark:border-white/[0.06]" />
          <MenuItem
            danger
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove connection
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      type="button"
      className={cx(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]',
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IpCard({
  family,
  value,
  status
}: {
  family: 'IPv4' | 'IPv6';
  value: string | null;
  status?: DetectionStatus;
}) {
  return (
    <Card className="p-4">
      <p className="ops-eyebrow">{family}</p>
      <div className="mt-2">
        <MaskedValue value={value} label={family} />
      </div>
      <p className="mt-1.5 text-[12px] text-slate-500">{detectionStatusText(status, family)}</p>
    </Card>
  );
}

function AccountsSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading Cloudflare accounts and zones">
      <div className="h-16 max-w-xl animate-pulse rounded-lg bg-slate-200/70 dark:bg-white/5" />
      <div className="grid max-w-3xl gap-4">
        <div className="ops-panel h-56 animate-pulse bg-slate-100/80 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}

function RecordsSkeleton({ label }: { label: string }) {
  return (
    <div className="ops-panel overflow-hidden" role="status" aria-label={label}>
      <div className="space-y-0 divide-y divide-slate-100 dark:divide-white/[0.04]">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <div className="h-4 flex-1 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
            <div className="h-4 w-20 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
