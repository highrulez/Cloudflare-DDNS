export type User = { id: string; email: string; displayName: string; mustChangePassword?: boolean };
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
  email?: string;
  tokenHint: string;
  status: Status;
  zones: number;
  lastTestedAt?: string;
};
export type RecordItem = {
  id: string;
  zoneId: string;
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
  checkIntervalMinutes: number;
  ipv4Service: string;
  ipv6Service?: string;
  updateOnStartup: boolean;
  notifyOnChange: boolean;
  notifyOnFailure: boolean;
  webhookUrl?: string;
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
  setupStatus: () => request<{ required: boolean; currentStep?: number }>('/setup/status'),
  setup: (step: number, data: unknown) => request<{ complete?: boolean }>(`/setup/${step}`, body('POST', data)),
  me: () => request<{ user: User }>('/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('/auth/login', body('POST', { email, password })),
  logout: () => request<void>('/auth/logout', body('POST')),
  dashboard: () => request<Dashboard>('/dashboard'),
  checkAll: () => request<{ jobId: string }>('/ddns/check', body('POST')),
  forceAll: () => request<{ jobId: string }>('/ddns/force-update', body('POST')),
  accounts: () => request<{ accounts: Account[] }>('/cloudflare/accounts'),
  addAccount: (data: { name: string; token: string }) => request<{ account: Account }>('/cloudflare/accounts', body('POST', data)),
  updateAccount: (id: string, data: { name: string; token?: string }) => request<{ account: Account }>(`/cloudflare/accounts/${id}`, body('PATCH', data)),
  testAccount: (id: string) => request<{ ok: boolean; message?: string }>(`/cloudflare/accounts/${id}/test`, body('POST')),
  syncAccount: (id: string) => request<{ jobId: string }>(`/cloudflare/accounts/${id}/sync`, body('POST')),
  deleteAccount: (id: string) => request<void>(`/cloudflare/accounts/${id}`, body('DELETE')),
  records: () => request<{ records: RecordItem[] }>('/records'),
  createRecord: (data: Omit<RecordItem, 'id' | 'status' | 'lastCheckedAt' | 'lastUpdatedAt'>) => request<{ record: RecordItem }>('/records', body('POST', data)),
  updateRecord: (id: string, data: Partial<RecordItem>) => request<{ record: RecordItem }>(`/records/${id}`, body('PATCH', data)),
  toggleRecord: (id: string, enabled: boolean) => request<{ record: RecordItem }>(`/records/${id}/enabled`, body('PATCH', { enabled })),
  checkRecord: (id: string) => request<{ jobId: string }>(`/records/${id}/check`, body('POST')),
  forceRecord: (id: string) => request<{ jobId: string }>(`/records/${id}/force-update`, body('POST')),
  deleteRecord: (id: string) => request<void>(`/records/${id}`, body('DELETE')),
  history: (query: URLSearchParams) => request<Page<HistoryItem>>(`/history?${query}`),
  settings: () => request<Settings>('/settings'),
  updateSettings: (data: Settings) => request<{ settings: Settings }>('/settings', body('PUT', data)),
  updateProfile: (data: Pick<User, 'displayName' | 'email'>) => request<{ user: User }>('/auth/profile', body('PATCH', data)),
  changePassword: (data: { currentPassword: string; newPassword: string }) => request<void>('/auth/password', body('PUT', data))
};
