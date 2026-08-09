import { ArrowRight, Plus, RefreshCw, Wifi } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Account, type DiscoveredRecord, type PublicIp, type RecordItem } from '../api';
import { CreateDnsRecordDialog } from '../components/dns';
import { Button, Card, Field, Loading, SelectField, cx } from '../components/ui';

const steps = ['Administrator', 'Cloudflare', 'Choose DNS records', 'Schedule'];

export function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accountName, setAccountName] = useState('Main Cloudflare');
  const [token, setToken] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const zones = accounts.find((account) => account.id === accountId)?.zoneItems ?? [];
  const [zoneId, setZoneId] = useState('');
  const [discovery, setDiscovery] = useState<{ items: DiscoveredRecord[]; publicIp: PublicIp }>();
  const [selected, setSelected] = useState<
    Record<string, { accountId: string; zoneId: string; record: DiscoveredRecord }>
  >({});
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [interval, setIntervalMinutes] = useState('5');
  const [ipv4Enabled, setIpv4Enabled] = useState(true);
  const [ipv6Enabled, setIpv6Enabled] = useState(false);

  useEffect(() => {
    api
      .setupStatus()
      .then(async (status) => {
        if (!status.required) {
          navigate('/login', { replace: true });
          return;
        }
        setStep(Math.max(0, Math.min(3, status.currentStep - 1)));
        if (status.currentStep >= 3) {
          const result = await api.setupAccounts();
          setAccounts(result.accounts);
          const firstAccount = result.accounts[0];
          setAccountId(firstAccount?.id ?? '');
          setZoneId(firstAccount?.zoneItems[0]?.id ?? '');
        }
      })
      .catch((caught: Error) => setError(caught.message));
  }, [navigate]);

  useEffect(() => {
    if (step !== 2 || !accountId || !zoneId) return;
    setBusy(true);
    setError('');
    api
      .setupZoneRecords(accountId, zoneId)
      .then((result) => {
        setDiscovery({ items: result.items, publicIp: result.publicIp });
        if (result.publicIp.ipv6) setIpv6Enabled(true);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  }, [step, accountId, zoneId, refreshKey]);

  const publicIp = discovery?.publicIp;
  const selectedCount = Object.keys(selected).length;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (step === 0) await api.setupAdmin({ username, password });
      if (step === 1) {
        const result = await api.setupCloudflare({ name: accountName, token });
        const account: Account = {
          id: result.id,
          name: accountName,
          tokenHint: '',
          status: 'healthy',
          zones: result.zones.length,
          zoneItems: result.zones.map((zone) => ({
            id: zone.id,
            name: zone.name,
            cloudflareId: zone.cloudflareId,
            status: zone.status,
            recordCount: zone.recordCount,
            managedCount: 0
          }))
        };
        setAccounts([account]);
        setAccountId(account.id);
        setZoneId(account.zoneItems[0]?.id ?? '');
      }
      if (step === 2) {
        const records = Object.values(selected).map((item) => ({
          accountId: item.accountId,
          zoneId: item.zoneId,
          cloudflareRecordId: item.record.id,
          ddnsEnabled: true
        }));
        if (!records.length)
          throw new Error('Select at least one A or AAAA record, or create a new record.');
        await api.setupManageRecords(records);
      }
      if (step === 3) {
        await api.setupSettings(Number(interval), ipv4Enabled, ipv6Enabled);
        await api.completeSetup();
        navigate('/login', { replace: true });
        return;
      }
      setStep((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (record: DiscoveredRecord) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[record.id]) delete next[record.id];
      else next[record.id] = { accountId, zoneId, record };
      return next;
    });
  };

  const onCreated = (record: RecordItem) => {
    setSelected((current) => ({
      ...current,
      [record.cloudflareRecordId ?? record.id]: {
        accountId: record.accountId,
        zoneId: record.zoneId,
        record: {
          id: record.cloudflareRecordId ?? record.id,
          type: record.type,
          name: record.name,
          content: record.content,
          proxied: record.proxied,
          ttl: record.ttl,
          managed: true,
          managedRecordId: record.id,
          ddnsEnabled: record.enabled,
          detectedIp: record.content,
          syncStatus: 'SYNCHRONIZED'
        }
      }
    }));
    setRefreshKey((current) => current + 1);
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white">
            <Wifi />
          </span>
          <div>
            <strong>Cloudflare DDNS</strong>
            <span className="block text-xs text-slate-500">First-time setup</span>
          </div>
        </div>
        <div className="mb-7 grid grid-cols-4 gap-2">
          {steps.map((label, index) => (
            <div key={label}>
              <div
                className={cx(
                  'h-1.5 rounded-full',
                  index <= step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-800'
                )}
              />
              <span className="mt-2 hidden text-xs sm:block">
                {index + 1}. {label}
              </span>
            </div>
          ))}
        </div>
        <Card className="p-6 sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">
            Step {step + 1} of 4
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            {
              [
                'Create your administrator',
                'Connect Cloudflare',
                'Choose DNS Records',
                'Set the update schedule'
              ][step]
            }
          </h1>
          {error && (
            <div
              role="alert"
              className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </div>
          )}
          <form onSubmit={(event) => void submit(event)} className="mt-7 grid gap-5">
            {step === 0 && (
              <>
                <Field
                  label="Username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <Field
                  label="Password"
                  type="password"
                  minLength={12}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </>
            )}
            {step === 1 && (
              <>
                <Field
                  label="Account name"
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  required
                />
                <Field
                  label="Cloudflare API token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                  hint="Requires Zone Read and DNS Edit. Stored encrypted."
                />
              </>
            )}
            {step === 2 && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField
                    label="Cloudflare account"
                    value={accountId}
                    onChange={(event) => {
                      setAccountId(event.target.value);
                      setZoneId(
                        accounts.find((account) => account.id === event.target.value)?.zoneItems[0]
                          ?.id ?? ''
                      );
                    }}
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Zone"
                    value={zoneId}
                    onChange={(event) => setZoneId(event.target.value)}
                  >
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <IpCard label="Detected IPv4" value={publicIp?.ipv4} />
                  <IpCard label="Detected IPv6" value={publicIp?.ipv6} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-500">
                    {selectedCount} record{selectedCount === 1 ? '' : 's'} selected across zones
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setRefreshKey((current) => current + 1)}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </Button>
                    <Button type="button" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" />
                      Create New DNS Record
                    </Button>
                  </div>
                </div>
                {busy && !discovery ? (
                  <Loading label="Discovering Cloudflare records and public IPs" />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
                        <tr>
                          <th className="p-3">Manage</th>
                          <th className="p-3">Hostname</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Cloudflare IP</th>
                          <th className="p-3">Public IP</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {discovery?.items.map((record) => (
                          <tr
                            key={record.id}
                            className="border-t border-slate-100 dark:border-slate-800"
                          >
                            <td className="p-3">
                              <input
                                type="checkbox"
                                checked={Boolean(selected[record.id]) || record.managed}
                                disabled={record.managed}
                                onChange={() => toggle(record)}
                              />
                            </td>
                            <td className="p-3 font-medium">{record.name}</td>
                            <td className="p-3">{record.type}</td>
                            <td className="p-3 font-mono text-xs">{record.content}</td>
                            <td className="p-3 font-mono text-xs">
                              {record.detectedIp ?? 'Unavailable'}
                            </td>
                            <td className="p-3">
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <SelectField
                  label="Check interval"
                  value={interval}
                  onChange={(event) => setIntervalMinutes(event.target.value)}
                >
                  <option value="1">Every minute</option>
                  <option value="5">Every 5 minutes</option>
                  <option value="10">Every 10 minutes</option>
                  <option value="30">Every 30 minutes</option>
                  <option value="60">Every hour</option>
                </SelectField>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ipv4Enabled}
                    onChange={(event) => setIpv4Enabled(event.target.checked)}
                  />
                  Detect IPv4 and manage A records
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ipv6Enabled}
                    onChange={(event) => setIpv6Enabled(event.target.checked)}
                  />
                  Detect IPv6 and manage AAAA records
                </label>
              </>
            )}
            <div className="mt-2 flex justify-end">
              <Button busy={busy}>
                {step === 3
                  ? 'Finish setup'
                  : step === 2
                    ? `Manage ${selectedCount} record${selectedCount === 1 ? '' : 's'}`
                    : 'Continue'}{' '}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </Card>
      </div>
      <CreateDnsRecordDialog
        open={createOpen}
        accounts={accounts}
        publicIp={publicIp}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => mapSetupRecord(await api.setupCreateRecord(input), accounts)}
        onManageExisting={async (input) =>
          mapSetupRecord((await api.setupManageRecords([input])).items[0], accounts)
        }
        onCreated={onCreated}
      />
    </div>
  );
}

function IpCard({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-xl bg-slate-950 p-4 text-white">
      <span className="text-xs text-slate-400">{label}</span>
      <strong className="mt-1 block font-mono">
        {value ?? (label.includes('IPv6') ? 'IPv6 not available' : 'Not detected')}
      </strong>
    </div>
  );
}

function mapSetupRecord(record: RecordItem, accounts: Account[]) {
  const account = accounts.find((item) => item.id === record.accountId);
  return {
    ...record,
    accountName: account?.name,
    zoneName: account?.zoneItems.find((zone) => zone.id === record.zoneId)?.name ?? record.zoneName
  };
}
