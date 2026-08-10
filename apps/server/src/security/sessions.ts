import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@ddns/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveAllowedOrigins, type Config } from '../config.js';
import { writeAuthAudit } from './auth-audit.js';
import { sessionHash } from './crypto.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: { id: string; username: string } | null;
    authSessionId: string | null;
  }
}

export async function createSession(db: PrismaClient, config: Config, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_SECONDS * 1_000);
  await db.session.create({
    data: { tokenHash: sessionHash(token, config.SESSION_SECRET), userId, expiresAt }
  });
  return { token, expiresAt };
}

/** Invalidate any pre-auth cookie session, then issue a fresh post-login session. */
export async function rotateSession(
  db: PrismaClient,
  config: Config,
  request: FastifyRequest,
  userId: string
) {
  const existing = request.cookies[config.COOKIE_NAME];
  if (existing) {
    await db.session
      .deleteMany({ where: { tokenHash: sessionHash(existing, config.SESSION_SECRET) } })
      .catch(() => undefined);
  }
  return createSession(db, config, userId);
}

/**
 * Production keeps COOKIE_SECURE=true.
 * Secure cookies are only emitted on HTTPS requests (canonical reverse-proxy origin).
 * Direct HTTP LAN access receives a non-Secure cookie for that HTTP origin only.
 * This does not disable Secure cookies for production HTTPS.
 */
export function sessionCookieSecure(request: FastifyRequest, config: Config): boolean {
  if (!config.COOKIE_SECURE) return false;
  return request.protocol === 'https';
}

export function setSessionCookie(
  reply: FastifyReply,
  config: Config,
  token: string,
  expiresAt: Date,
  request: FastifyRequest
) {
  reply.setCookie(config.COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(request, config),
    expires: expiresAt
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  config: Config,
  request: FastifyRequest
) {
  reply.clearCookie(config.COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(request, config)
  });
}

export function setMfaChallengeCookie(
  reply: FastifyReply,
  config: Config,
  token: string,
  expiresAt: Date,
  request: FastifyRequest,
  cookieName: string
) {
  reply.setCookie(cookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(request, config),
    expires: expiresAt
  });
}

export function clearMfaChallengeCookie(
  reply: FastifyReply,
  config: Config,
  request: FastifyRequest,
  cookieName: string
) {
  reply.clearCookie(cookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: sessionCookieSecure(request, config)
  });
}

export async function markStrongReauth(
  db: PrismaClient,
  sessionId: string,
  ttlMs: number
) {
  const until = new Date(Date.now() + ttlMs);
  await db.session.update({
    where: { id: sessionId },
    data: { stronglyAuthenticatedUntil: until }
  });
  return until;
}

export async function hasRecentStrongReauth(
  db: PrismaClient,
  sessionId: string | null | undefined
): Promise<boolean> {
  if (!sessionId) return false;
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { stronglyAuthenticatedUntil: true }
  });
  return Boolean(
    session?.stronglyAuthenticatedUntil && session.stronglyAuthenticatedUntil > new Date()
  );
}

export function registerSecurity(app: FastifyInstance, db: PrismaClient, config: Config) {
  app.decorateRequest('authUser', null);
  app.decorateRequest('authSessionId', null);
  app.addHook('onRequest', async (request, reply) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin) {
        const allowed = resolveAllowedOrigins(config);
        const permitted =
          allowed.size > 0
            ? allowed.has(origin)
            : origin === `${request.protocol}://${request.headers.host}`;
        if (!permitted) {
          return reply
            .code(403)
            .send({ error: { code: 'BAD_ORIGIN', message: 'Request origin is not allowed' } });
        }
      }
    }

    const token = request.cookies[config.COOKIE_NAME];
    if (!token) return;
    const now = new Date();
    const session = await db.session.findUnique({
      where: { tokenHash: sessionHash(token, config.SESSION_SECRET) },
      include: { user: { select: { id: true, username: true } } }
    });
    if (!session || session.expiresAt <= now) {
      if (session) {
        await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
        await writeAuthAudit(db, request.log, {
          type: 'SESSION_EXPIRED',
          success: false,
          request
        });
      }
      clearSessionCookie(reply, config, request);
      return;
    }
    request.authUser = session.user;
    request.authSessionId = session.id;
    if (session.expiresAt.getTime() - now.getTime() < config.SESSION_TTL_SECONDS * 500) {
      const expiresAt = new Date(now.getTime() + config.SESSION_TTL_SECONDS * 1_000);
      await db.session.update({ where: { id: session.id }, data: { expiresAt, lastSeenAt: now } });
      setSessionCookie(reply, config, token, expiresAt, request);
    }
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authUser) {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }
}

/**
 * Gate sensitive mutations behind a recent password (+ TOTP when MFA is enabled) step-up.
 * Frontend should treat 403 STRONG_AUTH_REQUIRED as a signal to open the re-auth modal.
 */
export function requireRecentStrongAuth(db: PrismaClient) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.authUser) {
      await reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      return;
    }
    if (!(await hasRecentStrongReauth(db, request.authSessionId))) {
      await reply.code(403).send({
        error: {
          code: 'STRONG_AUTH_REQUIRED',
          message: 'This action requires recent security verification.'
        }
      });
      return;
    }
  };
}

/** Assert strong auth inside a handler (e.g. only when a token is present in PATCH). */
export async function assertRecentStrongAuth(
  db: PrismaClient,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (!request.authUser) {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return false;
  }
  if (!(await hasRecentStrongReauth(db, request.authSessionId))) {
    await reply.code(403).send({
      error: {
        code: 'STRONG_AUTH_REQUIRED',
        message: 'This action requires recent security verification.'
      }
    });
    return false;
  }
  return true;
}

/** Login-specific failed-attempt limiter: 5 failures / 10 minutes per source IP. */
export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; resetsAt: number }>();
  constructor(
    private readonly limit = 5,
    private readonly windowMs = 10 * 60_000
  ) {}

  status(key: string, now = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
    const current = this.attempts.get(key);
    if (!current || current.resetsAt <= now) {
      if (current) this.attempts.delete(key);
      return { blocked: false, retryAfterSeconds: 0 };
    }
    if (current.count >= this.limit) {
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1000))
      };
    }
    return { blocked: false, retryAfterSeconds: 0 };
  }

  recordFailure(key: string, now = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
    const current = this.attempts.get(key);
    if (!current || current.resetsAt <= now) {
      this.attempts.set(key, { count: 1, resetsAt: now + this.windowMs });
      return { blocked: false, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (current.count >= this.limit) {
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1000))
      };
    }
    return { blocked: false, retryAfterSeconds: 0 };
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}

/** Reauth brute-force limiter: 5 failures / 10 minutes per authenticated session. */
export class ReauthLimiter extends LoginLimiter {
  constructor() {
    super(5, 10 * 60_000);
  }
}
