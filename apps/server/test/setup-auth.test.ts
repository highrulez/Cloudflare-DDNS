import type { PrismaClient } from '@ddns/database';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const config = {
  NODE_ENV: 'test',
  APP_HOST: '127.0.0.1',
  APP_PORT: 8090,
  APP_ORIGIN: 'https://dns.highrulez.com',
  APP_ALLOWED_ORIGINS: ['https://dns.highrulez.com', 'http://192.168.68.100:8090'],
  DATABASE_URL: 'mysql://user:password@127.0.0.1:3307/ddns',
  SESSION_SECRET: 'a-session-secret-that-is-longer-than-32-characters',
  ENCRYPTION_KEY: Buffer.alloc(32),
  COOKIE_NAME: 'cloudflare_ddns_session',
  COOKIE_SECURE: true,
  SESSION_TTL_SECONDS: 3600,
  CLOUDFLARE_API_BASE: 'https://api.cloudflare.com/client/v4',
  IPV4_PROVIDERS: ['https://api4.ipify.org'],
  IPV6_PROVIDERS: ['https://api6.ipify.org'],
  HTTP_TIMEOUT_MS: 5000
} satisfies Config;

describe('setup authorization', () => {
  it('requires the created administrator for remaining setup operations', async () => {
    const database = {
      user: { count: async () => 1 },
      $disconnect: async () => undefined
    } as unknown as PrismaClient;
    const app = await buildApp(database, config, { startScheduler: false });

    const response = await app.inject({
      method: 'GET',
      url: '/api/setup/cloudflare/accounts'
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });
});
