import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ApiError,
  type Account,
  type CreateDnsRecord,
  type PublicIp,
  type RecordItem
} from '../api';
import { Button, Dialog, Field, SelectField } from './ui';

const ttlOptions = [
  [1, 'Auto'],
  [60, '1 minute'],
  [120, '2 minutes'],
  [300, '5 minutes'],
  [600, '10 minutes'],
  [900, '15 minutes'],
  [1800, '30 minutes'],
  [3600, '1 hour'],
  [7200, '2 hours'],
  [18000, '5 hours'],
  [43200, '12 hours'],
  [86400, '1 day']
] as const;

type Duplicate = {
  record: { id: string; type: 'A' | 'AAAA'; name: string; content: string };
  accountId: string;
  zoneId: string;
};

export function CreateDnsRecordDialog({
  open,
  accounts,
  publicIp,
  initialAccountId,
  initialZoneId,
  onClose,
  onCreate,
  onManageExisting,
  onCreated
}: {
  open: boolean;
  accounts: Account[];
  publicIp?: PublicIp;
  initialAccountId?: string;
  initialZoneId?: string;
  onClose: () => void;
  onCreate: (input: CreateDnsRecord) => Promise<RecordItem>;
  onManageExisting: (input: {
    accountId: string;
    zoneId: string;
    cloudflareRecordId: string;
    ddnsEnabled: boolean;
  }) => Promise<RecordItem>;
  onCreated: (record: RecordItem) => void;
}) {
  const [accountId, setAccountId] = useState(initialAccountId ?? accounts[0]?.id ?? '');
  const zones = useMemo(
    () => accounts.find((account) => account.id === accountId)?.zoneItems ?? [],
    [accounts, accountId]
  );
  const [zoneId, setZoneId] = useState(initialZoneId ?? zones[0]?.id ?? '');
  const zone = zones.find((item) => item.id === zoneId);
  const [hostname, setHostname] = useState('');
  const [type, setType] = useState<'A' | 'AAAA'>('A');
  const [ipSource, setIpSource] = useState<CreateDnsRecord['ipSource']>('DETECTED_IPV4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<Duplicate>();
  useEffect(() => {
    if (!open) return;
    const nextAccount = initialAccountId || accountId || accounts[0]?.id || '';
    setAccountId(nextAccount);
    setZoneId(
      initialZoneId ??
        accounts.find((account) => account.id === nextAccount)?.zoneItems[0]?.id ??
        ''
    );
  }, [open, initialAccountId, initialZoneId, accounts]);
  const preview = !zone
    ? ''
    : hostname.trim() === '@'
      ? zone.name
      : hostname.includes('.')
        ? hostname
        : `${hostname || 'subdomain'}.${zone.name}`;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const record = await onCreate({
        accountId,
        zoneId,
        hostname,
        type,
        ipSource,
        customIp: ipSource === 'CUSTOM' ? String(form.get('customIp') ?? '') : undefined,
        proxied: form.get('proxy') === 'proxied',
        ttl: Number(form.get('ttl')),
        ddnsEnabled: form.get('ddnsEnabled') === 'on'
      });
      onCreated(record);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'DNS_RECORD_EXISTS') {
        setDuplicate(caught.details as Duplicate);
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not create DNS record');
      }
    } finally {
      setBusy(false);
    }
  };

  const manageDuplicate = async () => {
    if (!duplicate) return;
    setBusy(true);
    try {
      const record = await onManageExisting({
        accountId: duplicate.accountId,
        zoneId: duplicate.zoneId,
        cloudflareRecordId: duplicate.record.id,
        ddnsEnabled: true
      });
      onCreated(record);
      setDuplicate(undefined);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not manage existing record');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Add DNS Record"
        description="Create an A or AAAA record in Cloudflare and optionally manage it with DDNS."
      >
        <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700 sm:col-span-2 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </div>
          )}
          <SelectField
            label="Cloudflare account"
            value={accountId}
            onChange={(event) => {
              const next = event.target.value;
              setAccountId(next);
              setZoneId(accounts.find((account) => account.id === next)?.zoneItems[0]?.id ?? '');
            }}
            required
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
            required
          >
            <option value="">Select zone</option>
            {zones.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Hostname / subdomain"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="nas or @"
            hint={preview ? `Creates ${preview}` : 'Use @ for the root domain.'}
            required
          />
          <SelectField
            label="Record type"
            value={type}
            onChange={(event) => {
              const next = event.target.value as 'A' | 'AAAA';
              setType(next);
              setIpSource(next === 'A' ? 'DETECTED_IPV4' : 'DETECTED_IPV6');
            }}
          >
            <option value="A">A</option>
            <option value="AAAA">AAAA</option>
          </SelectField>
          <SelectField
            label="IP source"
            value={ipSource}
            onChange={(event) => setIpSource(event.target.value as CreateDnsRecord['ipSource'])}
          >
            {type === 'A' && (
              <option value="DETECTED_IPV4">
                Detected public IPv4 {publicIp?.ipv4 ? `(${publicIp.ipv4})` : '(detect on create)'}
              </option>
            )}
            {type === 'AAAA' && (
              <option value="DETECTED_IPV6">
                Detected public IPv6 {publicIp?.ipv6 ? `(${publicIp.ipv6})` : '(detect on create)'}
              </option>
            )}
            <option value="CUSTOM">Custom IP</option>
          </SelectField>
          {ipSource === 'CUSTOM' && (
            <Field
              label="Custom IP"
              name="customIp"
              placeholder={type === 'A' ? '192.0.2.10' : '2001:db8::10'}
              required
            />
          )}
          <SelectField label="TTL" name="ttl" defaultValue="1">
            {ttlOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Proxy" name="proxy" defaultValue="dns-only">
            <option value="dns-only">DNS Only</option>
            <option value="proxied">Proxied</option>
          </SelectField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ddnsEnabled" defaultChecked className="h-4 w-4" />
            Automatically manage this DNS record
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button busy={busy}>Create record</Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={Boolean(duplicate)}
        onClose={() => setDuplicate(undefined)}
        title="DNS record already exists"
        description="Cloudflare already has this record. No duplicate was created."
      >
        {duplicate && (
          <div className="rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-950">
            <strong>{duplicate.record.name}</strong>
            <span className="mt-1 block">
              {duplicate.record.type} · {duplicate.record.content}
            </span>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDuplicate(undefined)}>
            Cancel
          </Button>
          <Button busy={busy} onClick={() => void manageDuplicate()}>
            Manage Existing Record
          </Button>
        </div>
      </Dialog>
    </>
  );
}
