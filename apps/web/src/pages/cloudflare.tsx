import {
  ArrowLeft,
  Check,
  Cloud,
  Edit3,
  Eye,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
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
  Loading,
  PageTitle,
  useToast
} from '../components/ui';

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

  const refresh = async () => {
    if (!account) return;
    setBusy('refresh');
    try {
      await api.syncAccount(account.id);
      await loadAccounts();
      if (zone) {
        const refreshedAccount = (await api.accounts()).accounts.find(
          (item) => item.id === account.id
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
      setEdit(undefined);
      toast('Cloudflare account updated and zones refreshed.');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Could not update account', 'error');
    } finally {
      setBusy('');
    }
  };

  if (loading && !accounts.length) return <Loading label="Loading Cloudflare accounts and zones" />;
  if (error && !accounts.length)
    return <ErrorState message={error} retry={() => void loadAccounts()} />;

  if (zone && account)
    return (
      <div className="space-y-6">
        <Button
          variant="ghost"
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
          <Loading label="Retrieving A and AAAA records from Cloudflare" />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
                <tr>
                  <th className="p-4">Manage</th>
                  <th className="p-4">Hostname</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Cloudflare IP</th>
                  <th className="p-4">Detected IP</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Proxy</th>
                </tr>
              </thead>
              <tbody>
                {discovery?.items.map((record) => (
                  <tr key={record.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-4">
                      {record.managed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <Check className="h-4 w-4" />
                          Managed
                        </span>
                      ) : (
                        <input
                          type="checkbox"
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
                    <td className="p-4 font-medium">{record.name}</td>
                    <td className="p-4 font-mono">{record.type}</td>
                    <td className="p-4 font-mono text-xs">{record.content}</td>
                    <td className="p-4 font-mono text-xs">{record.detectedIp ?? 'Unavailable'}</td>
                    <td className="p-4">
                      <span
                        className={
                          record.syncStatus === 'SYNCHRONIZED'
                            ? 'text-emerald-600'
                            : record.syncStatus === 'NEEDS_UPDATE'
                              ? 'text-amber-600'
                              : 'text-slate-500'
                        }
                      >
                        {record.syncStatus.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4">{record.proxied ? 'Proxied' : 'DNS only'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
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

  if (account)
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setAccount(undefined)}>
          <ArrowLeft className="h-4 w-4" />
          Back to accounts
        </Button>
        <PageTitle
          eyebrow="Accessible Zones"
          title={account.name}
          description={`${account.zoneItems.length} zones available to this API token`}
          actions={
            <Button variant="secondary" busy={busy === 'refresh'} onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
              Refresh from Cloudflare
            </Button>
          }
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {account.zoneItems.map((item) => (
            <Card key={item.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold">{item.name}</h2>
                  <p className="text-xs text-slate-500">{item.status}</p>
                </div>
                <Badge status={item.status === 'active' ? 'healthy' : 'degraded'} />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">A/AAAA records</dt>
                  <dd className="font-bold">{item.recordCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">DDNS managed</dt>
                  <dd className="font-bold">{item.managedCount}</dd>
                </div>
              </dl>
              <Button
                className="mt-5 w-full"
                variant="secondary"
                onClick={() => void loadZone(account, item)}
              >
                <Eye className="h-4 w-4" />
                View Records
              </Button>
            </Card>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-7">
      <PageTitle
        eyebrow="Provider"
        title="Cloudflare Accounts"
        description="Connect multiple API tokens and manage every accessible zone."
        actions={
          <Button onClick={() => setConnectOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Cloudflare Account
          </Button>
        }
      />
      {!accounts.length ? (
        <Empty
          title="No Cloudflare accounts"
          message="Connect an API token to discover all accessible zones."
          action={
            <Button onClick={() => setConnectOpen(true)}>
              <Cloud className="h-4 w-4" />
              Connect Cloudflare
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((item) => (
            <Card key={item.id} className="p-6">
              <div className="flex items-start gap-4">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950">
                  <Cloud />
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold">{item.name}</h2>
                    <Badge status={item.status} />
                  </div>
                  <p className="text-sm text-slate-500">
                    API token •••••••••••••••• Configured ({item.tokenHint})
                  </p>
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                <span className="text-xs text-slate-500">Accessible Zones</span>
                <strong className="block text-2xl">{item.zoneItems.length}</strong>
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.zoneItems.slice(0, 4).map((zoneItem) => (
                    <span
                      key={zoneItem.id}
                      className="rounded bg-white px-2 py-1 text-xs dark:bg-slate-900"
                    >
                      {zoneItem.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setAccount(item)}>
                  <Eye className="h-4 w-4" />
                  View Zones
                </Button>
                <Button variant="ghost" title="Edit account" onClick={() => setEdit(item)}>
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" className="text-red-600" onClick={() => setRemove(item)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Add Cloudflare Account"
        description="All zones accessible to this scoped API token will be discovered."
      >
        <form onSubmit={(event) => void connect(event)} className="grid gap-4">
          <Field label="Account name" name="name" required />
          <Field label="Cloudflare API token" name="token" type="password" required />
          <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <KeyRound className="mr-2 inline h-4 w-4" />
            Requires Zone Read and DNS Edit.
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setConnectOpen(false)}>
              Cancel
            </Button>
            <Button busy={busy === 'connect'}>Connect account</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(edit)}
        onClose={() => setEdit(undefined)}
        title="Edit Cloudflare Account"
        description="Leave blank to keep the existing token. Enter a completely new token to replace it — existing tokens are never shown."
      >
        {edit && (
          <form onSubmit={(event) => void updateAccount(event)} className="grid gap-4">
            <Field label="Account name" name="name" defaultValue={edit.name} required />
            <Field
              label="Replace API token"
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
      <Dialog
        open={Boolean(remove)}
        onClose={() => {
          setRemove(undefined);
          setRemoveConfirm('');
        }}
        title="Remove Cloudflare Account?"
        description="This removes the connection from DDNS Manager. Managed records must already be stopped. Cloudflare DNS records are never deleted by this action."
      >
        <div className="grid gap-4">
          <Field
            label='Type DELETE to confirm'
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
      <span className="text-xs text-slate-500">{detectionStatusText(status, family)}</span>
      <strong className="mt-1 block font-mono">{value ?? '—'}</strong>
    </Card>
  );
}
