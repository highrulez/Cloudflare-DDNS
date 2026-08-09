import type { PrismaClient } from '@ddns/database';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

describe('setup body handling', () => {
  it('accepts an empty setup-complete POST without JSON parsing failure', async () => {
    const database = {
      setupState: { findUnique: async () => null },
      user: { count: async () => 0 },
      cloudflareAccount: { count: async () => 0 },
      managedDnsRecord: { count: async () => 0 },
      $disconnect: async () => undefined
    } as unknown as PrismaClient;
    const config: Config = {
      NODE_ENV: 'test',
      APP_HOST: '127.0.0.1',
      APP_PORT: 8090,
      DATABASE_URL: 'mysql://user:password@localhost:3306/ddns',
      SESSION_SECRET: 'a-session-secret-that-is-longer-than-32-characters',
      ENCRYPTION_KEY: Buffer.alloc(32),
      COOKIE_NAME: 'cloudflare_ddns_session',
      COOKIE_SECURE: false,
      SESSION_TTL_SECONDS: 3600,
      CLOUDFLARE_API_BASE: 'https://api.cloudflare.com/client/v4',
      IPV4_PROVIDERS: ['https://api.ipify.org'],
      IPV6_PROVIDERS: ['https://api6.ipify.org'],
      HTTP_TIMEOUT_MS: 5000
    };
    const app = await buildApp(database, config, { startScheduler: false });
    const response = await app.inject({ method: 'POST', url: '/api/setup/complete' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SETUP_INCOMPLETE');
    expect(response.json().message).not.toBe(
      "Body cannot be empty when content-type is set to 'application/json'"
    );
    await app.close();
  });
});
