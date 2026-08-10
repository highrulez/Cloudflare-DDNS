import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import { loginSchema } from '@ddns/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { turnstileEnabled, type Config } from '../config.js';
import { sessionHash } from '../security/crypto.js';
import { writeAuthAudit } from '../security/auth-audit.js';
import {
  clearSessionCookie,
  LoginLimiter,
  requireAuth,
  rotateSession,
  setSessionCookie
} from '../security/sessions.js';
import { TurnstileError, verifyTurnstileToken } from '../security/turnstile.js';
import { createMfaLoginChallenge } from './mfa.js';

// Precomputed Argon2id hash used only to equalize timing when the username is unknown.
const UNKNOWN_USER_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$T21USR6xJDXsoRWzvse2Cg$PVfal9hVIFBm4Of+WHzu6xys/m1eFwqp5LEvxnZBdZg';

export function registerAuthRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  const limiter = new LoginLimiter();

  app.get('/api/auth/turnstile', async (_request, reply) => {
    if (!turnstileEnabled(config)) {
      return reply.code(503).send({
        error: {
          code: 'TURNSTILE_UNAVAILABLE',
          message: 'Security verification is not configured'
        }
      });
    }
    return {
      siteKey: config.TURNSTILE_SITE_KEY,
      expectedHostname: config.TURNSTILE_EXPECTED_HOSTNAME,
      expectedAction: config.TURNSTILE_EXPECTED_ACTION,
      // Public canonical origin for Secure Access Required UI on unsupported hosts.
      appOrigin: config.APP_ORIGIN ?? null
    };
  });

  /** Minimal public bootstrap for LAN diagnostics UI (no secrets). */
  app.get('/api/auth/bootstrap', () => ({
    appOrigin: config.APP_ORIGIN ?? null,
    turnstileExpectedHostname: config.TURNSTILE_EXPECTED_HOSTNAME,
    secureLoginRequiredHint: true
  }));

  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const ipKey = request.ip;
    const blocked = limiter.status(ipKey);
    if (blocked.blocked) {
      await writeAuthAudit(db, request.log, {
        type: 'LOGIN_RATE_LIMITED',
        success: false,
        request
      });
      return reply
        .code(429)
        .header('retry-after', String(blocked.retryAfterSeconds))
        .send({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many login attempts. Please try again later.'
          }
        });
    }

    try {
      await verifyTurnstileToken(config, input.turnstileToken, request.ip);
    } catch (error) {
      const after = limiter.recordFailure(ipKey);
      await writeAuthAudit(db, request.log, {
        type: 'TURNSTILE_FAILED',
        success: false,
        request
      });
      if (after.blocked) {
        await writeAuthAudit(db, request.log, {
          type: 'LOGIN_RATE_LIMITED',
          success: false,
          request
        });
        return reply
          .code(429)
          .header('retry-after', String(after.retryAfterSeconds))
          .send({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many login attempts. Please try again later.'
            }
          });
      }
      const message =
        error instanceof TurnstileError
          ? error.message
          : 'Security verification failed. Please try again.';
      return reply.code(401).send({ error: { code: 'TURNSTILE_FAILED', message } });
    }

    const user = await db.user.findUnique({ where: { username: input.username } });
    const valid = await Promise.race([
      argon2.verify(user?.passwordHash ?? UNKNOWN_USER_HASH, input.password).catch(() => false),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000))
    ]);

    if (!user || !valid) {
      const after = limiter.recordFailure(ipKey);
      await writeAuthAudit(db, request.log, {
        type: 'LOGIN_FAILED',
        success: false,
        request
      });
      if (after.blocked) {
        await writeAuthAudit(db, request.log, {
          type: 'LOGIN_RATE_LIMITED',
          success: false,
          request
        });
        return reply
          .code(429)
          .header('retry-after', String(after.retryAfterSeconds))
          .send({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many login attempts. Please try again later.'
            }
          });
      }
      return reply.code(401).send({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }
      });
    }

    limiter.clear(ipKey);

    if (user.mfaEnabled) {
      const challenge = await createMfaLoginChallenge(db, config, reply, request, user.id);
      return challenge;
    }

    const session = await rotateSession(db, config, request, user.id);
    setSessionCookie(reply, config, session.token, session.expiresAt, request);
    await writeAuthAudit(db, request.log, {
      type: 'LOGIN_SUCCESS',
      success: true,
      request,
      username: user.username
    });
    return { user: { id: user.id, username: user.username } };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME];
    if (token)
      await db.session.deleteMany({
        where: { tokenHash: sessionHash(token, config.SESSION_SECRET) }
      });
    clearSessionCookie(reply, config, request);
    await writeAuthAudit(db, request.log, {
      type: 'LOGOUT',
      success: true,
      request,
      username: request.authUser?.username
    });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, (request) => ({ user: request.authUser }));

  app.patch('/api/auth/profile', { preHandler: requireAuth }, async (request) => {
    const input = z.object({ username: z.string().trim().min(1).max(191) }).parse(request.body);
    const user = await db.user.update({
      where: { id: request.authUser!.id },
      data: { username: input.username },
      select: { id: true, username: true }
    });
    return { user };
  });

  app.put('/api/auth/password', { preHandler: requireAuth }, async (request, reply) => {
    const input = z
      .object({
        currentPassword: z.string().min(1).max(256),
        newPassword: z.string().min(12).max(256)
      })
      .parse(request.body);
    const user = await db.user.findUnique({ where: { id: request.authUser!.id } });
    if (!user || !(await argon2.verify(user.passwordHash, input.currentPassword))) {
      return reply.code(400).send({
        error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' }
      });
    }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(input.newPassword, { type: argon2.argon2id }) }
    });
    await db.session.deleteMany({ where: { userId: user.id } });
    clearSessionCookie(reply, config, request);
    return reply.code(204).send();
  });
}
