import { AlertTriangle, ArrowRight, Check, Cloud, Copy, Edit3, Eye, EyeOff, Globe2, KeyRound, Plus, RefreshCw, Save, ShieldCheck, Trash2, Wifi, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, type Account, type Dashboard, type HistoryItem, type RecordItem, type Settings } from './api';
import { useAuth } from './auth';
import { Badge, Button, Card, Dialog, Empty, ErrorState, Field, Loading, PageTitle, SelectField, cx, formatDate, useToast } from './components/ui';

function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true); setError('');
    loader().then(setData).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, [loader]);
  useEffect(load, [load]);
  return { data, setData, loading, error, reload: load };
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { await login(String(form.get('email')), String(form.get('password'))); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-950"><Loading label="Restoring session" /></div>;
  if (user) return <Navigate to="/" replace />;
  return <div className="relative grid min-h-screen overflow-hidden bg-slate-950 px-4 py-10 text-white lg:grid-cols-2">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,.25),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(6,182,212,.16),transparent_30%)]" />
    <div className="relative hidden items-center justify-center p-12 lg:flex"><div className="max-w-lg"><div className="mb-8 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500 shadow-lg shadow-blue-500/30"><Wifi /></div><p className="text-sm font-bold uppercase tracking-[.2em] text-blue-300">Cloudflare DDNS Manager</p><h1 className="mt-4 text-5xl font-bold leading-tight">Your DNS, always pointing home.</h1><p className="mt-5 text-lg leading-relaxed text-slate-300">Monitor public IP changes and keep every Cloudflare record synchronized from one secure control plane.</p><div className="mt-10 grid grid-cols-3 gap-4 text-sm"><Feature icon={<Zap />} title="Automatic" /><Feature icon={<ShieldCheck />} title="Secure" /><Feature icon={<Globe2 />} title="Observable" /></div></div></div>
    <div className="relative flex items-center justify-center"><Card className="w-full max-w-md border-white/10 bg-white p-7 text-slate-950 sm:p-9 dark:bg-slate-900 dark:text-white"><div className="mb-7"><span className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white lg:hidden"><Wifi /></span><h2 className="text-2xl font-bold">Welcome back</h2><p className="mt-1 text-sm text-slate-500">Sign in to manage your dynamic DNS.</p></div>{error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</div>}<form onSubmit={(e) => void submit(e)} className="grid gap-5"><Field label="Email address" name="email" type="email" autoComplete="email" required placeholder="admin@example.com" /><div className="relative"><Field label="Password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required className="pr-11" /><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} className="absolute bottom-2 right-2 rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><Button busy={busy} className="w-full">Sign in <ArrowRight className="h-4 w-4" /></Button></form></Card></div>
  </div>;
}
function Feature({ icon, title }: { icon: ReactNode; title: string }) { return <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-slate-200">{icon}<strong className="mt-3 block">{title}</strong></div>; }

const setupSteps = ['Administrator', 'Cloudflare', 'DNS records', 'Schedule'];
export function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState({ displayName: '', email: '', password: '', accountName: 'Primary account', token: '', zone: '', records: '', interval: '5' });
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payloads = [
        { displayName: data.displayName, email: data.email, password: data.password },
        { name: data.accountName, token: data.token },
        { zone: data.zone, records: data.records.split(',').map((v) => v.trim()).filter(Boolean) },
        { checkIntervalMinutes: Number(data.interval), updateOnStartup: true }
      ];
      const result = await api.setup(step + 1, payloads[step]);
      if (result.complete || step === 3) navigate('/login', { replace: true }); else setStep(step + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950 dark:text-white"><div className="mx-auto max-w-3xl"><div className="mb-8 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><Wifi /></span><div><strong>Cloudflare DDNS</strong><span className="block text-xs text-slate-500">First-time setup</span></div></div><div className="mb-7 grid grid-cols-4 gap-2" aria-label="Setup progress">{setupSteps.map((label, index) => <div key={label}><div className={cx('h-1.5 rounded-full', index <= step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-800')} /><span className={cx('mt-2 hidden text-xs sm:block', index === step ? 'font-bold text-blue-600' : 'text-slate-500')}>{index + 1}. {label}</span></div>)}</div><Card className="p-6 sm:p-9"><p className="text-xs font-bold uppercase tracking-[.16em] text-blue-600">Step {step + 1} of 4</p><h1 className="mt-2 text-2xl font-bold">{['Create your administrator', 'Connect Cloudflare', 'Choose DNS records', 'Set the update schedule'][step]}</h1><p className="mt-1 text-sm text-slate-500">{['This account controls access to the manager.', 'Use a scoped API token with Zone:DNS Edit permission.', 'Enter the zone and records you want to keep updated.', 'Choose how often the manager checks your public IP.'][step]}</p>{error && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</div>}<form onSubmit={(e) => void submit(e)} className="mt-7 grid gap-5">{step === 0 && <><Field label="Display name" value={data.displayName} onChange={(e) => setData({ ...data, displayName: e.target.value })} required /><Field label="Email address" type="email" value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} required /><Field label="Password" type="password" minLength={12} hint="At least 12 characters." value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} required /></>}{step === 1 && <><Field label="Account name" value={data.accountName} onChange={(e) => setData({ ...data, accountName: e.target.value })} required /><Field label="Cloudflare API token" type="password" value={data.token} onChange={(e) => setData({ ...data, token: e.target.value })} required hint="Stored encrypted and never shown again." /></>}{step === 2 && <><Field label="Zone" placeholder="example.com" value={data.zone} onChange={(e) => setData({ ...data, zone: e.target.value })} required /><Field label="Record names" placeholder="home, vpn, example.com" hint="Separate multiple records with commas." value={data.records} onChange={(e) => setData({ ...data, records: e.target.value })} required /></>}{step === 3 && <SelectField label="Check interval" value={data.interval} onChange={(e) => setData({ ...data, interval: e.target.value })}><option value="1">Every minute</option><option value="5">Every 5 minutes</option><option value="10">Every 10 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option></SelectField>}<div className="mt-2 flex justify-between"><Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button><Button busy={busy}>{step === 3 ? 'Finish setup' : 'Continue'} <ArrowRight className="h-4 w-4" /></Button></div></form></Card></div></div>;
}

const dashboardLoad = () => api.dashboard();
export function DashboardPage() {
  const state = useLoad<Dashboard>(dashboardLoad);
  const toast = useToast();
  const [confirm, setConfirm] = useState<'check' | 'force'>();
  const run = async () => {
    if (!confirm) return;
    try { confirm === 'check' ? await api.checkAll() : await api.forceAll(); toast(confirm === 'check' ? 'Global check started.' : 'Force update started.'); setConfirm(undefined); window.setTimeout(state.reload, 1000); } catch (e) { toast((e as Error).message, 'error'); }
  };
  if (state.loading) return <Loading label="Loading dashboard" />;
  if (state.error || !state.data) return <ErrorState message={state.error || 'No dashboard data'} retry={state.reload} />;
  const d = state.data;
  return <div className="space-y-7"><PageTitle eyebrow="Overview" title="Dashboard" description="Live status for your public IP and managed DNS records." actions={<><Button variant="secondary" onClick={() => setConfirm('check')}><RefreshCw className="h-4 w-4" />Check now</Button><Button onClick={() => setConfirm('force')}><Zap className="h-4 w-4" />Force update</Button></>} /><Card className="overflow-hidden bg-gradient-to-br from-slate-950 to-blue-950 p-6 text-white sm:p-8"><div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-center"><div><p className="text-sm text-blue-200">Current public IPv4</p><div className="mt-2 flex flex-wrap items-center gap-3"><strong className="font-mono text-3xl sm:text-4xl">{d.currentIp ?? 'Not detected'}</strong><Button variant="ghost" aria-label="Copy IP address" className="min-h-8 p-2 text-slate-300" onClick={() => d.currentIp && navigator.clipboard.writeText(d.currentIp)}><Copy className="h-4 w-4" /></Button></div><p className="mt-3 text-sm text-slate-400">Last checked {formatDate(d.lastCheckedAt)}</p></div><div className="rounded-xl border border-white/10 bg-white/10 p-4"><Badge status={d.status} /><p className="mt-2 text-sm text-slate-300">Next check {formatDate(d.nextCheckAt)}</p></div></div></Card><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Enabled records" value={d.enabledRecords} note={`${d.totalRecords} total`} /><Metric label="Healthy" value={Math.max(0, d.enabledRecords - d.failedRecords)} note="In sync" good /><Metric label="Attention needed" value={d.failedRecords} note="Failed checks" bad={d.failedRecords > 0} /><Metric label="Last IP change" value={d.lastChangedAt ? formatDate(d.lastChangedAt) : 'Never'} note="Observed change" compact /></div><Card><div className="border-b border-slate-200 p-5 dark:border-slate-800"><h2 className="font-bold">Recent updates</h2><p className="text-sm text-slate-500">Latest DDNS activity across all records.</p></div><HistoryRows items={d.recentUpdates} /></Card><Dialog open={!!confirm} onClose={() => setConfirm(undefined)} title={confirm === 'force' ? 'Force update all records?' : 'Check all records now?'} description={confirm === 'force' ? 'This writes the current public IP to every enabled record, even if no change is detected.' : 'This checks the current public IP and updates records only when necessary.'}><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirm(undefined)}>Cancel</Button><Button variant={confirm === 'force' ? 'danger' : 'primary'} onClick={() => void run()}>{confirm === 'force' ? 'Force update' : 'Start check'}</Button></div></Dialog></div>;
}
function Metric({ label, value, note, good, bad, compact }: { label: string; value: ReactNode; note: string; good?: boolean; bad?: boolean; compact?: boolean }) { return <Card className="p-5"><p className="text-sm text-slate-500">{label}</p><strong className={cx('mt-2 block', compact ? 'text-lg' : 'text-3xl', good && 'text-emerald-600', bad && 'text-red-600')}>{value}</strong><p className="mt-1 text-xs text-slate-500">{note}</p></Card>; }

function HistoryRows({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <Empty title="No updates yet" message="Update activity will appear here after the first check." />;
  return <div className="divide-y divide-slate-100 dark:divide-slate-800">{items.map((item) => <div key={item.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"><span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', item.status === 'success' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950' : item.status === 'failed' ? 'bg-red-100 text-red-600 dark:bg-red-950' : 'bg-slate-100 text-slate-500 dark:bg-slate-800')}>{item.status === 'success' ? <Check className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.recordName ?? item.action.replace('-', ' ')}</strong><p className="truncate text-xs text-slate-500">{item.message ?? [item.oldValue, item.newValue].filter(Boolean).join(' → ')}</p></div><Badge status={item.status} /><time className="text-xs text-slate-500">{formatDate(item.createdAt)}</time></div>)}</div>;
}

const recordsLoad = async () => (await api.records()).records;
const blankRecord = { zoneId: '', zoneName: '', type: 'A' as const, name: '', content: '', ttl: 1, proxied: false, enabled: true };
export function RecordsPage() {
  const state = useLoad<RecordItem[]>(recordsLoad);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<Partial<RecordItem>>();
  const [remove, setRemove] = useState<RecordItem>();
  const [busy, setBusy] = useState('');
  const visible = useMemo(() => (state.data ?? []).filter((record) => `${record.name} ${record.zoneName} ${record.content}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || (status === 'enabled' ? record.enabled : record.status === status))), [state.data, query, status]);
  const action = async (record: RecordItem, kind: 'toggle' | 'check' | 'force') => {
    setBusy(`${record.id}-${kind}`);
    try {
      if (kind === 'toggle') {
        const { record: updated } = await api.toggleRecord(record.id, !record.enabled);
        state.setData(state.data?.map((item) => item.id === record.id ? updated : item));
        toast(`Record ${updated.enabled ? 'enabled' : 'disabled'}.`);
      } else {
        kind === 'check' ? await api.checkRecord(record.id) : await api.forceRecord(record.id);
        toast(kind === 'check' ? 'Record check started.' : 'Record update started.');
      }
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('save');
    try {
      const form = new FormData(event.currentTarget);
      const value = { zoneId: String(form.get('zoneId')), zoneName: String(form.get('zoneName')), type: String(form.get('type')) as 'A' | 'AAAA', name: String(form.get('name')), content: String(form.get('content')), ttl: Number(form.get('ttl')), proxied: form.get('proxied') === 'on', enabled: form.get('enabled') === 'on' };
      if (editing?.id) {
        const { record } = await api.updateRecord(editing.id, value);
        state.setData(state.data?.map((item) => item.id === record.id ? record : item));
      } else {
        const { record } = await api.createRecord(value);
        state.setData([record, ...(state.data ?? [])]);
      }
      setEditing(undefined); toast(editing?.id ? 'Record updated.' : 'Record added.');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const confirmDelete = async () => {
    if (!remove) return; setBusy('delete');
    try { await api.deleteRecord(remove.id); state.setData(state.data?.filter((item) => item.id !== remove.id)); setRemove(undefined); toast('Record deleted.'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  return <div className="space-y-7"><PageTitle eyebrow="DNS" title="DNS Records" description="Manage the Cloudflare records that follow your public IP." actions={<Button onClick={() => setEditing(blankRecord)}><Plus className="h-4 w-4" />Add record</Button>} /><div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row dark:border-slate-800 dark:bg-slate-900"><Field label="Search records" aria-label="Search records" placeholder="Name, zone, or IP…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:w-72" /><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="healthy">Healthy</option><option value="error">Error</option><option value="disabled">Disabled</option></SelectField></div>{state.loading ? <Loading label="Loading DNS records" /> : state.error ? <ErrorState message={state.error} retry={state.reload} /> : !visible.length ? <Empty title="No records found" message={query ? 'Adjust your search or filters.' : 'Add an A or AAAA record to start dynamic updates.'} action={!query && <Button onClick={() => setEditing(blankRecord)}><Plus className="h-4 w-4" />Add record</Button>} /> : <><div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/60"><tr><th className="px-5 py-3">Record</th><th className="px-5 py-3">Value</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Last checked</th><th className="px-5 py-3">DDNS</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{visible.map((record) => <tr key={record.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="rounded-md bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{record.type}</span><div><strong>{record.name}</strong><span className="block text-xs text-slate-500">{record.zoneName}</span></div></div></td><td className="px-5 py-4 font-mono text-xs">{record.content}</td><td className="px-5 py-4"><Badge status={record.enabled ? record.status : 'disabled'} /></td><td className="px-5 py-4 text-xs text-slate-500">{formatDate(record.lastCheckedAt)}</td><td className="px-5 py-4"><Toggle checked={record.enabled} label={`${record.enabled ? 'Disable' : 'Enable'} ${record.name}`} disabled={busy.startsWith(record.id)} onChange={() => void action(record, 'toggle')} /></td><td className="px-5 py-4"><RecordActions record={record} busy={busy} onAction={action} onEdit={() => setEditing(record)} onDelete={() => setRemove(record)} /></td></tr>)}</tbody></table></div><div className="grid gap-3 lg:hidden">{visible.map((record) => <Card key={record.id} className="p-4"><div className="flex items-start justify-between"><div className="flex gap-3"><span className="rounded-md bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{record.type}</span><div><strong className="block">{record.name}</strong><span className="text-xs text-slate-500">{record.zoneName}</span></div></div><Badge status={record.enabled ? record.status : 'disabled'} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-slate-500">Value</dt><dd className="mt-1 truncate font-mono">{record.content}</dd></div><div><dt className="text-slate-500">Last checked</dt><dd className="mt-1">{formatDate(record.lastCheckedAt)}</dd></div></dl><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800"><Toggle checked={record.enabled} label={`Toggle ${record.name}`} onChange={() => void action(record, 'toggle')} /><RecordActions record={record} busy={busy} onAction={action} onEdit={() => setEditing(record)} onDelete={() => setRemove(record)} /></div></Card>)}</div></>}<Dialog open={!!editing} onClose={() => setEditing(undefined)} title={editing?.id ? 'Edit DNS record' : 'Add DNS record'} description="Only A and AAAA records can receive dynamic IP updates."><RecordForm value={editing} busy={busy === 'save'} onSubmit={save} onCancel={() => setEditing(undefined)} /></Dialog><Dialog open={!!remove} onClose={() => setRemove(undefined)} title="Delete DNS record?" description={`${remove?.name ?? 'This record'} will be removed from Cloudflare and this manager. This cannot be undone.`}><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRemove(undefined)}>Cancel</Button><Button variant="danger" busy={busy === 'delete'} onClick={() => void confirmDelete()}><Trash2 className="h-4 w-4" />Delete record</Button></div></Dialog></div>;
}
function Toggle({ checked, label, disabled, onChange }: { checked: boolean; label: string; disabled?: boolean; onChange: () => void }) { return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className={cx('relative h-6 w-11 rounded-full transition focus:ring-2 focus:ring-blue-500 disabled:opacity-50', checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700')}><span className={cx('absolute top-1 h-4 w-4 rounded-full bg-white transition', checked ? 'left-6' : 'left-1')} /></button>; }
function RecordActions({ record, busy, onAction, onEdit, onDelete }: { record: RecordItem; busy: string; onAction: (record: RecordItem, action: 'toggle' | 'check' | 'force') => void; onEdit: () => void; onDelete: () => void }) { return <div className="flex justify-end gap-1"><Button aria-label={`Check ${record.name}`} title="Check now" variant="ghost" className="min-h-9 px-2" busy={busy === `${record.id}-check`} onClick={() => onAction(record, 'check')}><RefreshCw className="h-4 w-4" /></Button><Button aria-label={`Force update ${record.name}`} title="Force update" variant="ghost" className="min-h-9 px-2" busy={busy === `${record.id}-force`} onClick={() => onAction(record, 'force')}><Zap className="h-4 w-4" /></Button><Button aria-label={`Edit ${record.name}`} variant="ghost" className="min-h-9 px-2" onClick={onEdit}><Edit3 className="h-4 w-4" /></Button><Button aria-label={`Delete ${record.name}`} variant="ghost" className="min-h-9 px-2 text-red-600" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button></div>; }
function RecordForm({ value, busy, onSubmit, onCancel }: { value?: Partial<RecordItem>; busy: boolean; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) { return <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2"><Field label="Zone ID" name="zoneId" defaultValue={value?.zoneId} required /><Field label="Zone name" name="zoneName" placeholder="example.com" defaultValue={value?.zoneName} required /><SelectField label="Record type" name="type" defaultValue={value?.type ?? 'A'}><option>A</option><option>AAAA</option></SelectField><Field label="Record name" name="name" placeholder="home.example.com" defaultValue={value?.name} required /><Field label="IP address" name="content" defaultValue={value?.content} required /><Field label="TTL" name="ttl" type="number" min={1} defaultValue={value?.ttl ?? 1} hint="Use 1 for Cloudflare Auto." required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="proxied" defaultChecked={value?.proxied} className="h-4 w-4 rounded border-slate-300 text-blue-600" />Proxy through Cloudflare</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={value?.enabled ?? true} className="h-4 w-4 rounded border-slate-300 text-blue-600" />Enable DDNS updates</label><div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button busy={busy}><Save className="h-4 w-4" />Save record</Button></div></form>; }

const accountsLoad = async () => (await api.accounts()).accounts;
export function CloudflarePage() {
  const state = useLoad<Account[]>(accountsLoad);
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Account>>();
  const [remove, setRemove] = useState<Account>();
  const [busy, setBusy] = useState('');
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('save');
    const form = new FormData(event.currentTarget);
    try {
      if (editing?.id) {
        const token = String(form.get('token'));
        const { account } = await api.updateAccount(editing.id, { name: String(form.get('name')), ...(token ? { token } : {}) });
        state.setData(state.data?.map((item) => item.id === account.id ? account : item));
      } else {
        const { account } = await api.addAccount({ name: String(form.get('name')), token: String(form.get('token')) });
        state.setData([...(state.data ?? []), account]);
      }
      setEditing(undefined); toast(editing?.id ? 'Account updated.' : 'Cloudflare account connected.');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const run = async (account: Account, action: 'test' | 'sync') => {
    setBusy(`${account.id}-${action}`);
    try {
      if (action === 'test') {
        const result = await api.testAccount(account.id);
        toast(result.message ?? (result.ok ? 'Token is valid.' : 'Token test failed.'), result.ok ? 'success' : 'error');
      } else { await api.syncAccount(account.id); toast('Cloudflare sync started.'); }
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const destroy = async () => {
    if (!remove) return; setBusy('delete');
    try { await api.deleteAccount(remove.id); state.setData(state.data?.filter((item) => item.id !== remove.id)); setRemove(undefined); toast('Cloudflare account removed.'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  return <div className="space-y-7"><PageTitle eyebrow="Provider" title="Cloudflare" description="Manage API tokens and synchronize zones from your Cloudflare accounts." actions={<Button onClick={() => setEditing({ name: '' })}><Plus className="h-4 w-4" />Connect account</Button>} />{state.loading ? <Loading label="Loading Cloudflare accounts" /> : state.error ? <ErrorState message={state.error} retry={state.reload} /> : !state.data?.length ? <Empty title="No Cloudflare account" message="Connect an account with a scoped API token to discover zones and records." action={<Button onClick={() => setEditing({ name: '' })}><Cloud className="h-4 w-4" />Connect Cloudflare</Button>} /> : <div className="grid gap-4 xl:grid-cols-2">{state.data.map((account) => <Card key={account.id} className="p-5 sm:p-6"><div className="flex items-start gap-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950"><Cloud /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{account.name}</h2><Badge status={account.status} /></div><p className="mt-1 truncate text-sm text-slate-500">{account.email ?? 'Cloudflare API token'}</p></div></div><dl className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-950"><div><dt className="text-xs text-slate-500">API token</dt><dd className="mt-1 font-mono font-semibold">{account.tokenHint || '••••••••••••'}</dd></div><div><dt className="text-xs text-slate-500">Zones</dt><dd className="mt-1 font-semibold">{account.zones}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">Last tested</dt><dd className="mt-1">{formatDate(account.lastTestedAt)}</dd></div></dl><div className="mt-5 flex flex-wrap gap-2"><Button variant="secondary" busy={busy === `${account.id}-test`} onClick={() => void run(account, 'test')}><ShieldCheck className="h-4 w-4" />Test token</Button><Button variant="secondary" busy={busy === `${account.id}-sync`} onClick={() => void run(account, 'sync')}><RefreshCw className="h-4 w-4" />Sync zones</Button><Button variant="ghost" onClick={() => setEditing(account)}><Edit3 className="h-4 w-4" />Edit</Button><Button variant="ghost" className="text-red-600" onClick={() => setRemove(account)}><Trash2 className="h-4 w-4" /></Button></div></Card>)}</div>}<Dialog open={!!editing} onClose={() => setEditing(undefined)} title={editing?.id ? 'Edit Cloudflare account' : 'Connect Cloudflare account'} description="The token is encrypted at rest and is never returned by the API."><form onSubmit={(e) => void save(e)} className="grid gap-4"><Field label="Account name" name="name" defaultValue={editing?.name} required /><Field label={editing?.id ? 'Replace API token' : 'Cloudflare API token'} name="token" type="password" required={!editing?.id} hint={editing?.id ? 'Leave blank to keep the existing token.' : 'Requires Zone:Read and DNS:Edit permissions.'} /><div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300"><KeyRound className="mr-2 inline h-4 w-4" />Use the least-privilege token possible and limit it to managed zones.</div><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(undefined)}>Cancel</Button><Button busy={busy === 'save'}>Save account</Button></div></form></Dialog><Dialog open={!!remove} onClose={() => setRemove(undefined)} title="Remove Cloudflare account?" description="Managed records from this account will stop receiving updates. Cloudflare DNS records are not deleted."><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRemove(undefined)}>Cancel</Button><Button variant="danger" busy={busy === 'delete'} onClick={() => void destroy()}>Remove account</Button></div></Dialog></div>;
}

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  const [record, setRecord] = useState('');
  const query = useMemo(() => { const q = new URLSearchParams({ page: String(page), pageSize: '20' }); if (status) q.set('status', status); if (action) q.set('action', action); if (record) q.set('record', record); return q; }, [page, status, action, record]);
  const load = useCallback(() => api.history(query), [query]);
  const state = useLoad(load);
  useEffect(() => setPage(1), [status, action, record]);
  const pages = state.data ? Math.max(1, Math.ceil(state.data.total / state.data.pageSize)) : 1;
  return <div className="space-y-7"><PageTitle eyebrow="Audit log" title="Update History" description="Search checks, IP changes, DNS writes, and configuration events." actions={<Button variant="secondary" onClick={state.reload}><RefreshCw className="h-4 w-4" />Refresh</Button>} /><Card className="grid gap-4 p-4 sm:grid-cols-3"><Field label="Record" placeholder="Search record…" value={record} onChange={(e) => setRecord(e.target.value)} /><SelectField label="Action" value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option><option value="check">Checks</option><option value="update">Updates</option><option value="force-update">Force updates</option><option value="configuration">Configuration</option></SelectField><SelectField label="Result" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All results</option><option value="success">Success</option><option value="failed">Failed</option><option value="skipped">Skipped</option><option value="pending">Pending</option></SelectField></Card>{state.loading ? <Loading label="Loading update history" /> : state.error ? <ErrorState message={state.error} retry={state.reload} /> : <Card><HistoryRows items={state.data?.items ?? []} />{(state.data?.total ?? 0) > 0 && <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm dark:border-slate-800"><span className="text-slate-500">{state.data?.total} events · Page {page} of {pages}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>}</Card>}</div>;
}

const settingsLoad = () => api.settings();
export function SettingsPage() {
  const { user, setUser } = useAuth();
  const state = useLoad<Settings>(settingsLoad);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('settings');
    const form = new FormData(event.currentTarget);
    const value: Settings = {
      checkIntervalMinutes: Number(form.get('interval')),
      ipv4Service: String(form.get('ipv4Service')),
      ipv6Service: String(form.get('ipv6Service')) || undefined,
      updateOnStartup: form.get('updateOnStartup') === 'on',
      notifyOnChange: form.get('notifyOnChange') === 'on',
      notifyOnFailure: form.get('notifyOnFailure') === 'on',
      webhookUrl: String(form.get('webhookUrl')) || undefined,
      timezone: String(form.get('timezone'))
    };
    try { state.setData((await api.updateSettings(value)).settings); toast('DDNS settings saved.'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('profile');
    const form = new FormData(event.currentTarget);
    try { const { user: updated } = await api.updateProfile({ displayName: String(form.get('displayName')), email: String(form.get('email')) }); setUser(updated); toast('Profile updated.'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const password = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('password');
    const form = new FormData(event.currentTarget);
    const next = String(form.get('newPassword'));
    if (next !== String(form.get('confirmPassword'))) { toast('New passwords do not match.', 'error'); setBusy(''); return; }
    try { await api.changePassword({ currentPassword: String(form.get('currentPassword')), newPassword: next }); event.currentTarget.reset(); toast('Password changed.'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  if (state.loading) return <Loading label="Loading settings" />;
  if (state.error || !state.data) return <ErrorState message={state.error || 'Settings unavailable'} retry={state.reload} />;
  const s = state.data;
  return <div className="space-y-7"><PageTitle eyebrow="Configuration" title="Settings" description="Configure polling, IP detection, notifications, and account security." /><div className="grid gap-5 xl:grid-cols-2"><Card className="p-6"><SectionHeading title="DDNS behavior" description="Control when and how DNS records are updated." /><form onSubmit={(e) => void saveSettings(e)} className="mt-6 grid gap-5"><SelectField label="Check interval" name="interval" defaultValue={s.checkIntervalMinutes}><option value="1">Every minute</option><option value="5">Every 5 minutes</option><option value="10">Every 10 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option></SelectField><Field label="IPv4 detection service" name="ipv4Service" type="url" defaultValue={s.ipv4Service} required /><Field label="IPv6 detection service" name="ipv6Service" type="url" defaultValue={s.ipv6Service} placeholder="Optional" /><Field label="Timezone" name="timezone" defaultValue={s.timezone} required /><CheckField name="updateOnStartup" defaultChecked={s.updateOnStartup} title="Check on startup" description="Run a full check when the service starts." /><div className="border-t border-slate-100 pt-5 dark:border-slate-800"><h3 className="mb-3 text-sm font-bold">Notifications</h3><div className="grid gap-3"><CheckField name="notifyOnChange" defaultChecked={s.notifyOnChange} title="IP changes" description="Notify when a new public IP is detected." /><CheckField name="notifyOnFailure" defaultChecked={s.notifyOnFailure} title="Update failures" description="Notify when Cloudflare cannot be updated." /></div></div><Field label="Webhook URL" name="webhookUrl" type="url" defaultValue={s.webhookUrl} placeholder="https://…" hint="Optional endpoint for update notifications." /><Button busy={busy === 'settings'} className="justify-self-start"><Save className="h-4 w-4" />Save DDNS settings</Button></form></Card><div className="grid content-start gap-5"><Card className="p-6"><SectionHeading title="Profile" description="The identity shown in the manager." /><form onSubmit={(e) => void saveProfile(e)} className="mt-6 grid gap-5"><Field label="Display name" name="displayName" defaultValue={user?.displayName} required /><Field label="Email address" name="email" type="email" defaultValue={user?.email} required /><Button busy={busy === 'profile'} className="justify-self-start">Save profile</Button></form></Card><Card className="p-6"><SectionHeading title="Password" description="Use at least 12 characters and a unique password." /><form onSubmit={(e) => void password(e)} className="mt-6 grid gap-5"><Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required /><Field label="New password" name="newPassword" type="password" autoComplete="new-password" minLength={12} required /><Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /><Button busy={busy === 'password'} className="justify-self-start">Change password</Button></form></Card></div></div></div>;
}
function SectionHeading({ title, description }: { title: string; description: string }) { return <div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>; }
function CheckField({ title, description, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { title: string; description: string }) { return <label className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600" {...props} /><span><strong className="block text-sm">{title}</strong><span className="block text-xs text-slate-500">{description}</span></span></label>; }

export function SetupGuard({ children }: { children: ReactNode }) {
  const state = useLoad(api.setupStatus);
  if (state.loading) return <div className="grid min-h-screen place-items-center bg-slate-950"><Loading label="Checking setup" /></div>;
  if (state.data?.required) return <Navigate to="/setup" replace />;
  return children;
}
