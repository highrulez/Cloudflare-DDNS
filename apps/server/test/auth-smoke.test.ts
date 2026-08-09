import argon2 from "argon2";
import type { PrismaClient } from "@ddns/database";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";

describe("authentication smoke flow", () => {
  it("logs in, restores the session, and reports healthy", async () => {
    const user = {
      id: "user-1",
      username: "administrator",
      passwordHash: await argon2.hash("correct horse battery staple"),
    };
    let storedSession:
      | { id: string; tokenHash: string; userId: string; expiresAt: Date; user: { id: string; username: string } }
      | undefined;
    const database = {
      user: {
        findUnique: async ({ where }: { where: { username: string } }) =>
          where.username === user.username ? user : null,
      },
      session: {
        create: async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => {
          storedSession = {
            id: "session-1",
            ...data,
            user: { id: user.id, username: user.username },
          };
          return storedSession;
        },
        findUnique: async ({ where }: { where: { tokenHash: string } }) =>
          storedSession?.tokenHash === where.tokenHash ? storedSession : null,
        update: async () => storedSession,
        delete: async () => undefined,
      },
      schedulerState: { findUnique: async () => null },
      ipDetectionRun: { findFirst: async () => null },
      $queryRaw: async () => [1],
      $disconnect: async () => undefined,
    } as unknown as PrismaClient;
    const config: Config = {
      NODE_ENV: "test",
      APP_HOST: "127.0.0.1",
      APP_PORT: 8090,
      APP_ORIGIN: "https://dns.highrulez.com",
      DATABASE_URL: "mysql://user:password@localhost:3306/ddns",
      SESSION_SECRET: "a-session-secret-that-is-longer-than-32-characters",
      ENCRYPTION_KEY: Buffer.alloc(32),
      COOKIE_NAME: "cloudflare_ddns_session",
      COOKIE_SECURE: true,
      SESSION_TTL_SECONDS: 3600,
      CLOUDFLARE_API_BASE: "https://api.cloudflare.com/client/v4",
      IPV4_PROVIDERS: ["https://api.ipify.org"],
      IPV6_PROVIDERS: ["https://api6.ipify.org"],
      HTTP_TIMEOUT_MS: 5000,
    };
    const app = await buildApp(database, config, { startScheduler: false });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: user.username, password: "correct horse battery staple" },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0];
    expect(cookie).toContain("cloudflare_ddns_session=");
    expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toContain("Secure");

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: cookie! } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: { id: user.id, username: user.username } });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    await app.close();
  });
});
