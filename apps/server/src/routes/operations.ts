import type { Prisma, PrismaClient, RunTrigger } from '@ddns/database';
import { historyQuerySchema, paginationSchema, settingsSchema } from '@ddns/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { DdnsEngine } from '../ddns/engine.js';
import type { Scheduler } from '../ddns/scheduler.js';
import { detectPublicIp } from '../ip/detection.js';
import { requireAuth } from '../security/sessions.js';

export function registerOperationRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  engine: DdnsEngine,
  scheduler: Scheduler
) {
  app.get('/api/health', async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      const [schedulerState, latestIp] = await Promise.all([
        db.schedulerState.findUnique({ where: { id: 1 } }),
        db.ipDetectionRun.findFirst({ orderBy: { startedAt: 'desc' } })
      ]);
      return {
        status: 'ok',
        database: 'ok',
        scheduler: schedulerState,
        latestIp,
        timestamp: new Date().toISOString()
      };
    } catch {
      return reply
        .code(503)
        .send({ status: 'error', database: 'error', timestamp: new Date().toISOString() });
    }
  });

  app.get('/api/dashboard', { preHandler: requireAuth }, async () => {
    const [latestIp, schedulerState, recordGroups, lastRun, recentActivity] = await Promise.all([
      db.ipDetectionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      db.schedulerState.findUnique({ where: { id: 1 } }),
      db.managedDnsRecord.groupBy({ by: ['health'], _count: true }),
      db.ddnsRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      db.ddnsUpdateLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })
    ]);
    return {
      currentIp: {
        ipv4: latestIp?.ipv4 ?? null,
        ipv6: latestIp?.ipv6 ?? null,
        ipv4Status: latestIp?.ipv4Status ?? null,
        ipv6Status: latestIp?.ipv6Status ?? null,
        detectedAt: latestIp?.finishedAt ?? null
      },
      scheduler: schedulerState,
      records: {
        total: recordGroups.reduce((total, group) => total + group._count, 0),
        byHealth: Object.fromEntries(recordGroups.map((group) => [group.health, group._count]))
      },
      lastRun,
      recentActivity
    };
  });

  app.get('/api/settings', { preHandler: requireAuth }, async () =>
    db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
  );
  app.put('/api/settings', { preHandler: requireAuth }, async (request) => {
    const input = settingsSchema.parse(request.body);
    const settings = await db.appSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...input },
      update: input
    });
    await db.schedulerState.upsert({
      where: { id: 1 },
      create: { id: 1, nextCheckAt: new Date(Date.now() + input.intervalMinutes * 60_000) },
      update: { nextCheckAt: new Date(Date.now() + input.intervalMinutes * 60_000) }
    });
    return settings;
  });

  app.post('/api/ip/detect', { preHandler: requireAuth }, async () => {
    const settings = await db.appSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {}
    });
    const run = await db.ipDetectionRun.create({ data: {} });
    const outcomes = [];
    for (const family of ['IPV4', 'IPV6'] as const) {
      const configured = family === 'IPV4' ? settings.ipv4Providers : settings.ipv6Providers;
      const providers = Array.isArray(configured)
        ? configured.filter((item): item is string => typeof item === 'string')
        : family === 'IPV4'
          ? config.IPV4_PROVIDERS
          : config.IPV6_PROVIDERS;
      const outcome = await detectPublicIp(family, providers, fetch, settings.requestTimeoutMs);
      outcomes.push({ family, ...outcome });
      await db.ipDetectionResult.createMany({
        data: outcome.attempts.map((attempt) => ({
          runId: run.id,
          family,
          provider: attempt.provider,
          success: attempt.success,
          address: attempt.address ?? null,
          error: attempt.error ?? null,
          durationMs: attempt.durationMs
        }))
      });
    }
    const ipv4 = outcomes.find((item) => item.family === 'IPV4')?.address;
    const ipv6 = outcomes.find((item) => item.family === 'IPV6')?.address;
    const ipv4Status = outcomes.find((item) => item.family === 'IPV4')?.status ?? 'PROVIDER_FAILED';
    const ipv6Status = outcomes.find((item) => item.family === 'IPV6')?.status ?? 'PROVIDER_FAILED';
    await db.ipDetectionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        ipv4: ipv4 ?? null,
        ipv6: ipv6 ?? null,
        ipv4Status,
        ipv6Status,
        success: Boolean(ipv4 || ipv6)
      }
    });
    return {
      id: run.id,
      ipv4: ipv4 ?? null,
      ipv6: ipv6 ?? null,
      ipv4Status,
      ipv6Status,
      outcomes
    };
  });

  const execute =
    (trigger: RunTrigger, force = false) =>
    async (_request: unknown, reply: FastifyReply) => {
      const result = await scheduler.runExclusive(() => engine.run({ trigger, force }));
      if (!result)
        return reply
          .code(409)
          .send({ error: { code: 'RUN_IN_PROGRESS', message: 'Another DDNS run is active' } });
      return result;
    };
  app.post('/api/ddns/check', { preHandler: requireAuth }, execute('MANUAL_CHECK'));
  app.post('/api/ddns/update', { preHandler: requireAuth }, execute('MANUAL_UPDATE'));
  app.post('/api/ddns/force', { preHandler: requireAuth }, async (request, reply) => {
    if ((request.body as { confirm?: unknown })?.confirm !== true) {
      return reply
        .code(400)
        .send({
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Force update requires explicit confirmation'
          }
        });
    }
    return execute('FORCE', true)(request, reply);
  });

  app.get('/api/history/runs', { preHandler: requireAuth }, async (request) => {
    const query = historyQuerySchema.parse(request.query);
    const where: Prisma.DdnsRunWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger ? { trigger: query.trigger } : {}),
      ...(query.recordId ? { logs: { some: { recordId: query.recordId } } } : {})
    };
    const [items, total] = await Promise.all([
      db.ddnsRun.findMany({
        where,
        include: { logs: true },
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.ddnsRun.count({ where })
    ]);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    };
  });

  app.get('/api/history/logs', { preHandler: requireAuth }, async (request) => {
    const raw = request.query as Record<string, unknown>;
    const query = paginationSchema.parse(raw);
    let action: Prisma.DdnsUpdateLogWhereInput['action'];
    if (raw.action === 'check') action = { in: ['CHECKED', 'SKIPPED'] };
    if (raw.action === 'update' || raw.action === 'force-update') action = 'UPDATED';
    const result =
      raw.status === 'success'
        ? 'SUCCESS'
        : raw.status === 'failed'
          ? 'ERROR'
          : raw.status === 'skipped'
            ? 'UNCHANGED'
            : raw.result === 'SUCCESS' || raw.result === 'ERROR' || raw.result === 'UNCHANGED'
              ? raw.result
              : undefined;
    const where: Prisma.DdnsUpdateLogWhereInput = {
      ...(typeof raw.recordId === 'string' ? { recordId: raw.recordId } : {}),
      ...(typeof raw.record === 'string' && raw.record
        ? { hostname: { contains: raw.record } }
        : {}),
      ...(result ? { result } : {}),
      ...(action ? { action } : {})
    };
    const [items, total] = await Promise.all([
      db.ddnsUpdateLog.findMany({
        where,
        include: { run: { select: { trigger: true, status: true, startedAt: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.ddnsUpdateLog.count({ where })
    ]);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize)
    };
  });
}
