import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { verifyTurnstileToken, TurnstileError } from '../src/security/turnstile.js';
import { LoginLimiter } from '../src/security/sessions.js';
import {
  mockSiteverify,
  testConfig,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY
} from './helpers/config.js';

type AuditRow = {
  type: string;
  success: boolean;
  username?: string | null;
  sourceIp?: string | null;
};

function createAuthDatabase(user?: {
  id: string;
  username: string;
  passwordHash: string;
}) {
  const audits: AuditRow[] = [];
  const sessions = new Map<
    string,
    {
      id: string;
      tokenHash: string;
      userId: string;
      expiresAt: Date;
      user: { id: string; username: string };
    }
  >();
  let sessionSeq = 0;

  const database = {
    user: {
      findUnique: async ({ where }: { where: { username?: string; id?: string } }) => {
        if (!user) return null;
        if (where.username) return where.username === user.username ? user : null;
        if (where.id) return where.id === user.id ? user : null;
        return null;
      }
    },
    session: {
      create: async ({
        data
      }: {
        data: { tokenHash: string; userId: string; expiresAt: Date };
      }) => {
        sessionSeq += 1;
        const row = {
          id: `session-${sessionSeq}`,
          ...data,
          user: { id: user!.id, username: user!.username }
        };
        sessions.set(data.tokenHash, row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        sessions.get(where.tokenHash) ?? null,
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: { expiresAt: Date; lastSeenAt?: Date };
      }) => {
        for (const session of sessions.values()) {
          if (session.id === where.id) {
            session.expiresAt = data.expiresAt;
            return session;
          }
        }
        return null;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const [hash, session] of sessions) {
          if (session.id === where.id) {
            sessions.delete(hash);
            return session;
          }
        }
        return null;
      },
      deleteMany: async ({ where }: { where: { tokenHash?: string; userId?: string } }) => {
        let count = 0;
        for (const [hash, session] of sessions) {
          if (
            (where.tokenHash && session.tokenHash === where.tokenHash) ||
            (where.userId && session.userId === where.userId)
          ) {
            sessions.delete(hash);
            count += 1;
          }
        }
        return { count };
      }
    },
    authAuditEvent: {
      create: async ({ data }: { data: AuditRow }) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      }
    },
    schedulerState: { findUnique: async () => null },
    ipDetectionRun: { findFirst: async () => null },
    $queryRaw: async () => [1],
    $disconnect: async () => undefined,
    __audits: audits,
    __sessions: sessions
  };

  return database as unknown as PrismaClient & {
    __audits: AuditRow[];
    __sessions: Map<string, unknown>;
  };
}

describe('Turnstile siteverify', () => {
  const config = { ...testConfig };

  it('accepts a successful siteverify payload', async () => {
    await expect(
      verifyTurnstileToken(
        config,
        'valid-token',
        '203.0.113.10',
        mockSiteverify({
          success: true,
          hostname: 'dns.highrulez.com',
          action: 'login'
        })
      )
    ).resolves.toBeUndefined();
  });

  it('rejects missing, oversized, failed, wrong hostname, wrong action, timeout, and unavailable', async () => {
    await expect(verifyTurnstileToken(config, '', '1.1.1.1', mockSiteverify({ success: true }))).rejects.toBeInstanceOf(
      TurnstileError
    );
    await expect(
      verifyTurnstileToken(config, 'x'.repeat(2049), '1.1.1.1', mockSiteverify({ success: true }))
    ).rejects.toBeInstanceOf(TurnstileError);
    await expect(
      verifyTurnstileToken(
        config,
        'token',
        '1.1.1.1',
        mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] })
      )
    ).rejects.toBeInstanceOf(TurnstileError);
    await expect(
      verifyTurnstileToken(
        config,
        'token',
        '1.1.1.1',
        mockSiteverify({ success: true, hostname: 'evil.example', action: 'login' })
      )
    ).rejects.toBeInstanceOf(TurnstileError);
    await expect(
      verifyTurnstileToken(
        config,
        'token',
        '1.1.1.1',
        mockSiteverify({ success: true, hostname: 'dns.highrulez.com', action: 'signup' })
      )
    ).rejects.toBeInstanceOf(TurnstileError);
    await expect(
      verifyTurnstileToken(
        config,
        'token',
        '1.1.1.1',
        mockSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] })
      )
    ).rejects.toBeInstanceOf(TurnstileError);
    await expect(
      verifyTurnstileToken(config, 'token', '1.1.1.1', mockSiteverify({}, { throwNetwork: true }))
    ).rejects.toBeInstanceOf(TurnstileError);
    await expect(
      verifyTurnstileToken(config, 'token', '1.1.1.1', mockSiteverify({}, { malformed: true }))
    ).rejects.toBeInstanceOf(TurnstileError);

    const shortTimeout = { ...config, TURNSTILE_VERIFY_TIMEOUT_MS: 20 };
    await expect(
      verifyTurnstileToken(
        shortTimeout,
        'token',
        '1.1.1.1',
        async (_url, init) => {
          await new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          });
          throw new Error('unreachable');
        }
      )
    ).rejects.toBeInstanceOf(TurnstileError);
  });
});

describe('authentication security sprint', () => {
  const password = 'correct horse battery staple';

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockSiteverify({
        success: true,
        hostname: 'dns.highrulez.com',
        action: 'login'
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs in with valid credentials and Turnstile, regenerates the session, and logs out', async () => {
    const user = {
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    };
    const database = createAuthDatabase(user);
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const preLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.10',
      headers: {
        origin: 'https://dns.highrulez.com',
        'user-agent': 'security-test',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'dns.highrulez.com'
      },
      payload: {
        username: user.username,
        password,
        turnstileToken: 'turnstile-token-1'
      }
    });
    expect(preLogin.statusCode).toBe(200);
    const firstCookie = String(
      Array.isArray(preLogin.headers['set-cookie'])
        ? preLogin.headers['set-cookie'][0]
        : preLogin.headers['set-cookie']
    );
    const firstToken = firstCookie.split(';')[0]!.split('=')[1]!;

    const secondLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.10',
      headers: {
        origin: 'https://dns.highrulez.com',
        cookie: firstCookie.split(';')[0]!,
        'x-forwarded-proto': 'https'
      },
      payload: {
        username: user.username,
        password,
        turnstileToken: 'turnstile-token-2'
      }
    });
    expect(secondLogin.statusCode).toBe(200);
    const secondCookie = String(
      Array.isArray(secondLogin.headers['set-cookie'])
        ? secondLogin.headers['set-cookie'][0]
        : secondLogin.headers['set-cookie']
    );
    const secondToken = secondCookie.split(';')[0]!.split('=')[1]!;
    expect(secondToken).not.toBe(firstToken);

    const stale = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `cloudflare_ddns_session=${firstToken}` }
    });
    expect(stale.statusCode).toBe(401);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        origin: 'https://dns.highrulez.com',
        cookie: secondCookie.split(';')[0]!
      }
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: secondCookie.split(';')[0]! }
    });
    expect(afterLogout.statusCode).toBe(401);

    const types = database.__audits.map((row) => row.type);
    expect(types).toContain('LOGIN_SUCCESS');
    expect(types).toContain('LOGOUT');
    const serialized = JSON.stringify(database.__audits);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(TURNSTILE_TEST_SECRET_KEY);
    expect(serialized).not.toContain('turnstile-token');
    expect(serialized).not.toContain(firstToken);
    expect(serialized).not.toContain(secondToken);

    await app.close();
  });

  it('rejects missing and invalid Turnstile tokens with a generic message', async () => {
    const user = {
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    };
    const database = createAuthDatabase(user);
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://dns.highrulez.com' },
      payload: { username: user.username, password }
    });
    expect(missing.statusCode).toBe(400);

    vi.mocked(globalThis.fetch).mockImplementationOnce(
      mockSiteverify({ success: false, 'error-codes': ['invalid-input-response'] })
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://dns.highrulez.com' },
      payload: {
        username: user.username,
        password,
        turnstileToken: 'bad-token'
      }
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json().error.message).toBe('Security verification failed. Please try again.');
    expect(invalid.json().error.message).not.toContain('invalid-input-response');
    expect(database.__audits.some((row) => row.type === 'TURNSTILE_FAILED')).toBe(true);

    await app.close();
  });

  it('returns the same message for unknown usernames and wrong passwords', async () => {
    const user = {
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    };
    const database = createAuthDatabase(user);
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://dns.highrulez.com' },
      payload: {
        username: 'nobody',
        password,
        turnstileToken: 'token-a'
      }
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://dns.highrulez.com' },
      payload: {
        username: user.username,
        password: 'wrong password here!!',
        turnstileToken: 'token-b'
      }
    });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe('Invalid username or password.');
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
    expect(database.__audits.every((row) => row.type === 'LOGIN_FAILED' && !row.username)).toBe(
      true
    );

    await app.close();
  });

  it('rate-limits failed logins with HTTP 429 and Retry-After', async () => {
    const user = {
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    };
    const database = createAuthDatabase(user);
    const app = await buildApp(database, testConfig, { startScheduler: false });

    for (let index = 0; index < 4; index += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '198.51.100.20',
        headers: { origin: 'https://dns.highrulez.com' },
        payload: {
          username: user.username,
          password: 'wrong password here!!',
          turnstileToken: `token-${index}`
        }
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '198.51.100.20',
      headers: { origin: 'https://dns.highrulez.com' },
      payload: {
        username: user.username,
        password: 'wrong password here!!',
        turnstileToken: 'token-final'
      }
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
    expect(limited.json().error.message).toBe('Too many login attempts. Please try again later.');
    expect(database.__audits.some((row) => row.type === 'LOGIN_RATE_LIMITED')).toBe(true);

    await app.close();
  });

  it('exposes only the public Turnstile site key', async () => {
    const database = createAuthDatabase();
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const response = await app.inject({ method: 'GET', url: '/api/auth/turnstile' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      siteKey: TURNSTILE_TEST_SITE_KEY,
      expectedHostname: 'dns.highrulez.com',
      expectedAction: 'login'
    });
    expect(JSON.stringify(response.json())).not.toContain(TURNSTILE_TEST_SECRET_KEY);
    await app.close();
  });

  it('rejects expired sessions and records SESSION_EXPIRED', async () => {
    const user = {
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    };
    const database = createAuthDatabase(user);
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        origin: 'https://dns.highrulez.com',
        'x-forwarded-proto': 'https'
      },
      payload: {
        username: user.username,
        password,
        turnstileToken: 'token-ok'
      }
    });
    const cookie = String(
      Array.isArray(login.headers['set-cookie'])
        ? login.headers['set-cookie'][0]
        : login.headers['set-cookie']
    ).split(';')[0]!;

    for (const session of database.__sessions.values()) {
      (session as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1000);
    }

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie }
    });
    expect(me.statusCode).toBe(401);
    expect(database.__audits.some((row) => row.type === 'SESSION_EXPIRED')).toBe(true);
    await app.close();
  });

  it('requires Turnstile keys in production config', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'mysql://user:password@127.0.0.1:3307/ddns',
        SESSION_SECRET: 'a-session-secret-that-is-longer-than-32-characters',
        ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
        APP_ORIGIN: 'https://dns.highrulez.com',
        COOKIE_SECURE: 'true'
      })
    ).toThrow(/TURNSTILE/);
  });
});

describe('login limiter', () => {
  it('blocks after five failures in the window and clears on success', () => {
    const limiter = new LoginLimiter(5, 60_000);
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.recordFailure('ip').blocked).toBe(index === 4);
    }
    expect(limiter.status('ip').blocked).toBe(true);
    expect(limiter.status('ip').retryAfterSeconds).toBeGreaterThan(0);
    limiter.clear('ip');
    expect(limiter.status('ip').blocked).toBe(false);
  });
});
