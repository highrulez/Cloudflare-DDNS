import { z } from 'zod';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const providerKeySchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
export type ProviderKey = z.infer<typeof providerKeySchema>;

export const connectionStatusSchema = z.enum([
  'PENDING',
  'CONNECTING',
  'ACTIVE',
  'DEGRADED',
  'FAILED',
  'REVOKED'
]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const jobStatusSchema = z.enum([
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'unknown'
]);

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(256)
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createConnectionSchema = z.object({
  providerKey: providerKeySchema,
  label: z.string().trim().min(1).max(80),
  credentials: z.record(z.string(), z.string().min(1).max(4096))
});
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const replaceCredentialSchema = z.object({
  credentials: z.record(z.string(), z.string().min(1).max(4096))
});

export const ddnsSelectionSchema = z.object({
  enabled: z.boolean()
});

export const providerDescriptorSchema = z.object({
  key: providerKeySchema,
  name: z.string(),
  description: z.string(),
  available: z.boolean(),
  credentialFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['password', 'text']),
      required: z.boolean()
    })
  ),
  capabilities: z.object({
    accounts: z.boolean(),
    zones: z.boolean(),
    records: z.boolean(),
    recordUpdates: z.boolean()
  })
});
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
}

const booleanEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const runtimeConfigShape = {
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  APP_ENCRYPTION_KEY: z.string().transform((value, context) => {
    const key = Buffer.from(value, 'base64');
    if (key.length !== 32 || key.toString('base64') !== value) {
      context.addIssue({
        code: 'custom',
        message: 'APP_ENCRYPTION_KEY must be canonical base64 for exactly 32 bytes'
      });
      return z.NEVER;
    }
    return key;
  }),
  APP_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
  CLOUDFLARE_API_BASE: z.string().url().default('https://api.cloudflare.com/client/v4'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(3_000),
  IP_OBSERVATION_CRON: z.string().default('*/5 * * * *'),
  PUBLIC_IPV4_URL: z.string().url().default('https://api.ipify.org'),
  PUBLIC_IPV6_URL: z.string().url().default('https://api6.ipify.org')
};

export const workerConfigSchema = z.object(runtimeConfigShape);
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export const appConfigSchema = z
  .object({
    ...runtimeConfigShape,
    ADMIN_EMAIL: z
      .string()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    ADMIN_PASSWORD: z.string().min(12).max(256),
    COOKIE_NAME: z.string().min(1).default('infra_hub_session'),
    COOKIE_SECURE: booleanEnv,
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(86_400),
    DATABASE_OPERATION_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    AUTH_PASSWORD_VERIFY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    AUTH_LOGIN_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(25_000),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean)
      )
  })
  .superRefine((value, context) => {
    if (value.COOKIE_SAME_SITE === 'none' && !value.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true when COOKIE_SAME_SITE is none'
      });
    }
  });
export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return appConfigSchema.parse(env);
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerConfigSchema.parse(env);
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  maskedHint: string;
}

const VAULT_AAD_PREFIX = 'infra-hub:provider-credential';

export function maskSecret(value: string): string {
  return `••••${value.slice(-4)}`;
}

export function encryptCredential(
  credentials: Record<string, string>,
  key: Buffer,
  connectionId: string,
  keyVersion = 1
): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${VAULT_AAD_PREFIX}:${keyVersion}:${connectionId}`));
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const values = Object.values(credentials);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
    maskedHint: maskSecret(values.at(-1) ?? '')
  };
}

export function decryptCredential(
  encrypted: Pick<EncryptedSecret, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>,
  key: Buffer,
  connectionId: string
): Record<string, string> {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAAD(Buffer.from(`${VAULT_AAD_PREFIX}:${encrypted.keyVersion}:${connectionId}`));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final()
  ]);
  return z.record(z.string(), z.string()).parse(JSON.parse(plaintext.toString('utf8')));
}

export interface ProviderAccountData {
  externalId: string;
  name: string;
  isSynthetic?: boolean;
}
export interface ProviderZoneData {
  externalId: string;
  accountExternalId: string;
  name: string;
  status?: string;
  nameservers: string[];
}
export interface ProviderRecordData {
  externalId: string;
  zoneExternalId: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number;
}
export interface ProviderDiscovery {
  accounts: ProviderAccountData[];
  zones: ProviderZoneData[];
  records: ProviderRecordData[];
}
export interface ProviderAdapter {
  descriptor: ProviderDescriptor;
  verify(credentials: Record<string, string>): Promise<void>;
  discover(credentials: Record<string, string>): Promise<ProviderDiscovery>;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  result_info?: { page: number; total_pages: number };
  errors?: Array<{ code: number; message: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class CloudflareAdapter implements ProviderAdapter {
  readonly descriptor: ProviderDescriptor = {
    key: 'cloudflare',
    name: 'Cloudflare',
    description: 'Cloudflare DNS using an API token',
    available: true,
    credentialFields: [{ key: 'apiToken', label: 'API token', type: 'password', required: true }],
    capabilities: { accounts: true, zones: true, records: true, recordUpdates: false }
  };

  constructor(private readonly apiBase = 'https://api.cloudflare.com/client/v4') {}

  private async request<T>(path: string, token: string): Promise<CloudflareEnvelope<T>> {
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
    });
    const body = (await response.json()) as CloudflareEnvelope<T>;
    if (!response.ok || !body.success) {
      const detail =
        body.errors?.map((error) => error.message).join('; ') || `HTTP ${response.status}`;
      throw new ProviderError(
        `Cloudflare request failed: ${detail}`,
        response.status >= 500 || response.status === 429
      );
    }
    return body;
  }

  private token(credentials: Record<string, string>): string {
    const token = credentials.apiToken;
    if (!token) throw new ProviderError('Cloudflare apiToken is required');
    return token;
  }

  async verify(credentials: Record<string, string>): Promise<void> {
    await this.request('/user/tokens/verify', this.token(credentials));
  }

  private async pages<T>(path: string, token: string): Promise<T[]> {
    const output: T[] = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const envelope = await this.request<T[]>(
        `${path}${separator}page=${page}&per_page=50`,
        token
      );
      output.push(...envelope.result);
      if (!envelope.result_info || page >= envelope.result_info.total_pages) break;
    }
    return output;
  }

  async discover(credentials: Record<string, string>): Promise<ProviderDiscovery> {
    const token = this.token(credentials);
    await this.verify(credentials);
    const rawAccounts = await this.pages<{ id: string; name: string }>('/accounts', token);
    const rawZones = await this.pages<{
      id: string;
      account: { id: string; name: string };
      name: string;
      status: string;
      name_servers?: string[];
    }>('/zones', token);
    const accounts = new Map(
      rawAccounts.map((account) => [
        account.id,
        { externalId: account.id, name: account.name, isSynthetic: false }
      ])
    );
    for (const zone of rawZones) {
      if (!accounts.has(zone.account.id)) {
        accounts.set(zone.account.id, {
          externalId: zone.account.id,
          name: zone.account.name || 'Cloudflare account',
          isSynthetic: true
        });
      }
    }
    const records: ProviderRecordData[] = [];
    for (const zone of rawZones) {
      const zoneRecords = await this.pages<{
        id: string;
        type: string;
        name: string;
        content: string;
        ttl: number;
        proxied?: boolean;
        priority?: number;
      }>(`/zones/${encodeURIComponent(zone.id)}/dns_records`, token);
      records.push(
        ...zoneRecords.map((record) => ({
          externalId: record.id,
          zoneExternalId: zone.id,
          type: record.type,
          name: record.name,
          content: record.content,
          ttl: record.ttl,
          ...(record.proxied === undefined ? {} : { proxied: record.proxied }),
          ...(record.priority === undefined ? {} : { priority: record.priority })
        }))
      );
    }
    return {
      accounts: [...accounts.values()].map(({ externalId, name, isSynthetic }) => ({
        externalId,
        name,
        isSynthetic
      })),
      zones: rawZones.map((zone) => ({
        externalId: zone.id,
        accountExternalId: zone.account.id,
        name: zone.name,
        status: zone.status,
        nameservers: zone.name_servers ?? []
      })),
      records
    };
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  register(adapter: ProviderAdapter): this {
    this.adapters.set(adapter.descriptor.key, adapter);
    return this;
  }
  get(key: string): ProviderAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new ProviderError(`Unsupported provider: ${key}`);
    return adapter;
  }
  catalog(): ProviderDescriptor[] {
    return [...this.adapters.values()].map((adapter) => adapter.descriptor);
  }
}

export function createProviderRegistry(cloudflareApiBase?: string): ProviderRegistry {
  return new ProviderRegistry().register(new CloudflareAdapter(cloudflareApiBase));
}
