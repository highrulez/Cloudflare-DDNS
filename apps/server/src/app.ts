import type { PrismaClient } from "@ddns/database";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { DdnsEngine } from "./ddns/engine.js";
import { Scheduler } from "./ddns/scheduler.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCloudflareRoutes } from "./routes/cloudflare.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerRecordRoutes } from "./routes/records.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerSecurity } from "./security/sessions.js";

export async function buildApp(db: PrismaClient, config: Config, options: { startScheduler?: boolean } = {}) {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    trustProxy: true,
    bodyLimit: 64 * 1024,
    requestTimeout: 30_000,
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  registerSecurity(app, db, config);

  const engine = new DdnsEngine(db, config);
  const scheduler = new Scheduler(db, engine);
  registerSetupRoutes(app, db, config);
  registerAuthRoutes(app, db, config);
  registerCloudflareRoutes(app, db, config);
  registerRecordRoutes(app, db, config, engine, scheduler);
  registerOperationRoutes(app, db, engine, scheduler);

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.url}` } }),
  );
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues },
      });
    }
    const caught = error instanceof Error ? error : new Error("Unknown server error");
    const statusCode = "status" in caught && typeof caught.status === "number" ? caught.status : 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({
      error: { code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: statusCode >= 500 ? "Internal server error" : caught.message },
    });
  });
  app.addHook("onClose", async () => {
    scheduler.stop();
    await db.$disconnect();
  });
  if (options.startScheduler !== false) await scheduler.start();
  return app;
}
