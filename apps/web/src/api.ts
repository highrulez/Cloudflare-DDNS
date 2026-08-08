export type User = {
  id: string;
  email: string;
  name?: string;
  createdAt?: string;
  mustChangePassword?: boolean;
};
export type Provider = {
  id: string;
  type: string;
  label: string;
  status: 'connected' | 'pending' | 'error';
  maskedToken?: string;
  lastSyncAt?: string;
  error?: string;
};
export type Domain = {
  id: string;
  name: string;
  providerId?: string;
  providerLabel?: string;
  status?: string;
  recordsCount?: number;
  syncedAt?: string;
};
export type DnsRecord = {
  id: string;
  domainId?: string;
  domain?: string;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  ddnsEnabled?: boolean;
  eligibleForDdns?: boolean;
  updatedAt?: string;
};
export type Activity = {
  id: string;
  action: string;
  description?: string;
  status?: 'success' | 'pending' | 'error';
  createdAt: string;
  actor?: string;
};
export type Dashboard = {
  publicIp?: string;
  connectedProviders?: number;
  managedDomains?: number;
  managedRecords?: number;
  lastSyncAt?: string;
  lastIpChangeAt?: string;
  activity?: Activity[];
};

type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
};

type Connection = {
  id: string;
  providerKey: string;
  label: string;
  status: 'PENDING' | 'CONNECTING' | 'ACTIVE' | 'DEGRADED' | 'FAILED' | 'REVOKED';
  statusMessage?: string | null;
  credentialHint?: string | null;
  lastSyncedAt?: string | null;
};

type AuditEvent = {
  id: string;
  action: string;
  message: string;
  createdAt: string;
};

function mapUser(user: SessionUser): User {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    mustChangePassword: user.mustChangePassword
  };
}

function mapProvider(connection: Connection): Provider {
  const status =
    connection.status === 'ACTIVE'
      ? 'connected'
      : connection.status === 'PENDING' || connection.status === 'CONNECTING'
        ? 'pending'
        : 'error';
  return {
    id: connection.id,
    type: connection.providerKey,
    label: connection.label,
    status,
    ...(connection.credentialHint ? { maskedToken: connection.credentialHint } : {}),
    ...(connection.lastSyncedAt ? { lastSyncAt: connection.lastSyncedAt } : {}),
    ...(connection.statusMessage ? { error: connection.statusMessage } : {})
  };
}

function mapActivity(event: AuditEvent): Activity {
  return {
    id: event.id,
    action: event.action,
    description: event.message,
    status: event.action.includes('failure') ? 'error' : 'success',
    createdAt: event.createdAt
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      message =
        body.message ??
        (typeof body.error === 'string' ? body.error : body.error?.message) ??
        message;
    } catch {
      // Preserve the HTTP fallback for a non-JSON error response.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (value: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(value)
});
const patch = (value: unknown): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(value)
});

export const api = {
  login: async (email: string, password: string) =>
    mapUser((await request<{ user: SessionUser }>('/auth/login', json({ email, password }))).user),
  me: async () => mapUser((await request<{ user: SessionUser }>('/auth/me')).user),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  dashboard: async () => {
    const result = await request<Omit<Dashboard, 'activity'> & { recentActivity: AuditEvent[] }>(
      '/dashboard'
    );
    return { ...result, activity: result.recentActivity.map(mapActivity) };
  },
  providers: async () =>
    (await request<{ connections: Connection[] }>('/connections')).connections.map(mapProvider),
  connectCloudflare: async (token: string, label: string) => {
    const result = await request<{ connection: Connection }>(
      '/connections',
      json({
        providerKey: 'cloudflare',
        label,
        credentials: { apiToken: token }
      })
    );
    return mapProvider(result.connection);
  },
  providerAction: (id: string, action: 'sync' | 'test') =>
    request<void>(`/connections/${id}/${action === 'sync' ? 'resync' : 'test'}`, {
      method: 'POST'
    }),
  replaceCredential: async (id: string, token: string) => {
    await request(`/connections/${id}/credentials`, json({ credentials: { apiToken: token } }));
    return mapProvider(
      (await request<{ connection: Connection }>(`/connections/${id}`)).connection
    );
  },
  revokeProvider: (id: string) => request<void>(`/connections/${id}`, { method: 'DELETE' }),
  domains: async () =>
    (
      await request<{
        zones: Array<{
          id: string;
          name: string;
          status?: string | null;
          updatedAt: string;
          account: {
            connectionId: string;
            connection?: { label: string };
            name: string;
          };
          _count: { records: number };
        }>;
      }>('/domains')
    ).zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      providerId: zone.account.connectionId,
      providerLabel: zone.account.connection?.label ?? zone.account.name,
      status: zone.status ?? 'active',
      recordsCount: zone._count.records,
      syncedAt: zone.updatedAt
    })),
  records: async () =>
    (
      await request<{
        records: Array<{
          id: string;
          zoneId: string;
          type: string;
          name: string;
          content: string;
          ttl: number;
          proxied?: boolean | null;
          updatedAt: string;
          selection?: { enabled: boolean } | null;
          zone?: { name: string };
        }>;
      }>('/records')
    ).records.map((record) => ({
      id: record.id,
      domainId: record.zoneId,
      ...(record.zone ? { domain: record.zone.name } : {}),
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl,
      ...(record.proxied === null || record.proxied === undefined
        ? {}
        : { proxied: record.proxied }),
      ddnsEnabled: record.selection?.enabled ?? false,
      eligibleForDdns: record.type === 'A' || record.type === 'AAAA',
      updatedAt: record.updatedAt
    })),
  toggleDdns: async (id: string, enabled: boolean) => {
    await request(`/records/${id}/ddns-selection`, {
      method: 'PUT',
      body: JSON.stringify({ enabled })
    });
    return { id, ddnsEnabled: enabled };
  },
  activity: async () =>
    (await request<{ events: AuditEvent[] }>('/activity')).events.map(mapActivity),
  updateProfile: async (data: { name: string; email: string }) =>
    mapUser(
      (
        await request<{ user: SessionUser }>(
          '/auth/profile',
          patch({ displayName: data.name, email: data.email })
        )
      ).user
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/change-password', json({ currentPassword, newPassword }))
};
