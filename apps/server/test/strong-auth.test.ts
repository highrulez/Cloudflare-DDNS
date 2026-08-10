import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { MFA_STRONG_REAUTH_TTL_MS, buildTotp, encryptTotpSecret } from '../src/security/mfa.js';
import { mockSiteverify, testConfig } from './helpers/config.js';

const password = 'correct horse battery staple';
const origin = 'https://ddns.example.com';
const cfToken = 'cf_test_token_abcdefghijklmnopqrstuvwxyz';

type AuditRow = {
  type: string;
  success: boolean;
  username?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
};

function createStrongAuthDatabase(initial: {
  id: string;
  username: string;
  passwordHash: string;
  mfaEnabled?: boolean;
  secretBase32?: string;
}) {
  const encrypted = initial.secretBase32
    ? encryptTotpSecret(initial.secretBase32, testConfig.ENCRYPTION_KEY)
    : null;
  const user = {
    id: initial.id,
    username: initial.username,
    passwordHash: initial.passwordHash,
    mfaEnabled: initial.mfaEnabled ?? false,
    mfaSecretCiphertext: encrypted?.ciphertext ?? null,
    mfaSecretIv: encrypted?.iv ?? null,
    mfaSecretAuthTag: encrypted?.authTag ?? null,
    mfaSecretKeyVersion: encrypted?.keyVersion ?? null,
    mfaEnabledAt: initial.mfaEnabled ? new Date() : null,
    mfaLastUsedStep: null as bigint | null
  };
  const audits: AuditRow[] = [];
  const sessions = new Map<
    string,
    {
      id: string;
      tokenHash: string;
      userId: string;
      expiresAt: Date;
      createdAt: Date;
      lastSeenAt: Date;
      stronglyAuthenticatedUntil: Date | null;
      user: { id: string; username: string };
    }
  >();
  const accounts = new Map<
    string,
    {
      id: string;
      name: string;
      tokenHint: string;
      tokenCiphertext: Uint8Array;
      tokenIv: Uint8Array;
      tokenAuthTag: Uint8Array;
      tokenKeyVersion: number;
      verifiedAt: Date | null;
      lastError: string | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();
  const records = new Map<
    string,
    {
      id: string;
      hostname: string;
      type: 'A' | 'AAAA';
      content: string;
      accountId: string;
      zoneId: string;
      cloudflareRecordId: string | null;
    }
  >();
  let seq = 0;

  const database = {
    user: {
      findUnique: async ({ where }: { where: { username?: string; id?: string } }) => {
        if (where.username) return where.username === user.username ? { ...user } : null;
        if (where.id) return where.id === user.id ? { ...user } : null;
        return null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== user.id) throw new Error('not found');
        return { ...user };
      },
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<typeof user>;
      }) => {
        if (where.id !== user.id) throw new Error('not found');
        Object.assign(user, data);
        return { ...user };
      }
    },
    session: {
      create: async ({
        data
      }: {
        data: { tokenHash: string; userId: string; expiresAt: Date };
      }) => {
        seq += 1;
        const now = new Date();
        const row = {
          id: `session-${seq}`,
          ...data,
          createdAt: now,
          lastSeenAt: now,
          stronglyAuthenticatedUntil: null as Date | null,
          user: { id: user.id, username: user.username }
        };
        sessions.set(data.tokenHash, row);
        return row;
      },
      findUnique: async ({
        where,
        select,
        include
      }: {
        where: { tokenHash?: string; id?: string };
        select?: Record<string, boolean>;
        include?: { user?: { select: Record<string, boolean> } };
      }) => {
        let row:
          | {
              id: string;
              tokenHash: string;
              userId: string;
              expiresAt: Date;
              createdAt: Date;
              lastSeenAt: Date;
              stronglyAuthenticatedUntil: Date | null;
              user: { id: string; username: string };
            }
          | undefined;
        if (where.tokenHash) row = sessions.get(where.tokenHash);
        if (where.id) {
          for (const session of sessions.values()) if (session.id === where.id) row = session;
        }
        if (!row) return null;
        if (include?.user) return { ...row, user: { id: user.id, username: user.username } };
        if (select) {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) picked[key] = (row as Record<string, unknown>)[key];
          }
          return picked;
        }
        return row;
      },
      findMany: async ({
        where
      }: {
        where: { userId: string };
        select?: Record<string, boolean>;
        orderBy?: Record<string, string>;
      }) =>
        [...sessions.values()]
          .filter((session) => session.userId === where.userId)
          .map((session) => ({ ...session })),
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        for (const session of sessions.values()) {
          if (session.id === where.id) {
            Object.assign(session, data);
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
      deleteMany: async ({
        where
      }: {
        where: {
          tokenHash?: string;
          userId?: string;
          id?: string | { not: string };
        };
      }) => {
        let count = 0;
        for (const [hash, session] of sessions) {
          if (where.tokenHash && session.tokenHash !== where.tokenHash) continue;
          if (where.userId && session.userId !== where.userId) continue;
          if (typeof where.id === 'string' && session.id !== where.id) continue;
          if (
            where.id &&
            typeof where.id === 'object' &&
            'not' in where.id &&
            session.id === where.id.not
          ) {
            continue;
          }
          if (where.tokenHash || where.userId || where.id) {
            sessions.delete(hash);
            count += 1;
          }
        }
        return { count };
      }
    },
    cloudflareAccount: {
      findMany: async () =>
        [...accounts.values()].map((account) => ({
          ...account,
          zones: [],
          _count: { records: 0 }
        })),
      create: async ({
        data,
        select
      }: {
        data: {
          name: string;
          tokenCiphertext: Uint8Array;
          tokenIv: Uint8Array;
          tokenAuthTag: Uint8Array;
          tokenKeyVersion: number;
          tokenHint: string;
          verifiedAt: Date;
          zones: { create: unknown[] };
        };
        select?: Record<string, boolean | object>;
      }) => {
        seq += 1;
        const now = new Date();
        const row = {
          id: `account-${seq}`,
          name: data.name,
          tokenHint: data.tokenHint,
          tokenCiphertext: data.tokenCiphertext,
          tokenIv: data.tokenIv,
          tokenAuthTag: data.tokenAuthTag,
          tokenKeyVersion: data.tokenKeyVersion,
          verifiedAt: data.verifiedAt,
          lastError: null as string | null,
          createdAt: now,
          updatedAt: now,
          zones: [] as unknown[]
        };
        accounts.set(row.id, row);
        if (select) {
          return {
            id: row.id,
            name: row.name,
            tokenHint: row.tokenHint,
            verifiedAt: row.verifiedAt,
            lastError: row.lastError,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            zones: []
          };
        }
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const row = accounts.get(where.id);
        accounts.delete(where.id);
        return row;
      },
      update: async ({
        where,
        data,
        select
      }: {
        where: { id: string };
        data: Record<string, unknown>;
        select?: Record<string, boolean>;
      }) => {
        const row = accounts.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        if (select) {
          return {
            id: row.id,
            name: row.name,
            tokenHint: row.tokenHint,
            verifiedAt: row.verifiedAt,
            lastError: row.lastError,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
          };
        }
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => accounts.get(where.id) ?? null
    },
    managedDnsRecord: {
      findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const row = records.get(where.id);
        records.delete(where.id);
        return row;
      },
      count: async ({ where }: { where: { accountId: string } }) => {
        let count = 0;
        for (const record of records.values()) {
          if (record.accountId === where.accountId) count += 1;
        }
        return count;
      }
    },
    ddnsRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        return { id: `run-${seq}`, ...data };
      }
    },
    ddnsUpdateLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        return { id: `log-${seq}`, ...data };
      }
    },
    authAuditEvent: {
      create: async ({ data }: { data: AuditRow }) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      }
    },
    $transaction: async (input: unknown) => {
      if (Array.isArray(input)) return Promise.all(input);
      if (typeof input === 'function') {
        const run = input as (tx: typeof database) => Promise<unknown>;
        return run(database);
      }
      return input;
    },
    schedulerState: { findUnique: async () => null },
    ipDetectionRun: { findFirst: async () => null },
    $queryRaw: async () => [1],
    $disconnect: async () => undefined,
    __audits: audits,
    __sessions: sessions,
    __accounts: accounts,
    __records: records,
    __user: user
  };

  return database as unknown as PrismaClient & {
    __audits: AuditRow[];
    __sessions: Map<string, { stronglyAuthenticatedUntil: Date | null; id: string }>;
    __accounts: Map<string, { tokenHint: string; tokenCiphertext: Uint8Array }>;
    __records: typeof records;
    __user: typeof user;
  };
}

function cookieValue(header: string | string[] | undefined, name: string) {
  const raw = Array.isArray(header) ? header : header ? [header] : [];
  for (const item of raw) {
    const match = item.match(new RegExp(`${name}=([^;]+)`));
    if (match) return `${name}=${match[1]}`;
  }
  return '';
}

function mockCloudflareApi(): typeof fetch {
  const jsonResponse = (payload: unknown) =>
    ({
      ok: true,
      headers: { get: () => null },
      json: async () => payload
    }) as unknown as Response;

  return async (input) => {
    const url = String(input);
    if (url.includes('challenges.cloudflare.com') || url.includes('siteverify')) {
      return mockSiteverify({
        success: true,
        hostname: 'ddns.example.com',
        action: 'login'
      })(input);
    }
    if (url.includes('/user/tokens/verify')) {
      return jsonResponse({ success: true, result: { id: 'tok', status: 'active' } });
    }
    if (url.includes('/zones?')) {
      return jsonResponse({
        success: true,
        result: [{ id: 'zone-1', name: 'example.com', status: 'active' }]
      });
    }
    if (url.includes('/dns_records')) {
      return jsonResponse({ success: true, result: [] });
    }
    return jsonResponse({ success: true, result: {} });
  };
}

async function loginSession(app: Awaited<ReturnType<typeof buildApp>>, username = 'administrator') {
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin, 'x-forwarded-proto': 'https' },
    payload: { username, password, turnstileToken: 'token' }
  });
  expect(login.statusCode).toBe(200);
  return cookieValue(login.headers['set-cookie'], testConfig.COOKIE_NAME);
}

describe('Sensitive action strong authentication', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(mockCloudflareApi());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects protected Cloudflare credential endpoints without strong auth', async () => {
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const cookie = await loginSession(app);

    const create = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/accounts',
      headers: { origin, cookie },
      payload: { name: 'Primary', token: cfToken }
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe('STRONG_AUTH_REQUIRED');
    expect(database.__accounts.size).toBe(0);

    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/cloudflare/accounts/account-1',
      headers: { origin, cookie }
    });
    expect(remove.statusCode).toBe(403);
    expect(remove.json().error.code).toBe('STRONG_AUTH_REQUIRED');
    await app.close();
  });

  it('accepts password reauth when MFA is disabled and unlocks protected actions', async () => {
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const cookie = await loginSession(app);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password: 'wrong password!!' }
    });
    expect(wrong.statusCode).toBe(401);
    expect(database.__audits.some((row) => row.type === 'REAUTH_FAILED')).toBe(true);

    const reauth = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password }
    });
    expect(reauth.statusCode).toBe(200);
    expect(reauth.json().recentlyStronglyAuthenticated).toBe(true);
    expect(database.__audits.some((row) => row.type === 'REAUTH_SUCCESS')).toBe(true);

    const create = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/accounts',
      headers: { origin, cookie },
      payload: { name: 'Primary', token: cfToken }
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().tokenHint).toBeTruthy();
    expect(JSON.stringify(create.json())).not.toContain(cfToken);
    expect(database.__audits.some((row) => row.type === 'CLOUDFLARE_CREDENTIAL_ADDED')).toBe(true);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/cloudflare/accounts',
      headers: { cookie }
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(cfToken);

    const accountId = create.json().id as string;
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/cloudflare/accounts/${accountId}`,
      headers: { origin, cookie }
    });
    expect(deleted.statusCode).toBe(204);
    expect(database.__audits.some((row) => row.type === 'CLOUDFLARE_CONNECTION_REMOVED')).toBe(
      true
    );

    for (const row of database.__audits) {
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(password);
      expect(serialized).not.toContain(cfToken);
      expect(serialized).not.toContain(testConfig.SESSION_SECRET);
    }
    await app.close();
  });

  it('requires password + TOTP for reauth when MFA is enabled', async () => {
    const secretBase32 = 'JBSWY3DPEHPK3PXP';
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password),
      mfaEnabled: true,
      secretBase32
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });

    // Create a normal session first (login would require MFA challenge when enabled).
    database.__user.mfaEnabled = false;
    const cookie = await loginSession(app);
    database.__user.mfaEnabled = true;

    const missingCode = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password }
    });
    expect(missingCode.statusCode).toBe(401);
    expect(missingCode.json().error.code).toBe('MFA_REQUIRED');

    const wrongCode = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password, code: '000000' }
    });
    expect(wrongCode.statusCode).toBe(401);
    expect(wrongCode.json().error.code).toBe('MFA_INVALID');

    const code = buildTotp(secretBase32, 'administrator').generate();
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password, code }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().recentlyStronglyAuthenticated).toBe(true);
    await app.close();
  });

  it('rejects expired strong auth and enforces the five-minute window', async () => {
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const cookie = await loginSession(app);

    await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password }
    });

    for (const session of database.__sessions.values()) {
      expect(session.stronglyAuthenticatedUntil).toBeInstanceOf(Date);
      const remaining =
        session.stronglyAuthenticatedUntil!.getTime() - Date.now();
      expect(remaining).toBeGreaterThan(MFA_STRONG_REAUTH_TTL_MS - 5_000);
      expect(remaining).toBeLessThanOrEqual(MFA_STRONG_REAUTH_TTL_MS);
      session.stronglyAuthenticatedUntil = new Date(Date.now() - 1_000);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/cloudflare/accounts',
      headers: { origin, cookie },
      payload: { name: 'Expired', token: cfToken }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('STRONG_AUTH_REQUIRED');
    await app.close();
  });

  it('rate limits failed reauth attempts per session', async () => {
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const cookie = await loginSession(app);

    for (let i = 0; i < 5; i += 1) {
      const attempt = await app.inject({
        method: 'POST',
        url: '/api/auth/reauth',
        headers: { origin, cookie },
        payload: { password: 'wrong password!!' }
      });
      expect([401, 429]).toContain(attempt.statusCode);
    }

    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password: 'wrong password!!' }
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(database.__audits.some((row) => row.type === 'REAUTH_RATE_LIMITED')).toBe(true);

    const stillLimited = await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password }
    });
    expect(stillLimited.statusCode).toBe(429);
    await app.close();
  });

  it('requires strong auth for DNS delete from Cloudflare but not stop-managing', async () => {
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    database.__records.set('record-1', {
      id: 'record-1',
      hostname: 'nas.example.com',
      type: 'A',
      content: '203.0.113.10',
      accountId: 'account-1',
      zoneId: 'zone-1',
      cloudflareRecordId: 'cf-rec-1'
    });
    database.__records.set('record-2', {
      id: 'record-2',
      hostname: 'vpn.example.com',
      type: 'A',
      content: '203.0.113.20',
      accountId: 'account-1',
      zoneId: 'zone-1',
      cloudflareRecordId: 'cf-rec-2'
    });

    const app = await buildApp(database, testConfig, { startScheduler: false });
    const cookie = await loginSession(app);

    const deleteCf = await app.inject({
      method: 'DELETE',
      url: '/api/records/record-1/cloudflare',
      headers: { origin, cookie },
      payload: { confirmation: 'nas.example.com' }
    });
    expect(deleteCf.statusCode).toBe(403);
    expect(deleteCf.json().error.code).toBe('STRONG_AUTH_REQUIRED');
    expect(database.__records.has('record-1')).toBe(true);

    const stop = await app.inject({
      method: 'DELETE',
      url: '/api/records/record-2',
      headers: { origin, cookie }
    });
    expect(stop.statusCode).toBe(204);
    expect(database.__records.has('record-2')).toBe(false);
    expect(database.__records.has('record-1')).toBe(true);
    await app.close();
  });

  it('requires strong auth to revoke other sessions and never returns raw session ids', async () => {
    const database = createStrongAuthDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });
    const cookie = await loginSession(app);

    // Seed a second session.
    await database.session.create({
      data: {
        tokenHash: 'other-session-hash'.padEnd(64, '0').slice(0, 64),
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000)
      }
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { cookie }
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json<{ items: Array<Record<string, unknown>> }>();
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(body)).not.toMatch(/session-/);
    expect(body.items.every((item) => !('id' in item) && !('tokenHash' in item))).toBe(true);

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-others',
      headers: { origin, cookie }
    });
    expect(blocked.statusCode).toBe(403);

    await app.inject({
      method: 'POST',
      url: '/api/auth/reauth',
      headers: { origin, cookie },
      payload: { password }
    });
    const revoked = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-others',
      headers: { origin, cookie }
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().revoked).toBeGreaterThanOrEqual(1);
    expect(database.__audits.some((row) => row.type === 'SECURITY_SETTING_CHANGED')).toBe(true);
    await app.close();
  });
});
