import type { PrismaClient } from '@ddns/database';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { testConfig } from './helpers/config.js';

describe('LAN HTTP vs HTTPS CSP regression', () => {
  const database = {
    $queryRaw: async () => [1],
    $disconnect: async () => undefined
  } as unknown as PrismaClient;

  it('does not emit upgrade-insecure-requests on HTTP (LAN diagnostics)', async () => {
    const app = await buildApp(
      database,
      { ...testConfig, NODE_ENV: 'production' },
      { startScheduler: false }
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '192.0.2.10',
      headers: { host: '192.0.2.10:8090' }
    });

    expect(response.statusCode).toBe(200);
    const csp = String(response.headers['content-security-policy'] ?? '');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://challenges.cloudflare.com');
    expect(csp).not.toContain('upgrade-insecure-requests');
    await app.close();
  });

  it('emits upgrade-insecure-requests only for HTTPS production responses', async () => {
    const app = await buildApp(
      database,
      { ...testConfig, NODE_ENV: 'production' },
      { startScheduler: false }
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '127.0.0.1',
      headers: {
        host: '127.0.0.1:8090',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'ddns.example.com'
      }
    });

    expect(response.statusCode).toBe(200);
    const csp = String(response.headers['content-security-policy'] ?? '');
    expect(csp).toContain('upgrade-insecure-requests');
    await app.close();
  });

  it('exposes public auth bootstrap without secrets', async () => {
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const response = await app.inject({ method: 'GET', url: '/api/auth/bootstrap' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      appOrigin: 'https://ddns.example.com',
      turnstileExpectedHostname: 'ddns.example.com',
      secureLoginRequiredHint: true
    });
    expect(JSON.stringify(response.json())).not.toContain(testConfig.TURNSTILE_SECRET_KEY);
    await app.close();
  });

  it('returns 401 for unauthenticated /api/auth/me without crashing the client contract', async () => {
    const authDb = {
      ...database,
      session: { findUnique: async () => null }
    } as unknown as PrismaClient;
    const app = await buildApp(authDb, testConfig, { startScheduler: false });
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });
});
