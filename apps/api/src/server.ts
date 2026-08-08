import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { hash, verify, argon2id } from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { z, ZodError } from 'zod';
import { prisma } from '@infra-hub/database';
import {
  changePasswordSchema,
  createConnectionSchema,
  createProviderRegistry,
  ddnsSelectionSchema,
  encryptCredential,
  loadConfig,
  loginSchema,
  replaceCredentialSchema,
  type SessionUser
} from '@infra-hub/shared';
import {
  connectionRunJobId,
  defaultJobOptions,
  JOBS,
  QUEUES,
  type ConnectionJob
} from '@infra-hub/jobs';

const envFile = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find(
  existsSync
);
if (envFile) loadDotenv({ path: envFile, quiet: true });
const config = loadConfig();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const dnsQueue = new Queue<ConnectionJob>(QUEUES.dns, { connection: redis });
const systemQueue = new Queue(QUEUES.system, { connection: redis });
const providers = createProviderRegistry(config.CLOUDFLARE_API_BASE);
const SESSION_PREFIX = 'infra-hub:session:';
const DASHBOARD_CACHE_PREFIX = 'infra-hub:dashboard:';

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: SessionUser;
    sessionToken?: string;
  }
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

function sessionKey(token: string): string {
  return `${SESSION_PREFIX}${createHash('sha256').update(token).digest('hex')}`;
}

function dashboardCacheKey(userId: string): string {
  return `${DASHBOARD_CACHE_PREFIX}${userId}`;
}

async function createSession(user: { id: string; sessionVersion: number }): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await redis.set(
    sessionKey(token),
    JSON.stringify({
      userId: user.id,
      sessionVersion: user.sessionVersion
    }),
    'EX',
    config.SESSION_TTL_SECONDS
  );
  return token;
}

async function authenticate(request: FastifyRequest): Promise<void> {
  const token = request.cookies[config.COOKIE_NAME];
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  const raw = await redis.get(sessionKey(token));
  if (!raw) throw new HttpError(401, 'SESSION_EXPIRED', 'Session expired');
  let data: { userId: string; sessionVersion: number };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    await redis.del(sessionKey(token));
    throw new HttpError(401, 'SESSION_INVALID', 'Session invalid');
  }
  const user = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!user || user.sessionVersion !== data.sessionVersion) {
    await redis.del(sessionKey(token));
    throw new HttpError(401, 'SESSION_INVALID', 'Session invalid');
  }
  request.sessionToken = token;
  request.sessionUser = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword
  };
  await redis.expire(sessionKey(token), config.SESSION_TTL_SECONDS);
}

function currentUser(request: FastifyRequest): SessionUser {
  if (!request.sessionUser) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  return request.sessionUser;
}

function requireOrigin(request: FastifyRequest): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  const origin = request.headers.origin;
  if (!origin || !config.ALLOWED_ORIGINS.includes(origin)) {
    throw new HttpError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
  }
}

async function bootstrapAdmin(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: config.ADMIN_EMAIL } });
  if (existing) return;
  const passwordHash = await hash(config.ADMIN_PASSWORD, {
    type: argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1
  });
  await prisma.user.upsert({
    where: { email: config.ADMIN_EMAIL },
    update: {},
    create: {
      email: config.ADMIN_EMAIL,
      displayName: 'Administrator',
      passwordHash,
      role: 'ADMIN',
      mustChangePassword: true
    }
  });
}

async function queueConnectionOperation(
  userId: string,
  connectionId: string,
  name:
    | typeof JOBS.connectProvider
    | typeof JOBS.syncProvider
    | typeof JOBS.testProvider
    | typeof JOBS.replaceCredential,
  credentialId?: string
) {
  const syncRun = await prisma.syncRun.create({ data: { connectionId, status: 'QUEUED' } });
  const job = await dnsQueue.add(
    name,
    {
      userId,
      connectionId,
      syncRunId: syncRun.id,
      ...(credentialId ? { credentialId } : {})
    },
    {
      ...defaultJobOptions,
      jobId: connectionRunJobId(name, connectionId, syncRun.id)
    }
  );
  await prisma.syncRun.update({ where: { id: syncRun.id }, data: { jobId: String(job.id) } });
  return { jobId: job.id, syncRunId: syncRun.id, status: 'queued' as const };
}

function cookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    maxAge: config.SESSION_TTL_SECONDS,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {})
  } as const;
}

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    genReqId: (request) =>
      request.headers['x-request-id']?.toString() || randomBytes(12).toString('hex'),
    trustProxy: true,
    bodyLimit: 64 * 1024
  });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', redis });

  app.setErrorHandler((error, request, reply) => {
    const httpError = error instanceof HttpError ? error : undefined;
    const validation = error instanceof ZodError;
    const statusCode = httpError?.statusCode ?? (validation ? 400 : 500);
    if (statusCode >= 500) request.log.error({ err: error }, 'request failed');
    void reply.status(statusCode).send({
      error: {
        code: httpError?.code ?? (validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'),
        message: httpError?.message ?? (validation ? 'Invalid request' : 'Internal server error'),
        requestId: request.id
      }
    });
  });

  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });

  app.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: requireOrigin
    },
    async (request, reply) => {
      const input = parse(loginSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
      if (!user || !(await verify(user.passwordHash, input.password))) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      const token = await createSession(user);
      reply.setCookie(config.COOKIE_NAME, token, cookieOptions());
      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          action: 'auth.login',
          entityType: 'User',
          entityId: user.id,
          message: 'Signed in'
        }
      });
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          mustChangePassword: user.mustChangePassword
        }
      };
    }
  );

  app.register(
    (v1, _options, done) => {
      v1.addHook('preHandler', authenticate);
      v1.addHook('preHandler', requireOrigin);
      v1.addHook('preHandler', (request) => {
        if (!request.sessionUser?.mustChangePassword) return;
        const allowed = ['/auth/me', '/auth/logout', '/auth/profile', '/auth/change-password'];
        const routeUrl = request.routeOptions.url ?? request.url;
        if (!allowed.some((path) => routeUrl.endsWith(path))) {
          throw new HttpError(
            403,
            'PASSWORD_CHANGE_REQUIRED',
            'Change the bootstrap password before using Infrastructure Hub'
          );
        }
      });

      v1.post('/auth/logout', async (request, reply) => {
        if (request.sessionToken) await redis.del(sessionKey(request.sessionToken));
        reply.clearCookie(config.COOKIE_NAME, {
          path: '/',
          ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {})
        });
        return reply.status(204).send();
      });
      v1.get('/auth/me', (request) => ({ user: currentUser(request) }));
      v1.patch('/auth/profile', async (request) => {
        const actor = currentUser(request);
        const input = parse(
          z.object({
            displayName: z.string().trim().min(1).max(100),
            email: z
              .string()
              .email()
              .max(254)
              .transform((value) => value.toLowerCase())
          }),
          request.body
        );
        const user = await prisma.user.update({
          where: { id: actor.id },
          data: input,
          select: {
            id: true,
            email: true,
            displayName: true,
            mustChangePassword: true
          }
        });
        await prisma.auditEvent.create({
          data: {
            userId: actor.id,
            action: 'auth.profile_update',
            entityType: 'User',
            entityId: actor.id,
            message: 'Profile updated'
          }
        });
        return { user };
      });
      v1.post(
        '/auth/change-password',
        {
          config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
        },
        async (request, reply) => {
          const input = parse(changePasswordSchema, request.body);
          const actor = currentUser(request);
          const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
          if (!(await verify(user.passwordHash, input.currentPassword))) {
            throw new HttpError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
          }
          const passwordHash = await hash(input.newPassword, {
            type: argon2id,
            memoryCost: 65_536,
            timeCost: 3,
            parallelism: 1
          });
          await prisma.user.update({
            where: { id: actor.id },
            data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } }
          });
          if (request.sessionToken) await redis.del(sessionKey(request.sessionToken));
          reply.clearCookie(config.COOKIE_NAME, { path: '/' });
          return reply.status(204).send();
        }
      );

      v1.get('/providers', () => ({ providers: providers.catalog() }));
      v1.post('/connections', async (request, reply) => {
        const input = parse(createConnectionSchema, request.body);
        providers.get(input.providerKey);
        const actor = currentUser(request);
        const connection = await prisma.providerConnection.create({
          data: {
            userId: actor.id,
            providerKey: input.providerKey,
            label: input.label,
            status: 'PENDING'
          }
        });
        const encrypted = encryptCredential(
          input.credentials,
          config.APP_ENCRYPTION_KEY,
          connection.id,
          config.APP_ENCRYPTION_KEY_VERSION
        );
        const credential = await prisma.providerCredential.create({
          data: { connectionId: connection.id, status: 'STAGED', ...encrypted }
        });
        await redis.del(dashboardCacheKey(actor.id));
        const job = await queueConnectionOperation(
          actor.id,
          connection.id,
          JOBS.connectProvider,
          credential.id
        );
        return reply
          .status(202)
          .send({ connection: { ...connection, credentialHint: encrypted.maskedHint }, job });
      });
      v1.get('/connections', async (request) => {
        const actor = currentUser(request);
        const connections = await prisma.providerConnection.findMany({
          where: { userId: actor.id },
          include: { credentials: { where: { status: 'ACTIVE' }, select: { maskedHint: true } } },
          orderBy: { createdAt: 'desc' }
        });
        return {
          connections: connections.map(({ credentials, ...connection }) => ({
            ...connection,
            credentialHint: credentials[0]?.maskedHint
          }))
        };
      });
      v1.get('/connections/:id', async (request) => {
        const actor = currentUser(request);
        const { id } = parse(z.object({ id: z.string().cuid() }), request.params);
        const connection = await prisma.providerConnection.findFirst({
          where: { id, userId: actor.id },
          include: {
            credentials: {
              where: { status: 'ACTIVE' },
              select: { maskedHint: true, verifiedAt: true }
            },
            _count: { select: { accounts: true, syncRuns: true } }
          }
        });
        if (!connection) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
        return { connection };
      });
      v1.delete('/connections/:id', async (request, reply) => {
        const actor = currentUser(request);
        const { id } = parse(z.object({ id: z.string().cuid() }), request.params);
        const result = await prisma.providerConnection.deleteMany({
          where: { id, userId: actor.id }
        });
        if (!result.count) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
        await redis.del(dashboardCacheKey(actor.id));
        await prisma.auditEvent.create({
          data: {
            userId: actor.id,
            action: 'connection.delete',
            entityType: 'ProviderConnection',
            entityId: id,
            message: 'Provider connection deleted'
          }
        });
        return reply.status(204).send();
      });

      const operation =
        (name: typeof JOBS.syncProvider | typeof JOBS.testProvider) =>
        async (request: FastifyRequest, reply: FastifyReply) => {
          const actor = currentUser(request);
          const { id } = parse(z.object({ id: z.string().cuid() }), request.params);
          const connection = await prisma.providerConnection.findFirst({
            where: { id, userId: actor.id }
          });
          if (!connection) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
          return reply
            .status(202)
            .send({ job: await queueConnectionOperation(actor.id, id, name) });
        };
      v1.post('/connections/:id/resync', operation(JOBS.syncProvider));
      v1.post('/connections/:id/test', operation(JOBS.testProvider));
      v1.post('/connections/:id/credentials', async (request, reply) => {
        const actor = currentUser(request);
        const { id } = parse(z.object({ id: z.string().cuid() }), request.params);
        const input = parse(replaceCredentialSchema, request.body);
        const connection = await prisma.providerConnection.findFirst({
          where: { id, userId: actor.id }
        });
        if (!connection) throw new HttpError(404, 'NOT_FOUND', 'Connection not found');
        const encrypted = encryptCredential(
          input.credentials,
          config.APP_ENCRYPTION_KEY,
          id,
          config.APP_ENCRYPTION_KEY_VERSION
        );
        const credential = await prisma.providerCredential.create({
          data: { connectionId: id, status: 'STAGED', ...encrypted }
        });
        const job = await queueConnectionOperation(
          actor.id,
          id,
          JOBS.replaceCredential,
          credential.id
        );
        return reply.status(202).send({ credentialHint: encrypted.maskedHint, job });
      });

      v1.get('/accounts', async (request) => {
        const actor = currentUser(request);
        return {
          accounts: await prisma.providerAccount.findMany({
            where: { userId: actor.id, staleAt: null },
            include: {
              connection: { select: { id: true, label: true, providerKey: true } },
              _count: { select: { zones: true } }
            },
            orderBy: { name: 'asc' }
          })
        };
      });
      const zonesHandler = async (request: FastifyRequest) => {
        const actor = currentUser(request);
        return {
          zones: await prisma.dnsZone.findMany({
            where: { staleAt: null, account: { userId: actor.id, staleAt: null } },
            include: {
              account: {
                select: {
                  id: true,
                  name: true,
                  connectionId: true,
                  connection: { select: { label: true, providerKey: true } }
                }
              },
              _count: { select: { records: true } }
            },
            orderBy: { name: 'asc' }
          })
        };
      };
      v1.get('/domains', zonesHandler);
      v1.get('/zones', zonesHandler);
      v1.get('/records', async (request) => {
        const actor = currentUser(request);
        const query = parse(z.object({ zoneId: z.string().cuid().optional() }), request.query);
        return {
          records: await prisma.dnsRecord.findMany({
            where: {
              staleAt: null,
              ...(query.zoneId ? { zoneId: query.zoneId } : {}),
              zone: { account: { userId: actor.id, staleAt: null } }
            },
            include: { selection: true, zone: { select: { name: true } } },
            orderBy: [{ name: 'asc' }, { type: 'asc' }]
          })
        };
      });
      v1.put('/records/:id/ddns-selection', async (request) => {
        const actor = currentUser(request);
        const { id } = parse(z.object({ id: z.string().cuid() }), request.params);
        const input = parse(ddnsSelectionSchema, request.body);
        const record = await prisma.dnsRecord.findFirst({
          where: {
            id,
            staleAt: null,
            type: { in: ['A', 'AAAA'] },
            zone: { account: { userId: actor.id } }
          }
        });
        if (!record) throw new HttpError(404, 'NOT_FOUND', 'Eligible DNS record not found');
        const selection = await prisma.ddnsSelection.upsert({
          where: { recordId: id },
          update: { enabled: input.enabled },
          create: { recordId: id, userId: actor.id, enabled: input.enabled }
        });
        await redis.del(dashboardCacheKey(actor.id));
        return { selection };
      });
      v1.get('/activity', async (request) => {
        const actor = currentUser(request);
        return {
          events: await prisma.auditEvent.findMany({
            where: { userId: actor.id },
            orderBy: { createdAt: 'desc' },
            take: 100
          }),
          syncRuns: await prisma.syncRun.findMany({
            where: { connection: { userId: actor.id } },
            orderBy: { createdAt: 'desc' },
            take: 50
          })
        };
      });
      const dashboardHandler = async (request: FastifyRequest) => {
        const actor = currentUser(request);
        const cacheKey = dashboardCacheKey(actor.id);
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as unknown;
        const [
          connections,
          accounts,
          zones,
          records,
          selectedRecords,
          recentActivity,
          latestIp,
          lastIpChange,
          lastSync
        ] = await Promise.all([
          prisma.providerConnection.count({ where: { userId: actor.id, status: 'ACTIVE' } }),
          prisma.providerAccount.count({ where: { userId: actor.id, staleAt: null } }),
          prisma.dnsZone.count({ where: { staleAt: null, account: { userId: actor.id } } }),
          prisma.dnsRecord.count({
            where: { staleAt: null, zone: { account: { userId: actor.id } } }
          }),
          prisma.ddnsSelection.count({ where: { userId: actor.id, enabled: true } }),
          prisma.auditEvent.findMany({
            where: { userId: actor.id },
            orderBy: { createdAt: 'desc' },
            take: 10
          }),
          prisma.ipObservation.findFirst({
            where: { family: 4 },
            orderBy: { createdAt: 'desc' }
          }),
          prisma.ipObservation.findFirst({
            where: { family: 4, changed: true },
            orderBy: { createdAt: 'desc' }
          }),
          prisma.providerConnection.findFirst({
            where: { userId: actor.id, lastSyncedAt: { not: null } },
            orderBy: { lastSyncedAt: 'desc' },
            select: { lastSyncedAt: true }
          })
        ]);
        const dashboard = {
          publicIp: latestIp?.address,
          connectedProviders: connections,
          managedDomains: zones,
          managedRecords: selectedRecords,
          discoveredRecords: records,
          lastSyncAt: lastSync?.lastSyncedAt,
          lastIpChangeAt: lastIpChange?.createdAt,
          counts: { connections, accounts, zones, records, selectedRecords },
          recentActivity
        };
        await redis.set(cacheKey, JSON.stringify(dashboard), 'EX', 30);
        return dashboard;
      };
      v1.get('/dashboard', dashboardHandler);
      v1.get('/dashboard/summary', dashboardHandler);
      v1.get('/jobs/:queue/:id', async (request) => {
        const actor = currentUser(request);
        const { queue, id } = parse(
          z.object({ queue: z.enum(['dns', 'system']), id: z.string().min(1).max(191) }),
          request.params
        );
        const job = await (queue === 'dns' ? dnsQueue : systemQueue).getJob(id);
        if (!job || (queue === 'dns' && (job.data as Partial<ConnectionJob>).userId !== actor.id)) {
          throw new HttpError(404, 'NOT_FOUND', 'Job not found');
        }
        return {
          job: {
            id: job.id,
            name: job.name,
            state: await job.getState(),
            progress: job.progress,
            failedReason: job.failedReason
          }
        };
      });
      done();
    },
    { prefix: '/api/v1' }
  );

  return app;
}

async function start(): Promise<void> {
  await bootstrapAdmin();
  const app = await buildApp();
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  const shutdown = async () => {
    await app.close();
    await Promise.all([dnsQueue.close(), systemQueue.close(), redis.quit(), prisma.$disconnect()]);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'API startup failed');
    process.exitCode = 1;
  });
}
