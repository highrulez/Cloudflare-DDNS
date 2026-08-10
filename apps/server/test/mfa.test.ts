import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  buildTotp,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  MFA_CHALLENGE_COOKIE,
  MFA_MAX_CHALLENGE_ATTEMPTS,
  verifyTotpCode
} from '../src/security/mfa.js';
import { mockSiteverify, testConfig } from './helpers/config.js';

const password = 'correct horse battery staple';
const origin = 'https://ddns.example.com';

type AuditRow = { type: string; success: boolean; username?: string | null };

function createMfaDatabase(initial: {
  id: string;
  username: string;
  passwordHash: string;
  mfaEnabled?: boolean;
  secretBase32?: string;
  recoveryCodes?: string[];
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
      stronglyAuthenticatedUntil: Date | null;
      user: { id: string; username: string };
    }
  >();
  const challenges = new Map<
    string,
    {
      id: string;
      tokenHash: string;
      userId: string;
      expiresAt: Date;
      failedAttempts: number;
      consumedAt: Date | null;
      user: typeof user;
    }
  >();
  const recovery = new Map<
    string,
    { id: string; userId: string; codeHash: string; usedAt: Date | null }
  >();
  let enrollment:
    | {
        id: string;
        userId: string;
        secretCiphertext: Uint8Array;
        secretIv: Uint8Array;
        secretAuthTag: Uint8Array;
        secretKeyVersion: number;
        expiresAt: Date;
      }
    | null = null;
  let seq = 0;

  for (const code of initial.recoveryCodes ?? []) {
    seq += 1;
    const codeHash = hashRecoveryCode(code, testConfig);
    recovery.set(codeHash, {
      id: `recovery-${seq}`,
      userId: user.id,
      codeHash,
      usedAt: null
    });
  }

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
        const row = {
          id: `session-${seq}`,
          ...data,
          stronglyAuthenticatedUntil: null as Date | null,
          user: { id: user.id, username: user.username }
        };
        sessions.set(data.tokenHash, row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        if (where.tokenHash) return sessions.get(where.tokenHash) ?? null;
        if (where.id) {
          for (const session of sessions.values()) if (session.id === where.id) return session;
        }
        return null;
      },
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
    mfaChallenge: {
      create: async ({
        data
      }: {
        data: { tokenHash: string; userId: string; expiresAt: Date };
      }) => {
        seq += 1;
        const row = {
          id: `challenge-${seq}`,
          ...data,
          failedAttempts: 0,
          consumedAt: null as Date | null,
          user: { ...user }
        };
        challenges.set(data.tokenHash, row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = challenges.get(where.tokenHash);
        return row ? { ...row, user: { ...user } } : null;
      },
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: { failedAttempts?: { increment: number }; consumedAt?: Date };
      }) => {
        for (const challenge of challenges.values()) {
          if (challenge.id === where.id) {
            if (data.failedAttempts?.increment) {
              challenge.failedAttempts += data.failedAttempts.increment;
            }
            if (data.consumedAt) challenge.consumedAt = data.consumedAt;
            return { ...challenge };
          }
        }
        return null;
      },
      deleteMany: async () => {
        challenges.clear();
        return { count: 0 };
      }
    },
    mfaEnrollment: {
      upsert: async ({
        create
      }: {
        where: { userId: string };
        create: {
          userId: string;
          secretCiphertext: Uint8Array;
          secretIv: Uint8Array;
          secretAuthTag: Uint8Array;
          secretKeyVersion: number;
          expiresAt: Date;
        };
        update: typeof create;
      }) => {
        enrollment = { id: 'enrollment-1', ...create };
        return enrollment;
      },
      findUnique: async ({ where }: { where: { userId: string } }) =>
        enrollment && enrollment.userId === where.userId ? enrollment : null,
      delete: async () => {
        enrollment = null;
        return { id: 'enrollment-1' };
      },
      deleteMany: async () => {
        enrollment = null;
        return { count: 0 };
      }
    },
    mfaRecoveryCode: {
      count: async ({ where }: { where: { userId: string; usedAt?: null } }) => {
        let count = 0;
        for (const row of recovery.values()) {
          if (row.userId !== where.userId) continue;
          if (where.usedAt === null && row.usedAt !== null) continue;
          count += 1;
        }
        return count;
      },
      createMany: async ({
        data
      }: {
        data: Array<{ userId: string; codeHash: string }>;
      }) => {
        for (const row of data) {
          seq += 1;
          recovery.set(row.codeHash, {
            id: `recovery-${seq}`,
            userId: row.userId,
            codeHash: row.codeHash,
            usedAt: null
          });
        }
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        let count = 0;
        for (const [hash, row] of recovery) {
          if (row.userId === where.userId) {
            recovery.delete(hash);
            count += 1;
          }
        }
        return { count };
      },
      updateMany: async ({
        where,
        data
      }: {
        where: { userId: string; codeHash: string; usedAt: null };
        data: { usedAt: Date };
      }) => {
        const row = recovery.get(where.codeHash);
        if (!row || row.userId !== where.userId || row.usedAt !== null) return { count: 0 };
        row.usedAt = data.usedAt;
        return { count: 1 };
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
    __challenges: challenges,
    __recovery: recovery,
    __user: user,
    __enrollment: () => enrollment
  };

  return database as unknown as PrismaClient & {
    __audits: AuditRow[];
    __sessions: Map<string, unknown>;
    __challenges: Map<string, unknown>;
    __recovery: Map<string, { usedAt: Date | null }>;
    __user: typeof user;
    __enrollment: () => typeof enrollment;
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

describe('MFA TOTP and recovery codes', () => {
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

  it('keeps normal login when MFA is disabled and still requires Turnstile', async () => {
    const database = createMfaDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password),
      mfaEnabled: false
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { username: 'administrator', password }
    });
    expect(missing.statusCode).toBe(400);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: {
        username: 'administrator',
        password,
        turnstileToken: 'token'
      }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.username).toBe('administrator');
    expect(login.json().mfaRequired).toBeUndefined();
    expect(cookieValue(login.headers['set-cookie'], testConfig.COOKIE_NAME)).toContain(
      testConfig.COOKIE_NAME
    );
    await app.close();
  });

  it('requires password before enrollment and does not enable MFA until TOTP confirmation', async () => {
    const database = createMfaDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password)
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: { username: 'administrator', password, turnstileToken: 'token' }
    });
    const sessionCookie = cookieValue(login.headers['set-cookie'], testConfig.COOKIE_NAME);

    const badPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/enroll/start',
      headers: { origin, cookie: sessionCookie },
      payload: { password: 'wrong password!!' }
    });
    expect(badPassword.statusCode).toBe(401);

    const start = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/enroll/start',
      headers: { origin, cookie: sessionCookie },
      payload: { password }
    });
    expect(start.statusCode).toBe(200);
    const startBody = start.json<{
      setupKey: string;
      qrDataUrl: string;
      otpauthUrl: string;
    }>();
    expect(startBody.setupKey).toMatch(/^[A-Z2-7]+$/);
    expect(startBody.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(database.__user.mfaEnabled).toBe(false);
    expect(database.__audits.some((row) => row.type === 'MFA_ENROLLMENT_STARTED')).toBe(true);

    const badCode = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/enroll/confirm',
      headers: { origin, cookie: sessionCookie },
      payload: { code: '000000' }
    });
    expect(badCode.statusCode).toBe(401);
    expect(database.__user.mfaEnabled).toBe(false);

    const setupKey = startBody.setupKey;
    const code = buildTotp(setupKey, 'administrator').generate();
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/enroll/confirm',
      headers: { origin, cookie: sessionCookie },
      payload: { code }
    });
    expect(confirm.statusCode).toBe(200);
    const confirmBody = confirm.json<{ enabled: boolean; recoveryCodes: string[] }>();
    expect(confirmBody.enabled).toBe(true);
    expect(confirmBody.recoveryCodes).toHaveLength(10);
    expect(database.__user.mfaEnabled).toBe(true);
    expect(database.__audits.some((row) => row.type === 'MFA_ENABLED')).toBe(true);
    expect(JSON.stringify(database.__audits)).not.toContain(setupKey);
    expect(JSON.stringify(database.__audits)).not.toContain(confirmBody.recoveryCodes[0]);

    await app.close();
  });

  it('does not create a full session until MFA succeeds, and enforces challenge limits', async () => {
    const secret = encryptTotpSecret(
      // fixed test secret
      'JBSWY3DPEHPK3PXP',
      testConfig.ENCRYPTION_KEY
    );
    void secret;
    const secretBase32 = 'JBSWY3DPEHPK3PXP';
    const recoveryCodes = generateRecoveryCodes(10);
    const database = createMfaDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password),
      mfaEnabled: true,
      secretBase32,
      recoveryCodes
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: { username: 'administrator', password, turnstileToken: 'token' }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ mfaRequired: true });
    expect(cookieValue(login.headers['set-cookie'], testConfig.COOKIE_NAME)).toBe('');
    const challengeCookie = cookieValue(login.headers['set-cookie'], MFA_CHALLENGE_COOKIE);
    expect(challengeCookie).toContain(MFA_CHALLENGE_COOKIE);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: challengeCookie }
    });
    expect(me.statusCode).toBe(401);

    for (let index = 0; index < MFA_MAX_CHALLENGE_ATTEMPTS - 1; index += 1) {
      const failed = await app.inject({
        method: 'POST',
        url: '/api/auth/mfa/verify',
        headers: { origin, cookie: challengeCookie },
        payload: { code: '000000' }
      });
      expect(failed.statusCode).toBe(401);
      expect(failed.json().error.code).toBe('MFA_INVALID');
    }

    const locked = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { origin, cookie: challengeCookie },
      payload: { code: '000000' }
    });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error.code).toBe('MFA_CHALLENGE_EXPIRED');

    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { origin, cookie: challengeCookie },
      payload: { code: buildTotp(secretBase32, 'administrator').generate() }
    });
    expect(reused.statusCode).toBe(401);

    await app.close();
  });

  it('accepts TOTP login, recovery codes once, regeneration, and disable with password+TOTP', async () => {
    const secretBase32 = 'JBSWY3DPEHPK3PXP';
    const recoveryCodes = generateRecoveryCodes(10);
    const database = createMfaDatabase({
      id: 'user-1',
      username: 'administrator',
      passwordHash: await argon2.hash(password),
      mfaEnabled: true,
      secretBase32,
      recoveryCodes
    });
    const app = await buildApp(database, testConfig, { startScheduler: false });

    const firstLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: { username: 'administrator', password, turnstileToken: 'token' }
    });
    const challengeCookie = cookieValue(firstLogin.headers['set-cookie'], MFA_CHALLENGE_COOKIE);
    const totp = buildTotp(secretBase32, 'administrator').generate();
    const verified = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { origin, cookie: challengeCookie, 'x-forwarded-proto': 'https' },
      payload: { code: totp }
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.username).toBe('administrator');
    const sessionCookie = cookieValue(verified.headers['set-cookie'], testConfig.COOKIE_NAME);
    expect(sessionCookie).toContain(testConfig.COOKIE_NAME);
    expect(database.__audits.some((row) => row.type === 'MFA_LOGIN_SUCCESS')).toBe(true);

    // Same TOTP step cannot be reused immediately (replay protection).
    expect(verifyTotpCode(secretBase32, 'administrator', totp, database.__user.mfaLastUsedStep)).toBeNull();

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin, cookie: sessionCookie } });

    const secondLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: { username: 'administrator', password, turnstileToken: 'token-2' }
    });
    const challenge2 = cookieValue(secondLogin.headers['set-cookie'], MFA_CHALLENGE_COOKIE);
    const recovery = recoveryCodes[0]!;
    const recovered = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { origin, cookie: challenge2, 'x-forwarded-proto': 'https' },
      payload: { recoveryCode: recovery }
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().recoveryCodeUsed).toBe(true);
    expect(database.__recovery.get(hashRecoveryCode(recovery, testConfig))?.usedAt).toBeTruthy();

    const thirdLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: { username: 'administrator', password, turnstileToken: 'token-3' }
    });
    const challenge3 = cookieValue(thirdLogin.headers['set-cookie'], MFA_CHALLENGE_COOKIE);
    const reuseRecovery = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { origin, cookie: challenge3 },
      payload: { recoveryCode: recovery }
    });
    expect(reuseRecovery.statusCode).toBe(401);

    // Fresh challenge + valid TOTP for authenticated regen/disable
    const fourthLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin, 'x-forwarded-proto': 'https' },
      payload: { username: 'administrator', password, turnstileToken: 'token-4' }
    });
    const challenge4 = cookieValue(fourthLogin.headers['set-cookie'], MFA_CHALLENGE_COOKIE);
    // Advance past replay by using current generate (may need slight wait if same step)
    database.__user.mfaLastUsedStep = null;
    const authed = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/verify',
      headers: { origin, cookie: challenge4, 'x-forwarded-proto': 'https' },
      payload: { code: buildTotp(secretBase32, 'administrator').generate() }
    });
    const authCookie = cookieValue(authed.headers['set-cookie'], testConfig.COOKIE_NAME);

    database.__user.mfaLastUsedStep = null;
    const regen = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/recovery/regenerate',
      headers: { origin, cookie: authCookie },
      payload: {
        password,
        code: buildTotp(secretBase32, 'administrator').generate()
      }
    });
    expect(regen.statusCode).toBe(200);
    expect(regen.json().recoveryCodes).toHaveLength(10);
    expect(regen.json().recoveryCodes).not.toContain(recovery);
    expect(database.__audits.some((row) => row.type === 'MFA_RECOVERY_CODES_REGENERATED')).toBe(
      true
    );

    database.__user.mfaLastUsedStep = null;
    const disable = await app.inject({
      method: 'POST',
      url: '/api/auth/mfa/disable',
      headers: { origin, cookie: authCookie },
      payload: {
        password,
        code: buildTotp(secretBase32, 'administrator').generate()
      }
    });
    expect(disable.statusCode).toBe(204);
    expect(database.__user.mfaEnabled).toBe(false);
    expect(database.__user.mfaSecretCiphertext).toBeNull();
    expect(database.__recovery.size).toBe(0);
    expect(database.__audits.some((row) => row.type === 'MFA_DISABLED')).toBe(true);

    const serialized = JSON.stringify(database.__audits);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(secretBase32);
    expect(serialized).not.toContain(recovery);

    await app.close();
  });
});
