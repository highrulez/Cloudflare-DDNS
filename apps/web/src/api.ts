export type User = { id: string; username: string };
export type Status = 'healthy' | 'updating' | 'degraded' | 'disabled' | 'error';
export type DetectionStatus =
  'DETECTED' | 'NETWORK_UNAVAILABLE' | 'PROVIDER_FAILED' | 'NO_GLOBAL_ADDRESS' | 'DISABLED';
export type Dashboard = {
  currentIp?: string;
  currentIpv6?: string;
  ipv4Status?: DetectionStatus;
  ipv6Status?: DetectionStatus;
  status: Status;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  nextCheckAt?: string;
  enabledRecords: number;
  totalRecords: number;
  proxiedRecords: number;
  dnsOnlyRecords: number;
  aRecords: number;
  aaaaRecords: number;
  failedRecords: number;
  recentUpdates: HistoryItem[];
};
export type Account = {
  id: string;
  name: string;
  tokenHint: string;
  status: Status;
  zones: number;
  zoneItems: Zone[];
  lastTestedAt?: string;
};
export type Zone = {
  id: string;
  name: string;
  cloudflareId: string;
  status: string;
  recordCount: number;
  managedCount: number;
  lastSyncedAt?: string;
};
export type PublicIp = {
  ipv4: string | null;
  ipv6: string | null;
  ipv4Status?: DetectionStatus;
  ipv6Status?: DetectionStatus;
  detectedAt?: string;
};
export function detectionStatusText(status: DetectionStatus | undefined, family: 'IPv4' | 'IPv6') {
  if (status === 'DETECTED') return `${family} detected`;
  if (status === 'NETWORK_UNAVAILABLE') return `Container/network ${family} unavailable`;
  if (status === 'PROVIDER_FAILED') return `${family} provider failed`;
  if (status === 'NO_GLOBAL_ADDRESS') return `No global ${family} found`;
  if (status === 'DISABLED') return `${family} detection disabled`;
  return `${family} not checked`;
}
export type DiscoveredRecord = {
  id: string;
  type: 'A' | 'AAAA';
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
  managed: boolean;
  managedRecordId: string | null;
  ddnsEnabled: boolean;
  detectedIp: string | null;
  syncStatus: 'SYNCHRONIZED' | 'NEEDS_UPDATE' | 'NO_PUBLIC_IP';
};
export type ZoneDiscovery = { zone: Zone; publicIp: PublicIp; items: DiscoveredRecord[] };
export type CreateDnsRecord = {
  accountId: string;
  zoneId: string;
  hostname: string;
  type: 'A' | 'AAAA';
  ipSource: 'DETECTED_IPV4' | 'DETECTED_IPV6' | 'CUSTOM';
  customIp?: string;
  proxied: boolean;
  ttl: number;
  ddnsEnabled: boolean;
};
export type RecordItem = {
  id: string;
  accountId: string;
  accountName?: string;
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
  recordType?: 'A' | 'AAAA';
  action:
    'check' | 'update' | 'force-update' | 'configuration' | 'create' | 'stop-managing' | 'delete';
  status: 'success' | 'failed' | 'skipped' | 'pending';
  oldValue?: string;
  newValue?: string;
  message?: string;
  trigger?: 'SCHEDULED' | 'MANUAL_CHECK' | 'MANUAL_UPDATE' | 'FORCE' | 'SETUP';
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
export type HealthState = 'healthy' | 'warning' | 'error';
export type SystemOverview = {
  generatedAt: string;
  network: {
    ipv4: string | null;
    ipv6: string | null;
    ipv4Status: DetectionStatus | null;
    ipv6Status: DetectionStatus | null;
    ipv4Provider: string | null;
    ipv6Provider: string | null;
    ipv4LatencyMs: number | null;
    ipv6LatencyMs: number | null;
    detectedAt: string | null;
  };
  synology: {
    hostname: string;
    operatingSystem: string;
    kernel: string;
    architecture: string;
    timezone: string;
  };
  docker: {
    containerId: string;
    containerName: string;
    networkMode: string;
    hostNetworking: boolean;
    uptimeSeconds: number;
    nodeVersion: string;
    platform: string;
  };
  database: {
    status: HealthState;
    type: string;
    version: string;
    database: string;
    latencyMs: number;
    currentMigration: string | null;
    pendingMigrations: string[];
  };
  cloudflare: {
    status: HealthState;
    accounts: number;
    zones: number;
    latencyMs: number;
    lastSuccessfulRequest: string | null;
    permissions: {
      zoneRead: 'granted' | 'denied' | 'not_verified';
      dnsEdit: 'granted' | 'denied' | 'not_verified';
    };
    message: string;
  };
  ddns: {
    scheduler: string;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
    lastSuccessfulUpdate: string | null;
    lastError: string | null;
    managedRecords: number;
    leaseOwner: string;
    schedulerVersion: string;
  };
  reverseProxy: {
    reverseProxyDetected: boolean;
    https: boolean;
    protocol: string;
    hostname: string;
    clientIp: string;
    forwardedProto: string | null;
    forwardedHost: string | null;
    forwardedPort: string | null;
    forwardedFor: string | null;
    appOrigin: string | null;
    cookieSecure: boolean;
    trustProxy: boolean;
    warnings: string[];
  };
  security: {
    https: boolean;
    reverseProxyDetected: boolean;
    cookieSecure: boolean;
    turnstileConfigured: boolean;
    strongAuthAvailable: boolean;
  };
  application: {
    version: string;
    commit: string;
    buildDate: string | null;
    environment: string;
    configurationVersion: string;
    latestRelease: string | null;
    startedAt: string | null;
  };
};
export type SystemSelfTest = {
  id: string;
  name: string;
  status: 'success' | 'warning' | 'error';
  latencyMs: number;
  message: string;
  timestamp: string;
};
export type SystemLog = {
  id: string;
  time: string;
  level: 'info' | 'warning' | 'error';
  category: 'application' | 'cloudflare' | 'scheduler' | 'authentication' | 'database';
  message: string;
  details?: Record<string, unknown>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      error?: { message?: string; code?: string; details?: unknown };
      code?: string;
    };
    throw new ApiError(
      body.message ?? body.error?.message ?? `Request failed (${response.status})`,
      response.status,
      body.error?.code ?? body.code,
      body.error?.details
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function requestText(path: string): Promise<string> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/plain' }
  });
  if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);
  return response.text();
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
    request<{
      id: string;
      zones: Array<{
        id: string;
        name: string;
        cloudflareId: string;
        status: string;
        recordCount: number;
        lastSyncedAt?: string;
      }>;
    }>('/setup/cloudflare', body('POST', data)),
  setupAccounts: async () => {
    const result = await request<{
      items: Array<{ id: string; name: string; zones: Array<Record<string, unknown>> }>;
    }>('/setup/cloudflare/accounts');
    return {
      accounts: result.items.map((account) => ({
        id: account.id,
        name: account.name,
        tokenHint: '',
        status: 'healthy' as const,
        zones: account.zones.length,
        zoneItems: account.zones.map(mapZone)
      }))
    };
  },
  setupIp: () => request<PublicIp>('/setup/ip'),
  setupZoneRecords: (accountId: string, zoneId: string) =>
    request<ZoneDiscovery>(`/setup/cloudflare/${accountId}/zones/${zoneId}/records`),
  setupManageRecords: (
    records: Array<{
      accountId: string;
      zoneId: string;
      cloudflareRecordId: string;
      ddnsEnabled: boolean;
    }>
  ) => request<{ items: RecordItem[] }>('/setup/records/manage', body('POST', { records })),
  setupCreateRecord: (data: CreateDnsRecord) =>
    request<RecordItem>('/setup/records', body('POST', data)),
  setupRecord: (data: {
    accountId: string;
    zoneId: string;
    type: 'A' | 'AAAA';
    hostname: string;
    content: string;
  }) =>
    request<RecordItem>(
      '/setup/records',
      body('POST', {
        accountId: data.accountId,
        zoneId: data.zoneId,
        hostname: data.hostname,
        type: data.type,
        ipSource: 'CUSTOM',
        customIp: data.content,
        proxied: false,
        ttl: 1,
        ddnsEnabled: true
      })
    ),
  setupSettings: (intervalMinutes: number, ipv4Enabled = true, ipv6Enabled = false) =>
    request<Settings>(
      '/setup/settings',
      body('PUT', {
        intervalMinutes,
        ipv4Enabled,
        ipv6Enabled,
        automaticUpdates: true,
        providerPolicy: 'ordered',
        requestTimeoutMs: 5000,
        retentionDays: 90,
        timezone: 'Asia/Kuala_Lumpur'
      })
    ),
  completeSetup: () => request<{ completed: boolean }>('/setup/complete', body('POST')),
  me: () => request<{ user: User }>('/auth/me'),
  turnstileConfig: () =>
    request<{
      siteKey: string;
      expectedHostname: string;
      expectedAction: string;
      appOrigin: string | null;
    }>('/auth/turnstile'),
  authBootstrap: () =>
    request<{
      appOrigin: string | null;
      turnstileExpectedHostname: string;
      secureLoginRequiredHint: boolean;
    }>('/auth/bootstrap'),
  logout: () => request<void>('/auth/logout', body('POST')),
  dashboard: async (): Promise<Dashboard> => {
    const result = await request<{
      currentIp: {
        ipv4?: string;
        ipv6?: string;
        ipv4Status?: DetectionStatus;
        ipv6Status?: DetectionStatus;
        detectedAt?: string;
      };
      scheduler?: { running?: boolean; nextCheckAt?: string };
      records: {
        total: number;
        byHealth: Record<string, number>;
        proxied: number;
        dnsOnly: number;
        aRecords: number;
        aaaaRecords: number;
      };
      recentActivity: Array<Record<string, unknown>>;
    }>('/dashboard');
    const failedRecords =
      (result.records.byHealth.ERROR ?? 0) + (result.records.byHealth.DRIFTED ?? 0);
    return {
      currentIp: result.currentIp.ipv4,
      currentIpv6: result.currentIp.ipv6,
      ipv4Status: result.currentIp.ipv4Status,
      ipv6Status: result.currentIp.ipv6Status,
      status: result.scheduler?.running ? 'updating' : failedRecords ? 'degraded' : 'healthy',
      lastCheckedAt: result.currentIp.detectedAt,
      nextCheckAt: result.scheduler?.nextCheckAt,
      enabledRecords: result.records.total - (result.records.byHealth.DISABLED ?? 0),
      totalRecords: result.records.total,
      proxiedRecords: result.records.proxied,
      dnsOnlyRecords: result.records.dnsOnly,
      aRecords: result.records.aRecords,
      aaaaRecords: result.records.aaaaRecords,
      failedRecords,
      recentUpdates: result.recentActivity.map(mapHistory)
    };
  },
  checkAll: () => request<unknown>('/ddns/check', body('POST')),
  forceAll: () => request<unknown>('/ddns/force', body('POST', { confirm: true })),
  detectIp: () => request<PublicIp>('/ip/detect', body('POST')),
  accounts: async () => {
    const result = await request<{ items: Array<Record<string, unknown>> }>('/cloudflare/accounts');
    return { accounts: result.items.map(mapAccount) };
  },
  addAccount: async (data: { name: string; token: string }) => ({
    account: mapAccount(
      await request<Record<string, unknown>>('/cloudflare/accounts', body('POST', data))
    )
  }),
  updateAccount: async (id: string, data: { name: string; token?: string }) => ({
    account: mapAccount(
      await request<Record<string, unknown>>(`/cloudflare/accounts/${id}`, body('PATCH', data))
    )
  }),
  testAccount: (id: string) =>
    request<{ valid: boolean }>(`/cloudflare/accounts/${id}/test`, body('POST')),
  syncAccount: (id: string) =>
    request<unknown>(`/cloudflare/accounts/${id}/zones/refresh`, body('POST')),
  zoneRecords: (accountId: string, zoneId: string) =>
    request<ZoneDiscovery>(`/cloudflare/accounts/${accountId}/zones/${zoneId}/records`),
  deleteAccount: (id: string) => request<void>(`/cloudflare/accounts/${id}`, body('DELETE')),
  records: async (query?: URLSearchParams) => {
    const result = await request<{ items: Array<Record<string, unknown>> }>(
      `/records${query ? `?${query}` : ''}`
    );
    return { records: result.items.map(mapRecord) };
  },
  refreshRecordMetadata: () =>
    request<{ refreshed: number; failedZones: number }>('/records/refresh', body('POST')),
  createRecord: async (
    data: CreateDnsRecord | Omit<RecordItem, 'id' | 'status' | 'lastCheckedAt' | 'lastUpdatedAt'>
  ) => {
    const input: CreateDnsRecord =
      'ipSource' in data
        ? data
        : {
            accountId: data.accountId,
            zoneId: data.zoneId,
            hostname: data.name,
            type: data.type,
            ipSource: 'CUSTOM',
            customIp: data.content,
            proxied: data.proxied,
            ttl: data.ttl,
            ddnsEnabled: data.enabled
          };
    return {
      record: mapRecord(await request<Record<string, unknown>>('/records', body('POST', input)))
    };
  },
  manageRecords: async (
    records: Array<{
      accountId: string;
      zoneId: string;
      cloudflareRecordId: string;
      ddnsEnabled: boolean;
    }>
  ) => {
    const result = await request<{ items: Array<Record<string, unknown>> }>(
      '/records/manage',
      body('POST', { records })
    );
    return { records: result.items.map(mapRecord) };
  },
  updateRecord: async (id: string, data: Partial<RecordItem>) => ({
    record: mapRecord(
      await request<Record<string, unknown>>(
        `/records/${id}`,
        body('PATCH', {
          ...(data.name ? { hostname: data.name } : {}),
          ...(data.ttl !== undefined ? { ttl: data.ttl } : {}),
          ...(data.proxied !== undefined ? { proxied: data.proxied } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {})
        })
      )
    )
  }),
  toggleRecord: async (id: string, enabled: boolean) => ({
    record: mapRecord(
      await request<Record<string, unknown>>(`/records/${id}`, body('PATCH', { enabled }))
    )
  }),
  checkRecord: (id: string) => request<unknown>(`/records/${id}/check`, body('POST')),
  forceRecord: (id: string) => request<unknown>(`/records/${id}/force`, body('POST')),
  stopManagingRecord: (id: string) => request<void>(`/records/${id}`, body('DELETE')),
  deleteRecord: (id: string) => request<void>(`/records/${id}`, body('DELETE')),
  deleteCloudflareRecord: (id: string, confirmation: string) =>
    request<void>(`/records/${id}/cloudflare`, body('DELETE', { confirmation })),
  history: async (query: URLSearchParams) => {
    const result = await request<Page<Record<string, unknown>>>(`/history/logs?${query}`);
    return { ...result, items: result.items.map(mapHistory) };
  },
  settings: () => request<Settings>('/settings'),
  updateSettings: async (data: Settings) => ({
    settings: await request<Settings>(
      '/settings',
      body('PUT', { ...data, providerPolicy: 'ordered' })
    )
  }),
  updateProfile: (data: { username: string }) =>
    request<{ user: User }>('/auth/profile', body('PATCH', data)),
  changePassword: (data: { currentPassword: string; newPassword: string; code?: string }) =>
    request<void>('/auth/password', body('PUT', data)),
  listSessions: () =>
    request<{
      items: Array<{
        current: boolean;
        createdAt: string;
        lastSeenAt: string;
        expiresAt: string;
        stronglyAuthenticated: boolean;
      }>;
    }>('/auth/sessions'),
  revokeOtherSessions: () =>
    request<{ revoked: number }>('/auth/sessions/revoke-others', body('POST')),
  login: async (username: string, password: string, turnstileToken: string) => {
    const result = await request<{ user?: User; mfaRequired?: boolean }>(
      '/auth/login',
      body('POST', { username, password, turnstileToken })
    );
    if (result.mfaRequired) return { mfaRequired: true as const };
    if (!result.user) throw new ApiError('Login response was incomplete', 500);
    return { mfaRequired: false as const, user: result.user };
  },
  verifyMfa: (data: { code?: string; recoveryCode?: string }) =>
    request<{ user: User; recoveryCodeUsed?: boolean }>('/auth/mfa/verify', body('POST', data)),
  mfaStatus: () =>
    request<{
      enabled: boolean;
      enabledAt: string | null;
      recoveryCodesRemaining: number;
      recoveryCodesTotal: number;
    }>('/auth/mfa/status'),
  mfaEnrollStart: (password: string) =>
    request<{
      otpauthUrl: string;
      qrDataUrl: string;
      setupKey: string;
      expiresAt: string;
    }>('/auth/mfa/enroll/start', body('POST', { password })),
  mfaEnrollConfirm: (code: string) =>
    request<{ enabled: boolean; recoveryCodes: string[] }>(
      '/auth/mfa/enroll/confirm',
      body('POST', { code })
    ),
  mfaRegenerateRecovery: (data: { password: string; code: string }) =>
    request<{ recoveryCodes: string[] }>('/auth/mfa/recovery/regenerate', body('POST', data)),
  mfaDisable: (data: { password: string; code: string }) =>
    request<void>('/auth/mfa/disable', body('POST', data)),
  reauth: (data: { password: string; code?: string }) =>
    request<{ stronglyAuthenticatedUntil: string; recentlyStronglyAuthenticated: boolean }>(
      '/auth/reauth',
      body('POST', data)
    ),
  systemOverview: () => request<SystemOverview>('/system/overview'),
  refreshSystemNetwork: () => request<PublicIp>('/system/network/refresh', body('POST')),
  runSystemTests: () =>
    request<{ timestamp: string; tests: SystemSelfTest[] }>('/system/tests', body('POST')),
  systemLogs: (query?: URLSearchParams) =>
    request<{ items: SystemLog[] }>(`/system/logs${query ? `?${query}` : ''}`),
  systemDiagnostics: () => requestText('/system/diagnostics'),
  systemLogsDownloadUrl: '/api/system/logs/download'
};

function mapAccount(value: Record<string, unknown>): Account {
  const zones = Array.isArray(value.zones) ? value.zones.map(mapZone) : [];
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

function mapZone(zoneValue: unknown): Zone {
  const zone = zoneValue as Record<string, unknown>;
  const count = zone._count as { records?: number } | undefined;
  return {
    id: String(zone.id),
    name: String(zone.name),
    cloudflareId: String(zone.cloudflareId),
    status: String(zone.status),
    recordCount: Number(zone.recordCount ?? 0),
    managedCount: Number(count?.records ?? 0),
    lastSyncedAt: zone.lastSyncedAt ? String(zone.lastSyncedAt) : undefined
  };
}

function mapRecord(value: Record<string, unknown>): RecordItem {
  const zone = value.zone as { name?: string } | undefined;
  const health = String(value.health ?? 'UNKNOWN');
  return {
    id: String(value.id),
    accountId: String(value.accountId),
    accountName: String((value.account as { name?: string } | undefined)?.name ?? ''),
    zoneId: String(value.zoneId),
    cloudflareRecordId: value.cloudflareRecordId ? String(value.cloudflareRecordId) : undefined,
    zoneName: zone?.name ?? '',
    type: value.type === 'AAAA' ? 'AAAA' : 'A',
    name: String(value.hostname ?? ''),
    content: String(value.content ?? ''),
    ttl: Number(value.ttl ?? 1),
    proxied: Boolean(value.proxied),
    enabled: Boolean(value.enabled),
    status: !value.enabled
      ? 'disabled'
      : health === 'HEALTHY'
        ? 'healthy'
        : health === 'ERROR'
          ? 'error'
          : 'degraded',
    lastCheckedAt: value.lastCheckedAt ? String(value.lastCheckedAt) : undefined,
    lastUpdatedAt: value.lastUpdatedAt ? String(value.lastUpdatedAt) : undefined
  };
}

function mapHistory(value: Record<string, unknown>): HistoryItem {
  const action = String(value.action ?? 'CHECKED');
  const result = String(value.result ?? 'SUCCESS');
  const run = value.run as { trigger?: string } | undefined;
  const trigger = run?.trigger;
  const recordType = value.type === 'AAAA' ? 'AAAA' : value.type === 'A' ? 'A' : undefined;
  return {
    id: String(value.id),
    recordName: value.hostname ? String(value.hostname) : undefined,
    recordType,
    action:
      action === 'UPDATED'
        ? 'update'
        : action === 'CREATED'
          ? 'create'
          : action === 'STOPPED_MANAGING'
            ? 'stop-managing'
            : action === 'DELETED'
              ? 'delete'
              : action === 'FAILED'
                ? 'configuration'
                : 'check',
    status: result === 'ERROR' ? 'failed' : result === 'UNCHANGED' ? 'skipped' : 'success',
    oldValue: value.previousIp ? String(value.previousIp) : undefined,
    newValue: value.newIp ? String(value.newIp) : undefined,
    message: value.error ? String(value.error) : undefined,
    trigger:
      trigger === 'SCHEDULED' ||
      trigger === 'MANUAL_CHECK' ||
      trigger === 'MANUAL_UPDATE' ||
      trigger === 'FORCE' ||
      trigger === 'SETUP'
        ? trigger
        : undefined,
    createdAt: String(value.createdAt ?? new Date().toISOString())
  };
}
