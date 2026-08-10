import argon2 from "argon2";
import type { PrismaClient } from "@ddns/database";
import { loginSchema } from "@ddns/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
    setSessionCookie(reply, config, session.token, session.expiresAt, request);
    return { user: { id: user.id, username: user.username } };
  });

  app.post("/api/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME];
    if (token) await db.session.deleteMany({ where: { tokenHash: sessionHash(token, config.SESSION_SECRET) } });
    clearSessionCookie(reply, config, request);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, (request) => ({ user: request.authUser }));

  app.patch("/api/auth/profile", { preHandler: requireAuth }, async (request) => {
    const input = z.object({ username: z.string().trim().min(1).max(191) }).parse(request.body);
    const user = await db.user.update({
      where: { id: request.authUser!.id },
      data: { username: input.username },
      select: { id: true, username: true },
    });
    return { user };
  });

  app.put("/api/auth/password", { preHandler: requireAuth }, async (request, reply) => {
    const input = z.object({
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(12).max(256),
    }).parse(request.body);
    const user = await db.user.findUnique({ where: { id: request.authUser!.id } });
    if (!user || !(await argon2.verify(user.passwordHash, input.currentPassword))) {
      return reply.code(400).send({
        error: { code: "INVALID_PASSWORD", message: "Current password is incorrect" },
      });
    }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(input.newPassword, { type: argon2.argon2id }) },
    });
    await db.session.deleteMany({ where: { userId: user.id } });
    clearSessionCookie(reply, config, request);
    return reply.code(204).send();
  });
}
