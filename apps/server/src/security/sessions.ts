import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@ddns/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { sessionHash } from "./crypto.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser: { id: string; username: string } | null;
  }
}

const COOKIE = "ddns_session";

export async function createSession(db: PrismaClient, config: Config, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000);
  await db.session.create({ data: { tokenHash: sessionHash(token, config.SESSION_SECRET), userId, expiresAt } });
  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean) {
  reply.setCookie(COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: "/" });
}

export function registerSecurity(app: FastifyInstance, db: PrismaClient, config: Config) {
  app.decorateRequest("authUser", null);
  app.addHook("onRequest", async (request, reply) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      const expected = config.PUBLIC_ORIGIN ?? `${request.protocol}://${request.headers.host}`;
      if (origin && origin !== expected) {
        return reply.code(403).send({ error: { code: "BAD_ORIGIN", message: "Request origin is not allowed" } });
      }
    }

    const token = request.cookies[COOKIE];
    if (!token) return;
    const now = new Date();
    const session = await db.session.findUnique({
      where: { tokenHash: sessionHash(token, config.SESSION_SECRET) },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!session || session.expiresAt <= now) {
      if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
      clearSessionCookie(reply);
      return;
    }
    request.authUser = session.user;
    if (session.expiresAt.getTime() - now.getTime() < config.SESSION_TTL_HOURS * 1_800_000) {
      const expiresAt = new Date(now.getTime() + config.SESSION_TTL_HOURS * 3_600_000);
      await db.session.update({ where: { id: session.id }, data: { expiresAt, lastSeenAt: now } });
      setSessionCookie(reply, token, expiresAt, config.NODE_ENV === "production");
    }
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.authUser) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
  }
}

export class LoginLimiter {
  private readonly attempts = new Map<string, { count: number; resetsAt: number }>();
  constructor(private readonly limit = 5, private readonly windowMs = 15 * 60_000) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.attempts.get(key);
    if (!current || current.resetsAt <= now) {
      this.attempts.set(key, { count: 1, resetsAt: now + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}
