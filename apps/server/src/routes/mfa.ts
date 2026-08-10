import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { writeAuthAudit } from '../security/auth-audit.js';
import {
  buildEnrollmentPayload,
  createChallengeToken,
  decryptTotpSecret,
  generateRecoveryCodes,
  hashChallengeToken,
  hashRecoveryCode,
  MFA_CHALLENGE_COOKIE,
  MFA_CHALLENGE_TTL_MS,
  MFA_ENROLLMENT_TTL_MS,
  MFA_MAX_CHALLENGE_ATTEMPTS,
  MFA_STRONG_REAUTH_TTL_MS,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  verifyTotpCode
} from '../security/mfa.js';
import {
  clearMfaChallengeCookie,
  clearSessionCookie,
  hasRecentStrongReauth,
  markStrongReauth,
  ReauthLimiter,
  requireAuth,
  rotateSession,
  setMfaChallengeCookie,
  setSessionCookie
} from '../security/sessions.js';

const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit authenticator code');
const recoveryCodeSchema = z.string().trim().min(8).max(64);
const passwordSchema = z.string().min(1).max(256);

async function verifyPassword(db: PrismaClient, userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return argon2.verify(user.passwordHash, password).catch(() => false);
}

async function loadEnabledMfaSecret(
  db: PrismaClient,
  config: Config,
  userId: string
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (
    !user?.mfaEnabled ||
    !user.mfaSecretCiphertext ||
    !user.mfaSecretIv ||
    !user.mfaSecretAuthTag
  ) {
    return null;
  }
  const secret = decryptTotpSecret(
    {
      ciphertext: Buffer.from(user.mfaSecretCiphertext),
      iv: Buffer.from(user.mfaSecretIv),
      authTag: Buffer.from(user.mfaSecretAuthTag),
      keyVersion: user.mfaSecretKeyVersion ?? 1
    },
    config.ENCRYPTION_KEY
  );
  return { user, secret };
}

async function replaceRecoveryCodes(db: PrismaClient, config: Config, userId: string) {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await db.$transaction(async (tx) => {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({
        userId,
        codeHash: hashRecoveryCode(code, config)
      }))
    });
  });
  return codes;
}

async function consumeRecoveryCode(
  db: PrismaClient,
  config: Config,
  userId: string,
  code: string
) {
  const codeHash = hashRecoveryCode(code, config);
  const result = await db.mfaRecoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() }
  });
  return result.count === 1;
}

export async function createMfaLoginChallenge(
  db: PrismaClient,
  config: Config,
  reply: FastifyReply,
  request: FastifyRequest,
  userId: string
) {
  await db.mfaChallenge.deleteMany({
    where: { userId, OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }] }
  });
  const token = createChallengeToken();
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
  await db.mfaChallenge.create({
    data: {
      tokenHash: hashChallengeToken(token, config),
      userId,
      expiresAt
    }
  });
  setMfaChallengeCookie(reply, config, token, expiresAt, request, MFA_CHALLENGE_COOKIE);
  return { mfaRequired: true as const };
}

export function registerMfaRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  const reauthLimiter = new ReauthLimiter();

  app.post('/api/auth/mfa/verify', async (request, reply) => {
    const input = z
      .object({
        code: totpCodeSchema.optional(),
        recoveryCode: recoveryCodeSchema.optional()
      })
      .refine((value) => Boolean(value.code) !== Boolean(value.recoveryCode), {
        message: 'Provide either an authenticator code or a recovery code'
      })
      .parse(request.body);

    const challengeToken = request.cookies[MFA_CHALLENGE_COOKIE];
    if (!challengeToken) {
      return reply.code(401).send({
        error: {
          code: 'MFA_CHALLENGE_REQUIRED',
          message: 'Sign in again to continue security verification.'
        }
      });
    }

    const challenge = await db.mfaChallenge.findUnique({
      where: { tokenHash: hashChallengeToken(challengeToken, config) },
      include: { user: true }
    });
    const now = new Date();
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.failedAttempts >= MFA_MAX_CHALLENGE_ATTEMPTS
    ) {
      clearMfaChallengeCookie(reply, config, request, MFA_CHALLENGE_COOKIE);
      if (challenge) {
        await db.mfaChallenge
          .update({ where: { id: challenge.id }, data: { consumedAt: now } })
          .catch(() => undefined);
      }
      return reply.code(401).send({
        error: {
          code: 'MFA_CHALLENGE_EXPIRED',
          message: 'Security verification expired. Please sign in again.'
        }
      });
    }

    const fail = async () => {
      const updated = await db.mfaChallenge.update({
        where: { id: challenge.id },
        data: { failedAttempts: { increment: 1 } }
      });
      await writeAuthAudit(db, request.log, {
        type: 'MFA_CHALLENGE_FAILED',
        success: false,
        request
      });
      if (updated.failedAttempts >= MFA_MAX_CHALLENGE_ATTEMPTS) {
        await db.mfaChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() }
        });
        clearMfaChallengeCookie(reply, config, request, MFA_CHALLENGE_COOKIE);
        return reply.code(401).send({
          error: {
            code: 'MFA_CHALLENGE_EXPIRED',
            message: 'Too many failed attempts. Please sign in again.'
          }
        });
      }
      return reply.code(401).send({
        error: {
          code: 'MFA_INVALID',
          message: 'Invalid authentication code.'
        }
      });
    };

    if (input.recoveryCode) {
      if (normalizeRecoveryCode(input.recoveryCode).length < 12) return fail();
      const used = await consumeRecoveryCode(
        db,
        config,
        challenge.userId,
        input.recoveryCode
      );
      if (!used) return fail();

      await db.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() }
      });
      clearMfaChallengeCookie(reply, config, request, MFA_CHALLENGE_COOKIE);
      const session = await rotateSession(db, config, request, challenge.userId);
      setSessionCookie(reply, config, session.token, session.expiresAt, request);
      await writeAuthAudit(db, request.log, {
        type: 'MFA_RECOVERY_CODE_USED',
        success: true,
        request,
        username: challenge.user.username
      });
      await writeAuthAudit(db, request.log, {
        type: 'MFA_LOGIN_SUCCESS',
        success: true,
        request,
        username: challenge.user.username
      });
      return {
        user: { id: challenge.user.id, username: challenge.user.username },
        recoveryCodeUsed: true
      };
    }

    const mfa = await loadEnabledMfaSecret(db, config, challenge.userId);
    if (!mfa) return fail();
    const step = verifyTotpCode(
      mfa.secret,
      mfa.user.username,
      input.code!,
      mfa.user.mfaLastUsedStep
    );
    if (step === null) return fail();

    await db.$transaction([
      db.user.update({
        where: { id: challenge.userId },
        data: { mfaLastUsedStep: step }
      }),
      db.mfaChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() }
      })
    ]);
    clearMfaChallengeCookie(reply, config, request, MFA_CHALLENGE_COOKIE);
    const session = await rotateSession(db, config, request, challenge.userId);
    setSessionCookie(reply, config, session.token, session.expiresAt, request);
    await writeAuthAudit(db, request.log, {
      type: 'MFA_LOGIN_SUCCESS',
      success: true,
      request,
      username: challenge.user.username
    });
    return { user: { id: challenge.user.id, username: challenge.user.username } };
  });

  app.get('/api/auth/mfa/status', { preHandler: requireAuth }, async (request) => {
    const userId = request.authUser!.id;
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabled: true, mfaEnabledAt: true }
    });
    const remaining = user.mfaEnabled
      ? await db.mfaRecoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    const total = user.mfaEnabled
      ? await db.mfaRecoveryCode.count({ where: { userId } })
      : 0;
    return {
      enabled: user.mfaEnabled,
      enabledAt: user.mfaEnabledAt,
      recoveryCodesRemaining: remaining,
      recoveryCodesTotal: total
    };
  });

  app.post('/api/auth/mfa/enroll/start', { preHandler: requireAuth }, async (request, reply) => {
    const input = z.object({ password: passwordSchema }).parse(request.body);
    const userId = request.authUser!.id;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) {
      return reply.code(400).send({
        error: { code: 'MFA_ALREADY_ENABLED', message: 'Multi-factor authentication is already enabled.' }
      });
    }
    if (!(await verifyPassword(db, userId, input.password))) {
      return reply.code(401).send({
        error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' }
      });
    }

    const enrollment = await buildEnrollmentPayload(user.username, config.ENCRYPTION_KEY);
    const expiresAt = new Date(Date.now() + MFA_ENROLLMENT_TTL_MS);
    await db.mfaEnrollment.upsert({
      where: { userId },
      create: {
        userId,
        secretCiphertext: new Uint8Array(enrollment.encrypted.ciphertext),
        secretIv: new Uint8Array(enrollment.encrypted.iv),
        secretAuthTag: new Uint8Array(enrollment.encrypted.authTag),
        secretKeyVersion: enrollment.encrypted.keyVersion,
        expiresAt
      },
      update: {
        secretCiphertext: new Uint8Array(enrollment.encrypted.ciphertext),
        secretIv: new Uint8Array(enrollment.encrypted.iv),
        secretAuthTag: new Uint8Array(enrollment.encrypted.authTag),
        secretKeyVersion: enrollment.encrypted.keyVersion,
        expiresAt
      }
    });
    await writeAuthAudit(db, request.log, {
      type: 'MFA_ENROLLMENT_STARTED',
      success: true,
      request,
      username: user.username
    });
    return {
      otpauthUrl: enrollment.otpauthUrl,
      qrDataUrl: enrollment.qrDataUrl,
      setupKey: enrollment.secretBase32,
      expiresAt
    };
  });

  app.post('/api/auth/mfa/enroll/confirm', { preHandler: requireAuth }, async (request, reply) => {
    const input = z.object({ code: totpCodeSchema }).parse(request.body);
    const userId = request.authUser!.id;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) {
      return reply.code(400).send({
        error: { code: 'MFA_ALREADY_ENABLED', message: 'Multi-factor authentication is already enabled.' }
      });
    }
    const pending = await db.mfaEnrollment.findUnique({ where: { userId } });
    if (!pending || pending.expiresAt <= new Date()) {
      if (pending) await db.mfaEnrollment.delete({ where: { id: pending.id } }).catch(() => undefined);
      return reply.code(400).send({
        error: {
          code: 'MFA_ENROLLMENT_EXPIRED',
          message: 'Enrollment expired. Start multi-factor setup again.'
        }
      });
    }
    const secret = decryptTotpSecret(
      {
        ciphertext: Buffer.from(pending.secretCiphertext),
        iv: Buffer.from(pending.secretIv),
        authTag: Buffer.from(pending.secretAuthTag),
        keyVersion: pending.secretKeyVersion
      },
      config.ENCRYPTION_KEY
    );
    const step = verifyTotpCode(secret, user.username, input.code);
    if (step === null) {
      return reply.code(401).send({
        error: { code: 'MFA_INVALID', message: 'Invalid authentication code.' }
      });
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaEnabledAt: new Date(),
          mfaSecretCiphertext: pending.secretCiphertext,
          mfaSecretIv: pending.secretIv,
          mfaSecretAuthTag: pending.secretAuthTag,
          mfaSecretKeyVersion: pending.secretKeyVersion,
          mfaLastUsedStep: step
        }
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({
          userId,
          codeHash: hashRecoveryCode(code, config)
        }))
      });
      await tx.mfaEnrollment.delete({ where: { id: pending.id } });
    });
    await writeAuthAudit(db, request.log, {
      type: 'MFA_ENABLED',
      success: true,
      request,
      username: user.username
    });
    if (request.authSessionId) {
      await markStrongReauth(db, request.authSessionId, MFA_STRONG_REAUTH_TTL_MS);
    }
    return { enabled: true, recoveryCodes };
  });

  app.post(
    '/api/auth/mfa/recovery/regenerate',
    { preHandler: requireAuth },
    async (request, reply) => {
      const input = z
        .object({ password: passwordSchema, code: totpCodeSchema })
        .parse(request.body);
      const userId = request.authUser!.id;
      if (!(await verifyPassword(db, userId, input.password))) {
        return reply.code(401).send({
          error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' }
        });
      }
      const mfa = await loadEnabledMfaSecret(db, config, userId);
      if (!mfa) {
        return reply.code(400).send({
          error: { code: 'MFA_DISABLED', message: 'Multi-factor authentication is not enabled.' }
        });
      }
      const step = verifyTotpCode(
        mfa.secret,
        mfa.user.username,
        input.code,
        mfa.user.mfaLastUsedStep
      );
      if (step === null) {
        return reply.code(401).send({
          error: { code: 'MFA_INVALID', message: 'Invalid authentication code.' }
        });
      }
      await db.user.update({
        where: { id: userId },
        data: { mfaLastUsedStep: step }
      });
      const recoveryCodes = await replaceRecoveryCodes(db, config, userId);
      if (request.authSessionId) {
        await markStrongReauth(db, request.authSessionId, MFA_STRONG_REAUTH_TTL_MS);
      }
      await writeAuthAudit(db, request.log, {
        type: 'MFA_RECOVERY_CODES_REGENERATED',
        success: true,
        request,
        username: mfa.user.username
      });
      return { recoveryCodes };
    }
  );

  app.post('/api/auth/mfa/disable', { preHandler: requireAuth }, async (request, reply) => {
    const input = z
      .object({ password: passwordSchema, code: totpCodeSchema })
      .parse(request.body);
    const userId = request.authUser!.id;
    if (!(await verifyPassword(db, userId, input.password))) {
      return reply.code(401).send({
        error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect.' }
      });
    }
    const mfa = await loadEnabledMfaSecret(db, config, userId);
    if (!mfa) {
      return reply.code(400).send({
        error: { code: 'MFA_DISABLED', message: 'Multi-factor authentication is not enabled.' }
      });
    }
    const step = verifyTotpCode(
      mfa.secret,
      mfa.user.username,
      input.code,
      mfa.user.mfaLastUsedStep
    );
    if (step === null) {
      return reply.code(401).send({
        error: { code: 'MFA_INVALID', message: 'Invalid authentication code.' }
      });
    }

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaEnabledAt: null,
          mfaSecretCiphertext: null,
          mfaSecretIv: null,
          mfaSecretAuthTag: null,
          mfaSecretKeyVersion: null,
          mfaLastUsedStep: null
        }
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaChallenge.deleteMany({ where: { userId } });
      await tx.mfaEnrollment.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
    });
    clearSessionCookie(reply, config, request);
    clearMfaChallengeCookie(reply, config, request, MFA_CHALLENGE_COOKIE);
    await writeAuthAudit(db, request.log, {
      type: 'MFA_DISABLED',
      success: true,
      request,
      username: mfa.user.username
    });
    return reply.code(204).send();
  });

  /** Password (+ TOTP when MFA enabled) → short-lived strong reauth window for sensitive actions. */
  app.post('/api/auth/reauth', { preHandler: requireAuth }, async (request, reply) => {
    const input = z
      .object({
        password: passwordSchema,
        code: totpCodeSchema.optional()
      })
      .parse(request.body);
    const sessionKey = request.authSessionId ?? request.authUser!.id;
    const blocked = reauthLimiter.status(sessionKey);
    if (blocked.blocked) {
      await writeAuthAudit(db, request.log, {
        type: 'REAUTH_RATE_LIMITED',
        success: false,
        request,
        username: request.authUser?.username
      });
      return reply
        .code(429)
        .header('retry-after', String(blocked.retryAfterSeconds))
        .send({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many verification attempts. Please try again later.'
          }
        });
    }

    const fail = async (code: string, message: string, status = 401) => {
      const after = reauthLimiter.recordFailure(sessionKey);
      await writeAuthAudit(db, request.log, {
        type: after.blocked ? 'REAUTH_RATE_LIMITED' : 'REAUTH_FAILED',
        success: false,
        request,
        username: request.authUser?.username
      });
      if (after.blocked) {
        return reply
          .code(429)
          .header('retry-after', String(after.retryAfterSeconds))
          .send({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many verification attempts. Please try again later.'
            }
          });
      }
      return reply.code(status).send({ error: { code, message } });
    };

    const userId = request.authUser!.id;
    if (!(await verifyPassword(db, userId, input.password))) {
      return fail('INVALID_PASSWORD', 'Current password is incorrect.');
    }
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) {
      if (!input.code) {
        return fail('MFA_REQUIRED', 'Authenticator code is required.');
      }
      const mfa = await loadEnabledMfaSecret(db, config, userId);
      if (!mfa) {
        return fail('MFA_DISABLED', 'Multi-factor authentication is not enabled.', 400);
      }
      const step = verifyTotpCode(
        mfa.secret,
        mfa.user.username,
        input.code,
        mfa.user.mfaLastUsedStep
      );
      if (step === null) {
        return fail('MFA_INVALID', 'Invalid authentication code.');
      }
      await db.user.update({
        where: { id: userId },
        data: { mfaLastUsedStep: step }
      });
    }
    if (!request.authSessionId) {
      return reply.code(401).send({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }
      });
    }
    reauthLimiter.clear(sessionKey);
    const until = await markStrongReauth(
      db,
      request.authSessionId,
      MFA_STRONG_REAUTH_TTL_MS
    );
    await writeAuthAudit(db, request.log, {
      type: 'REAUTH_SUCCESS',
      success: true,
      request,
      username: user.username
    });
    return {
      stronglyAuthenticatedUntil: until,
      recentlyStronglyAuthenticated: await hasRecentStrongReauth(db, request.authSessionId)
    };
  });
}
