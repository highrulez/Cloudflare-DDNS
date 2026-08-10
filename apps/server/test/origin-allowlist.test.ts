import type { PrismaClient } from '@ddns/database';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, resolveAllowedOrigins, type Config } from '../src/config.js';
import { sessionCookieSecure, setSessionCookie } from '../src/security/sessions.js';

const baseConfig = {
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

describe('allowed origins', () => {
  it('parses APP_ALLOWED_ORIGINS as an exact origin allowlist', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'mysql://user:password@127.0.0.1:3307/ddns',
      SESSION_SECRET: 'a-session-secret-that-is-longer-than-32-characters',
      ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      APP_ORIGIN: 'https://dns.highrulez.com',
      APP_ALLOWED_ORIGINS: 'https://dns.highrulez.com, http://192.168.68.100:8090 ',
      COOKIE_SECURE: 'true'
    });
    expect([...resolveAllowedOrigins(config)].sort()).toEqual([
      'http://192.168.68.100:8090',
      'https://dns.highrulez.com'
    ]);
  });

  it('accepts both canonical and LAN origins and rejects others', async () => {
    const database = { $disconnect: async () => undefined } as unknown as PrismaClient;
    const app = await buildApp(database, baseConfig, { startScheduler: false });

    const production = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://dns.highrulez.com' }
    });
    expect(production.statusCode).not.toBe(403);

    const lan = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'http://192.168.68.100:8090' }
    });
    expect(lan.statusCode).not.toBe(403);

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://evil.example' }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe('BAD_ORIGIN');

    const wildcardLike = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'https://app.highrulez.com' }
    });
    expect(wildcardLike.statusCode).toBe(403);

    await app.close();
  });

  it('keeps Secure cookies on HTTPS while allowing non-Secure cookies on LAN HTTP', async () => {
    const database = { $disconnect: async () => undefined } as unknown as PrismaClient;
    const app = await buildApp(database, baseConfig, { startScheduler: false });

    app.post('/test-cookie', async (request, reply) => {
      setSessionCookie(reply, baseConfig, 'token', new Date(Date.now() + 60_000), request);
      return { secure: sessionCookieSecure(request, baseConfig) };
    });

    const httpsCookie = await app.inject({
      method: 'POST',
      url: '/test-cookie',
      remoteAddress: '127.0.0.1',
      headers: {
        origin: 'https://dns.highrulez.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'dns.highrulez.com'
      }
    });
    expect(httpsCookie.json().secure).toBe(true);
    const httpsSetCookie = httpsCookie.headers['set-cookie'];
    const httpsHeader = Array.isArray(httpsSetCookie) ? httpsSetCookie[0] : httpsSetCookie;
    expect(httpsHeader).toContain('Secure');

    const lanCookie = await app.inject({
      method: 'POST',
      url: '/test-cookie',
      remoteAddress: '192.168.68.50',
      headers: {
        origin: 'http://192.168.68.100:8090',
        host: '192.168.68.100:8090'
      }
    });
    expect(lanCookie.json().secure).toBe(false);
    const lanSetCookie = lanCookie.headers['set-cookie'];
    const lanHeader = Array.isArray(lanSetCookie) ? lanSetCookie[0] : lanSetCookie;
    expect(lanHeader).toContain('cloudflare_ddns_session=');
    expect(lanHeader?.toLowerCase().includes('secure')).toBe(false);

    await app.close();
  });
});
