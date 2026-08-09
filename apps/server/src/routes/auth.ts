import argon2 from "argon2";
import type { PrismaClient } from "@ddns/database";
import { loginSchema } from "@ddns/shared";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { sessionHash } from "../security/crypto.js";
import {
  clearSessionCookie,
  createSession,
  LoginLimiter,
  requireAuth,
  setSessionCookie,
} from "../security/sessions.js";

export function registerAuthRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  const limiter = new LoginLimiter();

  app.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const key = `${request.ip}:${input.username.toLowerCase()}`;
    if (!limiter.consume(key)) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." } });
    }
    const user = await db.user.findUnique({ where: { username: input.username } });
    const valid = user
      ? await Promise.race([
          argon2.verify(user.passwordHash, input.password),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
        ])
      : false;
    if (!user || !valid) {
      return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password" } });
    }
    limiter.clear(key);
    const session = await createSession(db, config, user.id);
    setSessionCookie(reply, session.token, session.expiresAt, config.NODE_ENV === "production");
    return { user: { id: user.id, username: user.username } };
  });

  app.post("/api/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies.ddns_session;
    if (token) await db.session.deleteMany({ where: { tokenHash: sessionHash(token, config.SESSION_SECRET) } });
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => ({ user: request.authUser }));
}
