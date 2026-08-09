import type { Prisma, PrismaClient, RecordHealth } from '@ddns/database';
import {
  createDnsRecordSchema,
  deleteCloudflareRecordSchema,
  manageExistingRecordsSchema,
  paginationSchema,
  recordPatchSchema
} from '@ddns/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { DdnsEngine } from '../ddns/engine.js';
import type { Scheduler } from '../ddns/scheduler.js';
import {
  cloudflareContext,
  createManagedRecord,
  linkExistingRecord,
  normalizeHostname,
  RequestError,
  writeAudit
} from '../records/service.js';
import { requireAuth } from '../security/sessions.js';

export function registerRecordRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  engine: DdnsEngine,
  scheduler: Scheduler
) {
  app.get('/api/records', { preHandler: requireAuth }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const { page, pageSize } = paginationSchema.parse(query);
    const health =
      typeof query.health === 'string' &&
      ['UNKNOWN', 'HEALTHY', 'DRIFTED', 'ERROR', 'DISABLED'].includes(query.health)
        ? (query.health as RecordHealth)
        : null;
    const where: Prisma.ManagedDnsRecordWhereInput = {
      ...(typeof query.accountId === 'string' && query.accountId
        ? { accountId: query.accountId }
        : {}),
      ...(typeof query.zoneId === 'string' && query.zoneId ? { zoneId: query.zoneId } : {}),
      ...(query.type === 'A' || query.type === 'AAAA' ? { type: query.type } : {}),
      ...(query.enabled === 'true'
        ? { enabled: true }
        : query.enabled === 'false'
          ? { enabled: false }
          : {}),
      ...(health ? { health } : {}),
      ...(typeof query.search === 'string' && query.search
        ? { hostname: { contains: query.search } }
        : {})
    };
    const [items, total] = await Promise.all([
      db.managedDnsRecord.findMany({
        where,
        include: { account: { select: { id: true, name: true } }, zone: true },
        orderBy: [{ hostname: 'asc' }, { type: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      db.managedDnsRecord.count({ where })
    ]);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  });

  app.post('/api/records', { preHandler: requireAuth }, async (request, reply) => {
    const input = createDnsRecordSchema.parse(request.body);
    return reply.code(201).send(await createManagedRecord(db, config, input));
  });

  app.post('/api/records/manage', { preHandler: requireAuth }, async (request, reply) => {
    const input = manageExistingRecordsSchema.parse(request.body);
    const items = [];
    for (const record of input.records) items.push(await linkExistingRecord(db, config, record));
    return reply.code(201).send({ items });
  });

  app.patch('/api/records/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = recordPatchSchema.parse(request.body);
    const current = await db.managedDnsRecord.findUnique({ where: { id } });
    if (!current)
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    const context = await cloudflareContext(db, config, current.accountId, current.zoneId);
    const hostname = input.hostname
      ? normalizeHostname(input.hostname, context.zone.name)
      : undefined;
    let remoteBefore:
      { id: string; name: string; content: string; proxied: boolean; ttl: number } | undefined;
    let remoteAfter:
      { id: string; name: string; content: string; proxied: boolean; ttl: number } | undefined;
    if (
      current.cloudflareRecordId &&
      (hostname || input.proxied !== undefined || input.ttl !== undefined)
    ) {
      remoteBefore = await context.client.getRecord(
        context.zone.cloudflareId,
        current.cloudflareRecordId
      );
      remoteAfter = (
        await context.client.patchRecord(context.zone.cloudflareId, current.cloudflareRecordId, {
          ...(hostname ? { name: hostname } : {}),
          ...(input.proxied !== undefined ? { proxied: input.proxied } : {}),
          ...(input.ttl !== undefined ? { ttl: input.ttl } : {})
        })
      ).data;
    }
    try {
      const updated = await db.managedDnsRecord.update({
        where: { id },
        data: {
          ...(remoteAfter
            ? {
                hostname: remoteAfter.name,
                normalizedHostname: remoteAfter.name.toLowerCase(),
                proxied: remoteAfter.proxied,
                ttl: remoteAfter.ttl
              }
            : {}),
          ...(input.enabled !== undefined
            ? { enabled: input.enabled, health: input.enabled ? 'UNKNOWN' : 'DISABLED' }
            : {}),
          ...(input.automatic !== undefined ? { automatic: input.automatic } : {})
        },
        include: { account: { select: { id: true, name: true } }, zone: true }
      });
      await writeAudit(
        db,
        updated,
        input.enabled === false ? 'DISABLED' : 'UPDATED',
        current.content,
        updated.content
      );
      return updated;
    } catch (error) {
      if (remoteBefore && current.cloudflareRecordId) {
        await context.client
          .patchRecord(context.zone.cloudflareId, current.cloudflareRecordId, {
            name: remoteBefore.name,
            proxied: remoteBefore.proxied,
            ttl: remoteBefore.ttl
          })
          .catch(() => undefined);
      }
      throw error;
    }
  });

  const runRecord =
    (trigger: 'MANUAL_CHECK' | 'MANUAL_UPDATE') =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!(await db.managedDnsRecord.findUnique({ where: { id } }))) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      }
      const result = await scheduler.runExclusive(() => engine.run({ trigger, recordId: id }));
      if (!result)
        return reply
          .code(409)
          .send({ error: { code: 'RUN_IN_PROGRESS', message: 'Another DDNS run is active' } });
      return result;
    };
  app.post('/api/records/:id/check', { preHandler: requireAuth }, runRecord('MANUAL_CHECK'));
  app.post('/api/records/:id/update', { preHandler: requireAuth }, runRecord('MANUAL_UPDATE'));
  app.post('/api/records/:id/force', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await db.managedDnsRecord.findUnique({ where: { id } }))) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    }
    const result = await scheduler.runExclusive(() =>
      engine.run({ trigger: 'FORCE', recordId: id, force: true })
    );
    if (!result) {
      return reply
        .code(409)
        .send({ error: { code: 'RUN_IN_PROGRESS', message: 'Another DDNS run is active' } });
    }
    return result;
  });

  app.delete('/api/records/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await db.managedDnsRecord.findUnique({ where: { id } });
    if (!record) throw new RequestError('Managed DNS record not found', 404, 'NOT_FOUND');
    const run = await db.ddnsRun.create({
      data: {
        trigger: 'MANUAL_UPDATE',
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsTotal: 1,
        summary: `Stopped managing ${record.hostname}`
      }
    });
    await db.$transaction([
      db.ddnsUpdateLog.create({
        data: {
          runId: run.id,
          recordId: record.id,
          hostname: record.hostname,
          type: record.type,
          previousIp: record.content,
          newIp: record.content,
          action: 'STOPPED_MANAGING',
          result: 'SUCCESS',
          durationMs: 0
        }
      }),
      db.managedDnsRecord.delete({ where: { id } })
    ]);
    return reply.code(204).send();
  });

  app.delete('/api/records/:id/cloudflare', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = deleteCloudflareRecordSchema.parse(request.body);
    const record = await db.managedDnsRecord.findUnique({ where: { id } });
    if (!record?.cloudflareRecordId)
      throw new RequestError('Managed DNS record not found', 404, 'NOT_FOUND');
    if (input.confirmation !== record.hostname) {
      throw new RequestError(
        'Type the full hostname to confirm deletion',
        400,
        'CONFIRMATION_MISMATCH'
      );
    }
    const context = await cloudflareContext(db, config, record.accountId, record.zoneId);
    await context.client.deleteRecord(context.zone.cloudflareId, record.cloudflareRecordId);
    const run = await db.ddnsRun.create({
      data: {
        trigger: 'MANUAL_UPDATE',
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsTotal: 1,
        recordsUpdated: 1,
        summary: `Deleted ${record.hostname} from Cloudflare`
      }
    });
    await db.$transaction([
      db.ddnsUpdateLog.create({
        data: {
          runId: run.id,
          recordId: record.id,
          hostname: record.hostname,
          type: record.type,
          previousIp: record.content,
          action: 'DELETED',
          result: 'SUCCESS',
          durationMs: 0
        }
      }),
      db.managedDnsRecord.delete({ where: { id } })
    ]);
    return reply.code(204).send();
  });
}
