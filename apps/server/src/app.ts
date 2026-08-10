import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@ddns/database';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { DdnsEngine } from './ddns/engine.js';
import { Scheduler } from './ddns/scheduler.js';
import { RequestError } from './records/service.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCloudflareRoutes } from './routes/cloudflare.js';
import { registerOperationRoutes } from './routes/operations.js';
import { registerRecordRoutes } from './routes/records.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerSecurity } from './security/sessions.js';
import { createSystemLogger } from './system/logs.js';

export async function buildApp(
  db: PrismaClient,
  config: Config,
  options: { startScheduler?: boolean } = {}
) {
  const app = Fastify({
    ...(config.NODE_ENV === 'test'
      ? { logger: false }
      : { loggerInstance: createSystemLogger(process.env.LOG_LEVEL ?? 'info') }),
    // Synology Reverse Proxy forwards to 127.0.0.1:8090 in host-network mode.
    // Trust only loopback so direct LAN clients cannot spoof forwarded IP/protocol headers.
    trustProxy: ['127.0.0.1', '::1'],
    bodyLimit: 64 * 1024,
    requestTimeout: 30_000
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        frameSrc: ['https://challenges.cloudflare.com'],
        connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null
      }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' }
  });
  registerSecurity(app, db, config);

  const engine = new DdnsEngine(db, config);
  const scheduler = new Scheduler(db, engine);
  registerSetupRoutes(app, db, config);
  registerAuthRoutes(app, db, config);
  registerCloudflareRoutes(app, db, config);
  registerRecordRoutes(app, db, config, engine, scheduler);
  registerOperationRoutes(app, db, config, engine, scheduler);
  registerSystemRoutes(app, db, config, scheduler);

  const webRoot = resolve(process.env.WEB_ROOT ?? 'public');
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot, wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    if (existsSync(webRoot) && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}` }
    });
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues
        }
      });
    }
    if (error instanceof RequestError) {
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message, details: error.details }
      });
    }
    const caught = error instanceof Error ? error : new Error('Unknown server error');
    if ('code' in caught && caught.code === 'P2002') {
      return reply.code(409).send({
        error: {
          code: 'DUPLICATE',
          message: 'A record with the same account, zone, hostname, and type already exists'
        }
      });
    }
    const statusCode =
      'status' in caught && typeof caught.status === 'number' ? caught.status : 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : caught.message
      }
    });
  });
  app.addHook('onClose', async () => {
    scheduler.stop();
    await db.$disconnect();
  });
  if (options.startScheduler !== false) await scheduler.start();
  return app;
}
