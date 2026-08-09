export type User = { id: string; username: string };
export type Status = 'healthy' | 'updating' | 'degraded' | 'disabled' | 'error';
export type Dashboard = {
  currentIp?: string;
  status: Status;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  nextCheckAt?: string;
  enabledRecords: number;
  totalRecords: number;
  failedRecords: number;
  recentUpdates: HistoryItem[];
};
export type Account = {
  id: string;
  name: string;
  tokenHint: string;
  status: Status;
  zones: number;
  zoneItems: Array<{ id: string; name: string; cloudflareId: string; status: string }>;
  lastTestedAt?: string;
};
export type RecordItem = {
  id: string;
  accountId: string;
  zoneId: string;
  cloudflareRecordId?: string;
  zoneName: string;
  type: 'A' | 'AAAA';
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  enabled: boolean;
  status: Status;
  lastCheckedAt?: string;
  lastUpdatedAt?: string;
};
export type HistoryItem = {
  id: string;
  recordName?: string;
  zoneName?: string;
  action: 'check' | 'update' | 'force-update' | 'configuration';
  status: 'success' | 'failed' | 'skipped' | 'pending';
  oldValue?: string;
  newValue?: string;
  message?: string;
  createdAt: string;
};
export type Settings = {
  intervalMinutes: number;
  ipv4Enabled: boolean;
  ipv6Enabled: boolean;
  automaticUpdates: boolean;
  requestTimeoutMs: number;
  retentionDays: number;
  timezone: string;
};
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; error?: { message?: string }; code?: string };
    throw new ApiError(body.message ?? body.error?.message ?? `Request failed (${response.status})`, response.status, body.code);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

const body = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) })
});

export const api = {
  setupStatus: async () => {
    const result = await request<{ completed: boolean; step: number }>('/setup/status');
    return { required: !result.completed, currentStep: result.step };
  },
  setupAdmin: (data: { username: string; password: string }) =>
    request<{ id: string; username: string; step: number }>('/setup/admin', body('POST', data)),
  setupCloudflare: (data: { name: string; token: string }) =>
    request<{ id: string; zones: Array<{ id: string; name: string }> }>('/setup/cloudflare', body('POST', data)),
  setupRecord: (data: {
    accountId: string;
    zoneId: string;
    type: 'A' | 'AAAA';
    hostname: string;
    content: string;
  }) => request<RecordItem>('/setup/record', body('POST', {
    ...data,
    proxied: false,
    ttl: 1,
    enabled: true,
    automatic: true
  })),
  setupSettings: (intervalMinutes: number) => request<Settings>('/setup/settings', body('PUT', {
    intervalMinutes,
    ipv4Enabled: true,
    ipv6Enabled: false,
    automaticUpdates: true,
    providerPolicy: 'ordered',
    requestTimeoutMs: 5000,
    retentionDays: 90,
    timezone: 'Asia/Kuala_Lumpur'
  })),
  completeSetup: () => request<{ completed: boolean }>('/setup/complete', body('POST')),
  me: () => request<{ user: User }>('/auth/me'),
  login: (username: string, password: string) => request<{ user: User }>('/auth/login', body('POST', { username, password })),
  logout: () => request<void>('/auth/logout', body('POST')),
  dashboard: async (): Promise<Dashboard> => {
    const result = await request<{
      currentIp: { ipv4?: string; detectedAt?: string };
      scheduler?: { running?: boolean; nextCheckAt?: string };
      records: { total: number; byHealth: Record<string, number> };
      recentActivity: Array<Record<string, unknown>>;
    }>('/dashboard');
    const failedRecords = (result.records.byHealth.ERROR ?? 0) + (result.records.byHealth.DRIFTED ?? 0);
    return {
      currentIp: result.currentIp.ipv4,
      status: result.scheduler?.running ? 'updating' : failedRecords ? 'degraded' : 'healthy',
      lastCheckedAt: result.currentIp.detectedAt,
      nextCheckAt: result.scheduler?.nextCheckAt,
      enabledRecords: result.records.total - (result.records.byHealth.DISABLED ?? 0),
      totalRecords: result.records.total,
      failedRecords,
      recentUpdates: result.recentActivity.map(mapHistory)
    };
  },
  checkAll: () => request<unknown>('/ddns/check', body('POST')),
  forceAll: () => request<unknown>('/ddns/force', body('POST', { confirm: true })),
  accounts: async () => {
    const result = await request<{ items: Array<Record<string, unknown>> }>('/cloudflare/accounts');
    return { accounts: result.items.map(mapAccount) };
  },
  addAccount: async (data: { name: string; token: string }) => ({
    account: mapAccount(await request<Record<string, unknown>>('/cloudflare/accounts', body('POST', data)))
  }),
  updateAccount: async (id: string, data: { name: string; token?: string }) => ({
    account: mapAccount(await request<Record<string, unknown>>(`/cloudflare/accounts/${id}`, body('PATCH', data)))
  }),
  testAccount: (id: string) => request<{ valid: boolean }>(`/cloudflare/accounts/${id}/test`, body('POST')),
  syncAccount: (id: string) => request<unknown>(`/cloudflare/accounts/${id}/zones/refresh`, body('POST')),
  zoneRecords: (accountId: string, zoneId: string) =>
    request<{ items: Array<{ id: string; type: 'A' | 'AAAA'; name: string; content: string; proxied: boolean; ttl: number }> }>(
      `/cloudflare/accounts/${accountId}/zones/${zoneId}/records`
    ),
  deleteAccount: (id: string) => request<void>(`/cloudflare/accounts/${id}`, body('DELETE')),
  records: async () => {
    const result = await request<{ items: Array<Record<string, unknown>> }>('/records');
    return { records: result.items.map(mapRecord) };
  },
  createRecord: async (data: Omit<RecordItem, 'id' | 'status' | 'lastCheckedAt' | 'lastUpdatedAt'>) => ({
    record: mapRecord(await request<Record<string, unknown>>('/records', body('POST', {
      accountId: data.accountId,
      zoneId: data.zoneId,
      cloudflareRecordId: data.cloudflareRecordId,
      type: data.type,
      hostname: data.name,
      content: data.content,
      ttl: data.ttl,
      proxied: data.proxied,
      enabled: data.enabled,
      automatic: true
    })))
  }),
  updateRecord: async (id: string, data: Partial<RecordItem>) => ({
    record: mapRecord(await request<Record<string, unknown>>(`/records/${id}`, body('PATCH', {
      ...(data.name ? { hostname: data.name } : {}),
      ...(data.ttl !== undefined ? { ttl: data.ttl } : {}),
      ...(data.proxied !== undefined ? { proxied: data.proxied } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {})
    })))
  }),
  toggleRecord: async (id: string, enabled: boolean) => ({
    record: mapRecord(await request<Record<string, unknown>>(`/records/${id}`, body('PATCH', { enabled })))
  }),
  checkRecord: (id: string) => request<unknown>(`/records/${id}/check`, body('POST')),
  forceRecord: (id: string) => request<unknown>(`/records/${id}/force`, body('POST')),
  deleteRecord: (id: string) => request<void>(`/records/${id}`, body('DELETE')),
  history: async (query: URLSearchParams) => {
    const result = await request<Page<Record<string, unknown>>>(`/history/logs?${query}`);
    return { ...result, items: result.items.map(mapHistory) };
  },
  settings: () => request<Settings>('/settings'),
  updateSettings: async (data: Settings) => ({
    settings: await request<Settings>('/settings', body('PUT', { ...data, providerPolicy: 'ordered' }))
  }),
  updateProfile: (data: { username: string }) => request<{ user: User }>('/auth/profile', body('PATCH', data)),
  changePassword: (data: { currentPassword: string; newPassword: string }) => request<void>('/auth/password', body('PUT', data))
};

function mapAccount(value: Record<string, unknown>): Account {
  const zones = Array.isArray(value.zones) ? value.zones as Account['zoneItems'] : [];
  return {
    id: String(value.id),
    name: String(value.name),
    tokenHint: String(value.tokenHint),
    status: value.lastError ? 'error' : value.verifiedAt ? 'healthy' : 'degraded',
    zones: zones.length,
    zoneItems: zones,
    lastTestedAt: value.verifiedAt ? String(value.verifiedAt) : undefined
  };
}

function mapRecord(value: Record<string, unknown>): RecordItem {
  const zone = value.zone as { name?: string } | undefined;
  const health = String(value.health ?? 'UNKNOWN');
  return {
    id: String(value.id),
    accountId: String(value.accountId),
    zoneId: String(value.zoneId),
    cloudflareRecordId: value.cloudflareRecordId ? String(value.cloudflareRecordId) : undefined,
    zoneName: zone?.name ?? '',
    type: value.type === 'AAAA' ? 'AAAA' : 'A',
    name: String(value.hostname ?? ''),
    content: String(value.content ?? ''),
    ttl: Number(value.ttl ?? 1),
    proxied: Boolean(value.proxied),
    enabled: Boolean(value.enabled),
    status: !value.enabled ? 'disabled' : health === 'HEALTHY' ? 'healthy' : health === 'ERROR' ? 'error' : 'degraded',
    lastCheckedAt: value.lastCheckedAt ? String(value.lastCheckedAt) : undefined,
    lastUpdatedAt: value.lastUpdatedAt ? String(value.lastUpdatedAt) : undefined
  };
}

function mapHistory(value: Record<string, unknown>): HistoryItem {
  const action = String(value.action ?? 'CHECKED');
  const result = String(value.result ?? 'SUCCESS');
  return {
    id: String(value.id),
    recordName: value.hostname ? String(value.hostname) : undefined,
    action: action === 'UPDATED' ? 'update' : action === 'FAILED' ? 'configuration' : 'check',
    status: result === 'ERROR' ? 'failed' : result === 'UNCHANGED' ? 'skipped' : 'success',
    oldValue: value.previousIp ? String(value.previousIp) : undefined,
    newValue: value.newIp ? String(value.newIp) : undefined,
    message: value.error ? String(value.error) : undefined,
    createdAt: String(value.createdAt ?? new Date().toISOString())
  };
}
