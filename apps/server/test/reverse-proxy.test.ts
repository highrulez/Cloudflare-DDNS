import type { PrismaClient } from '@ddns/database';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

describe('Synology reverse proxy', () => {
  it('trusts forwarded protocol, host, port, and client address', async () => {
    const database = { $disconnect: async () => undefined } as unknown as PrismaClient;
    const config = {
      NODE_ENV: 'test',
      APP_HOST: '0.0.0.0',
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
      HTTP_TIMEOUT_MS: 5000,
      TURNSTILE_EXPECTED_HOSTNAME: 'dns.highrulez.com',
      TURNSTILE_EXPECTED_ACTION: 'login',
      TURNSTILE_VERIFY_TIMEOUT_MS: 5000
    } satisfies Config;
    const app = await buildApp(database, config, { startScheduler: false });
    app.get('/test-proxy', async (request) => ({
      protocol: request.protocol,
      hostname: request.hostname,
      ip: request.ip,
      port: request.headers['x-forwarded-port']
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/test-proxy',
      headers: {
        host: '127.0.0.1:8090',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'dns.highrulez.com',
        'x-forwarded-port': '443',
        'x-forwarded-for': '203.0.113.25, 127.0.0.1'
      }
    });

    expect(response.json()).toEqual({
      protocol: 'https',
      hostname: 'dns.highrulez.com',
      ip: '203.0.113.25',
      port: '443'
    });

    const direct = await app.inject({
      method: 'GET',
      url: '/test-proxy',
      remoteAddress: '192.168.1.50',
      headers: {
        host: '192.168.1.10:8090',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-for': '203.0.113.99'
      }
    });
    expect(direct.json()).toMatchObject({
      protocol: 'http',
      hostname: '192.168.1.10',
      ip: '192.168.1.50'
    });
    await app.close();
  });
});
