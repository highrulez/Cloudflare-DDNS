import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { mockSiteverify, testConfig } from './helpers/config.js';

describe('authentication smoke flow', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockSiteverify({
        success: true,
        hostname: 'ddns.example.com',
        action: 'login'
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs in, restores the session, and reports healthy', async () => {
    const user = {
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash('correct horse battery staple')
    };
    let storedSession:
      | {
          id: string;
          tokenHash: string;
          userId: string;
          expiresAt: Date;
          user: { id: string; username: string };
        }
      | undefined;
    const database = {
      user: {
        findUnique: async ({ where }: { where: { username: string } }) =>
          where.username === user.username ? user : null
      },
      session: {
        create: async ({
          data
        }: {
          data: { tokenHash: string; userId: string; expiresAt: Date };
        }) => {
          storedSession = {
            id: 'session-1',
            ...data,
            user: { id: user.id, username: user.username }
          };
          return storedSession;
        },
        findUnique: async ({ where }: { where: { tokenHash: string } }) =>
          storedSession?.tokenHash === where.tokenHash ? storedSession : null,
        update: async () => storedSession,
        delete: async () => undefined,
        deleteMany: async () => ({ count: 0 })
      },
      authAuditEvent: {
        create: async () => ({ id: 'audit-1' })
      },
      schedulerState: { findUnique: async () => null },
      ipDetectionRun: { findFirst: async () => null },
      $queryRaw: async () => [1],
      $disconnect: async () => undefined
    } as unknown as PrismaClient;
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.0.1',
      headers: {
        origin: 'https://ddns.example.com',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'ddns.example.com'
      },
      payload: {
        username: user.username,
        password: 'correct horse battery staple',
        turnstileToken: 'test-turnstile-token'
      }
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0];
    expect(cookie).toContain('cloudflare_ddns_session=');
    expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toContain('Secure');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie! }
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: { id: user.id, username: user.username } });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});
