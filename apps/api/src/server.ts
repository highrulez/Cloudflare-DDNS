import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { hash, verify, needsRehash, argon2id } from 'argon2';
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
const parsedRedisUrl = new URL(config.REDIS_URL);
const redisConnectionDetails = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || (parsedRedisUrl.protocol === 'rediss:' ? 6380 : 6379)),
  tls: parsedRedisUrl.protocol === 'rediss:',
  authenticationConfigured: Boolean(parsedRedisUrl.username || parsedRedisUrl.password)
};

function redisLog(
  level: 'info' | 'error',
  event: string,
  client: string,
  details: Record<string, unknown> = {}
): void {
  const entry = JSON.stringify({ event, client, ...details });
  if (level === 'error') console.error(entry);
  else console.info(entry);
}

const redisOptions = {
  connectTimeout: config.REDIS_CONNECT_TIMEOUT_MS,
  commandTimeout: config.REDIS_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000)
} as const;

redisLog('info', 'redis.connecting', 'request', redisConnectionDetails);
const redis = new Redis(config.REDIS_URL, redisOptions);
redisLog('info', 'redis.connecting', 'queue', redisConnectionDetails);
const queueRedis = new Redis(config.REDIS_URL, redisOptions);

function attachRedisEventLogging(client: Redis, name: string): void {
  client.on('connect', () => redisLog('info', 'redis.connected', name));
  client.on('ready', () => redisLog('info', 'redis.ready', name));
  client.on('error', (error) => redisLog('error', 'redis.error', name, { message: error.message }));
  client.on('close', () => redisLog('info', 'redis.close', name));
  client.on('reconnecting', (delay: number) =>
    redisLog('info', 'redis.reconnecting', name, { delayMs: delay })
  );
  client.on('end', () => redisLog('info', 'redis.end', name));
}

attachRedisEventLogging(redis, 'request');
attachRedisEventLogging(queueRedis, 'queue');
const dnsQueue = new Queue<ConnectionJob>(QUEUES.dns, { connection: queueRedis });
const systemQueue = new Queue(QUEUES.system, { connection: queueRedis });
const providers = createProviderRegistry(config.CLOUDFLARE_API_BASE);
const SESSION_PREFIX = 'infra-hub:session:';
const DASHBOARD_CACHE_PREFIX = 'infra-hub:dashboard:';

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: SessionUser;
    sessionToken?: string;
    loginReceivedAt?: number;
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

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  dependency: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new HttpError(
                503,
                'DEPENDENCY_TIMEOUT',
                `${dependency} did not respond within ${timeoutMs}ms`
              )
            ),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForRedisReady(client: Redis, name: string): Promise<void> {
  if (client.status === 'ready') return;
  await withTimeout(
    new Promise<void>((resolveReady, rejectReady) => {
      const cleanup = () => {
        client.off('ready', onReady);
        client.off('error', onError);
        client.off('end', onEnd);
      };
      const onReady = () => {
        cleanup();
        resolveReady();
      };
      const onError = (error: Error) => {
        cleanup();
        rejectReady(error);
      };
      const onEnd = () => {
        cleanup();
        rejectReady(new Error(`Redis ${name} client ended before becoming ready`));
      };
      client.once('ready', onReady);
      client.once('error', onError);
      client.once('end', onEnd);
    }),
    config.REDIS_CONNECT_TIMEOUT_MS,
    `Redis ${name} startup`
  );
}

function requireRedisReady(): void {
  if (redis.status !== 'ready') {
    throw new HttpError(503, 'REDIS_UNAVAILABLE', 'Redis is temporarily unavailable');
  }
}

async function redisCommand<T>(name: string, operation: () => Promise<T>): Promise<T> {
  requireRedisReady();
  return withTimeout(operation(), config.REDIS_COMMAND_TIMEOUT_MS, name);
}

async function loginStage<T>(
  request: FastifyRequest,
  event: string,
  operation: () => Promise<T>,
  timeoutMs?: number
): Promise<T> {
  const startedAt = performance.now();
  request.log.info({ event }, `${event}.start`);
  try {
    const result = await (timeoutMs ? withTimeout(operation(), timeoutMs, event) : operation());
    request.log.info(
      { event, durationMs: Math.round(performance.now() - startedAt) },
      `${event}.complete`
    );
    return result;
  } catch (error) {
    request.log.error(
      { event, durationMs: Math.round(performance.now() - startedAt), err: error },
      `${event}.failed`
    );
    throw error;
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

function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

async function writeSession(
  token: string,
  user: { id: string; sessionVersion: number }
): Promise<void> {
  await redisCommand('Redis session write', () =>
    redis.set(
      sessionKey(token),
      JSON.stringify({
        userId: user.id,
        sessionVersion: user.sessionVersion
      }),
      'EX',
      config.SESSION_TTL_SECONDS
    )
  );
}

async function authenticate(request: FastifyRequest): Promise<void> {
  const token = request.cookies[config.COOKIE_NAME];
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
  const raw = await redisCommand('Redis session lookup', () => redis.get(sessionKey(token)));
  if (!raw) throw new HttpError(401, 'SESSION_EXPIRED', 'Session expired');
  let data: { userId: string; sessionVersion: number };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    await redisCommand('Redis invalid-session cleanup', () => redis.del(sessionKey(token)));
    throw new HttpError(401, 'SESSION_INVALID', 'Session invalid');
  }
  const user = await withTimeout(
    prisma.user.findUnique({ where: { id: data.userId } }),
    config.DATABASE_OPERATION_TIMEOUT_MS,
    'MariaDB session lookup'
  );
  if (!user || user.sessionVersion !== data.sessionVersion) {
    await redisCommand('Redis stale-session cleanup', () => redis.del(sessionKey(token)));
    throw new HttpError(401, 'SESSION_INVALID', 'Session invalid');
  }
  request.sessionToken = token;
  request.sessionUser = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    mustChangePassword: user.mustChangePassword
  };
  await redisCommand('Redis session renewal', () =>
    redis.expire(sessionKey(token), config.SESSION_TTL_SECONDS)
  );
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
  const startedAt = performance.now();
  const configuredUser = await withTimeout(
    prisma.user.findUnique({
      where: { email: config.ADMIN_EMAIL }
    }),
    config.DATABASE_OPERATION_TIMEOUT_MS,
    'MariaDB admin lookup'
  );
  if (configuredUser) {
    if (configuredUser.role !== 'ADMIN' || !configuredUser.passwordHash) {
      throw new Error('Configured ADMIN_EMAIL exists but is not a complete administrator account');
    }
    if (configuredUser.mustChangePassword) {
      const verifyStartedAt = performance.now();
      const configuredPasswordMatches = await withTimeout(
        verify(configuredUser.passwordHash, config.ADMIN_PASSWORD),
        config.AUTH_PASSWORD_VERIFY_TIMEOUT_MS,
        'Bootstrap Argon2 verification'
      );
      console.info(
        JSON.stringify({
          event: 'auth.bootstrap.password_verify.complete',
          durationMs: Math.round(performance.now() - verifyStartedAt)
        })
      );
      if (!configuredPasswordMatches) {
        throw new Error(
          'Configured administrator still requires a password change, but ADMIN_PASSWORD does not match its stored hash'
        );
      }
    } else {
      needsRehash(configuredUser.passwordHash, {
        memoryCost: 65_536,
        timeCost: 3,
        parallelism: 1
      });
    }
    console.info(
      JSON.stringify({
        event: 'auth.bootstrap.complete',
        result: 'existing',
        durationMs: Math.round(performance.now() - startedAt)
      })
    );
    return;
  }
  const existingAdmin = await withTimeout(
    prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true }
    }),
    config.DATABASE_OPERATION_TIMEOUT_MS,
    'MariaDB administrator lookup'
  );
  if (existingAdmin) {
    throw new Error(
      'An administrator exists with a different email. ADMIN_EMAIL must match the existing administrator'
    );
  }
  const hashStartedAt = performance.now();
  const passwordHash = await withTimeout(
    hash(config.ADMIN_PASSWORD, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1
    }),
    config.AUTH_PASSWORD_VERIFY_TIMEOUT_MS,
    'Bootstrap Argon2 hashing'
  );
  console.info(
    JSON.stringify({
      event: 'auth.bootstrap.password_hash.complete',
      durationMs: Math.round(performance.now() - hashStartedAt)
    })
  );
  await withTimeout(
    prisma.user.create({
      data: {
        email: config.ADMIN_EMAIL,
        displayName: 'Administrator',
        passwordHash,
        role: 'ADMIN',
        mustChangePassword: true
      }
    }),
    config.DATABASE_OPERATION_TIMEOUT_MS,
    'MariaDB administrator creation'
  );
  console.info(
    JSON.stringify({
      event: 'auth.bootstrap.complete',
      result: 'created',
      durationMs: Math.round(performance.now() - startedAt)
    })
  );
}

async function verifyRedisIntegration(): Promise<void> {
  const startedAt = performance.now();
  const key = `infra-hub:startup:${randomBytes(12).toString('hex')}`;
  const value = randomBytes(16).toString('hex');
  await Promise.all([waitForRedisReady(redis, 'request'), waitForRedisReady(queueRedis, 'queue')]);
  redisLog('info', 'redis.authentication.success', 'request', {
    authenticationConfigured: redisConnectionDetails.authenticationConfigured
  });
  await redisCommand('Redis startup PING', () => redis.ping());
  redisLog('info', 'redis.ping.success', 'request');
  try {
    await redisCommand('Redis startup SET', () => redis.set(key, value, 'PX', 10_000));
    const stored = await redisCommand('Redis startup GET', () => redis.get(key));
    if (stored !== value) throw new Error('Redis startup SET/GET validation returned a mismatch');
  } finally {
    await redisCommand('Redis startup cleanup', () => redis.del(key)).catch(() => undefined);
  }
  console.info(
    JSON.stringify({
      event: 'redis.startup_check.complete',
      durationMs: Math.round(performance.now() - startedAt)
    })
  );
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
  app.addHook('onRequest', (request, _reply, done) => {
    try {
      if (request.url.startsWith('/api/')) requireRedisReady();
      if (request.method === 'POST' && request.url.startsWith('/api/v1/auth/login')) {
        request.loginReceivedAt = performance.now();
        request.log.info({ event: 'auth.login.request_received' }, 'auth.login.request_received');
      }
      done();
    } catch (error) {
      done(error as Error);
    }
  });
  // This deployment runs one API replica, so the in-memory limiter is sufficient.
  // Keeping rate limiting off Redis ensures every authentication Redis command
  // passes through the readiness gate and finite command timeout below.
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

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

  app.get('/health/live', { config: { rateLimit: false } }, () => ({ status: 'ok' }));
  app.get('/health/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await Promise.all([
        withTimeout(
          prisma.$queryRaw`SELECT 1`,
          config.DATABASE_OPERATION_TIMEOUT_MS,
          'MariaDB readiness check'
        ),
        redisCommand('Redis readiness check', () => redis.ping())
      ]);
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
      const loginStartedAt = performance.now();
      const loginStageTimeout = (stageTimeoutMs: number) => {
        const remainingMs = config.AUTH_LOGIN_TIMEOUT_MS - (performance.now() - loginStartedAt);
        if (remainingMs <= 0) {
          throw new HttpError(
            503,
            'AUTH_LOGIN_TIMEOUT',
            `Authentication did not complete within ${config.AUTH_LOGIN_TIMEOUT_MS}ms`
          );
        }
        return Math.min(stageTimeoutMs, remainingMs);
      };
      request.log.info(
        {
          event: 'auth.login',
          preHandlerDurationMs: request.loginReceivedAt
            ? Math.round(loginStartedAt - request.loginReceivedAt)
            : undefined
        },
        'auth.login.start'
      );
      const validationStartedAt = performance.now();
      request.log.info({ event: 'auth.login.validation' }, 'auth.login.validation.start');
      const input = parse(loginSchema, request.body);
      request.log.info(
        {
          event: 'auth.login.validation',
          durationMs: Math.round(performance.now() - validationStartedAt)
        },
        'auth.login.validation.complete'
      );
      const user = await loginStage(
        request,
        'auth.login.user_lookup',
        () => prisma.user.findUnique({ where: { email: input.email.toLowerCase() } }),
        loginStageTimeout(config.DATABASE_OPERATION_TIMEOUT_MS)
      );
      request.log.info(
        { event: 'auth.login.password_hash_lookup' },
        'auth.login.password_hash_lookup.start'
      );
      request.log.info(
        { event: 'auth.login.password_hash_lookup', found: Boolean(user?.passwordHash) },
        'auth.login.password_hash_lookup.complete'
      );
      const passwordValid =
        user &&
        (await loginStage(
          request,
          'auth.login.password_verify',
          () => verify(user.passwordHash, input.password),
          loginStageTimeout(config.AUTH_PASSWORD_VERIFY_TIMEOUT_MS)
        ));
      if (!user || !passwordValid) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      const sessionStartedAt = performance.now();
      request.log.info({ event: 'session.create' }, 'session.create.start');
      const token = createSessionToken();
      await loginStage(
        request,
        'session.redis.ping',
        () => redisCommand('Redis login PING', () => redis.ping()),
        loginStageTimeout(config.REDIS_COMMAND_TIMEOUT_MS)
      );
      await loginStage(
        request,
        'session.redis.set',
        () => writeSession(token, user),
        loginStageTimeout(config.REDIS_COMMAND_TIMEOUT_MS)
      );
      request.log.info(
        {
          event: 'session.create',
          durationMs: Math.round(performance.now() - sessionStartedAt)
        },
        'session.create.complete'
      );
      try {
        await loginStage(
          request,
          'auth.login.audit',
          () =>
            prisma.auditEvent.create({
              data: {
                userId: user.id,
                action: 'auth.login',
                entityType: 'User',
                entityId: user.id,
                message: 'Signed in'
              }
            }),
          loginStageTimeout(config.DATABASE_OPERATION_TIMEOUT_MS)
        );
      } catch (error) {
        await redisCommand('Redis failed-login cleanup', () => redis.del(sessionKey(token))).catch(
          () => undefined
        );
        throw error;
      }
      const cookieStartedAt = performance.now();
      request.log.info({ event: 'auth.login.cookie' }, 'auth.login.cookie.start');
      reply.setCookie(config.COOKIE_NAME, token, cookieOptions());
      request.log.info(
        {
          event: 'auth.login.cookie',
          durationMs: Math.round(performance.now() - cookieStartedAt)
        },
        'auth.login.cookie.complete'
      );
      const response = {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          mustChangePassword: user.mustChangePassword
        }
      };
      request.log.info(
        {
          event: 'auth.login.response',
          durationMs: Math.round(performance.now() - loginStartedAt)
        },
        'auth.login.response'
      );
      return reply.send(response);
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
        if (request.sessionToken) {
          await redisCommand('Redis logout session deletion', () =>
            redis.del(sessionKey(request.sessionToken as string))
          );
        }
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
          if (request.sessionToken) {
            await redisCommand('Redis password-change session deletion', () =>
              redis.del(sessionKey(request.sessionToken as string))
            );
          }
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
        await redisCommand('Redis dashboard invalidation', () =>
          redis.del(dashboardCacheKey(actor.id))
        );
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
        await redisCommand('Redis dashboard invalidation', () =>
          redis.del(dashboardCacheKey(actor.id))
        );
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
        await redisCommand('Redis dashboard invalidation', () =>
          redis.del(dashboardCacheKey(actor.id))
        );
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
        const cached = await redisCommand('Redis dashboard cache lookup', () =>
          redis.get(cacheKey)
        );
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
        await redisCommand('Redis dashboard cache write', () =>
          redis.set(cacheKey, JSON.stringify(dashboard), 'EX', 30)
        );
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
  await verifyRedisIntegration();
  await bootstrapAdmin();
  const app = await buildApp();
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  const shutdown = async () => {
    await app.close();
    await Promise.all([
      dnsQueue.close(),
      systemQueue.close(),
      redis.quit(),
      queueRedis.quit(),
      prisma.$disconnect()
    ]);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'api.startup.failed',
        message: error instanceof Error ? error.message : 'API startup failed'
      })
    );
    redis.disconnect(false);
    queueRedis.disconnect(false);
    process.exit(1);
  });
}
