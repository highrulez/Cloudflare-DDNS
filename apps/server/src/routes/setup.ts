import argon2 from 'argon2';
import type { PrismaClient } from '@ddns/database';
import {
  adminSetupSchema,
  cloudflareAccountSchema,
  createDnsRecordSchema,
  manageExistingRecordsSchema,
  settingsSchema
} from '@ddns/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import { CloudflareClient } from '../cloudflare/client.js';
import {
  cloudflareContext,
  createManagedRecord,
  detectCurrentAddresses,
  discoveryStatus,
  linkExistingRecord
} from '../records/service.js';
import { encryptSecret } from '../security/crypto.js';
import { createSession, requireAuth, setSessionCookie } from '../security/sessions.js';

async function ensureSetupOpen(db: PrismaClient, reply: FastifyReply) {
  const state = await db.setupState.findUnique({ where: { id: 1 } });
  if (state?.completedAt) {
    await reply
      .code(409)
      .send({ error: { code: 'SETUP_COMPLETE', message: 'Initial setup is already complete' } });
    return false;
  }
  return true;
}

export function registerSetupRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  app.addHook('preHandler', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (
      !pathname?.startsWith('/api/setup/') ||
      pathname === '/api/setup/status' ||
      pathname === '/api/setup/admin'
    )
      return;
    if ((await db.user.count()) > 0) await requireAuth(request, reply);
  });

  app.get('/api/setup/status', async () => {
    const [state, users] = await Promise.all([
      db.setupState.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
      db.user.count()
    ]);
    return { completed: Boolean(state.completedAt), step: state.step, hasAdmin: users > 0 };
  });

  app.post('/api/setup/admin', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = adminSetupSchema.parse(request.body);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await db.$transaction(
        async (transaction) => {
          if ((await transaction.user.count()) > 0) throw new Error('ADMIN_EXISTS');
          const created = await transaction.user.create({
            data: { username: input.username, passwordHash }
          });
          await transaction.setupState.upsert({
            where: { id: 1 },
            create: { id: 1, step: 2 },
            update: { step: 2 }
          });
          return created;
        },
        { isolationLevel: 'Serializable' }
      );
      const session = await createSession(db, config, user.id);
      setSessionCookie(reply, config, session.token, session.expiresAt);
      return reply.code(201).send({ id: user.id, username: user.username, step: 2 });
    } catch (error) {
      if (error instanceof Error && error.message === 'ADMIN_EXISTS') {
        return reply
          .code(409)
          .send({ error: { code: 'ADMIN_EXISTS', message: 'An administrator already exists' } });
      }
      throw error;
    }
  });

  app.post('/api/setup/cloudflare/test', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = cloudflareAccountSchema.parse(request.body);
    const client = new CloudflareClient(
      input.token,
      fetch,
      config.HTTP_TIMEOUT_MS,
      4,
      config.CLOUDFLARE_API_BASE
    );
    const [verification, zones] = await Promise.all([client.verifyToken(), client.listZones()]);
    return { valid: verification.status === 'active', zones };
  });

  app.post('/api/setup/cloudflare', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = cloudflareAccountSchema.parse(request.body);
    const client = new CloudflareClient(
      input.token,
      fetch,
      config.HTTP_TIMEOUT_MS,
      4,
      config.CLOUDFLARE_API_BASE
    );
    await client.verifyToken();
    const zones = await client.listZones();
    const discoveredZones = [];
    for (const zone of zones) {
      const records = await client.listRecords(zone.id);
      discoveredZones.push({
        cloudflareId: zone.id,
        name: zone.name,
        status: zone.status,
        recordCount: records.length,
        lastSyncedAt: new Date()
      });
    }
    const encrypted = encryptSecret(input.token, config.ENCRYPTION_KEY);
    const account = await db.cloudflareAccount.create({
      data: {
        name: input.name,
        tokenCiphertext: new Uint8Array(encrypted.ciphertext),
        tokenIv: new Uint8Array(encrypted.iv),
        tokenAuthTag: new Uint8Array(encrypted.authTag),
        tokenKeyVersion: encrypted.keyVersion,
        tokenHint: encrypted.hint,
        verifiedAt: new Date(),
        zones: { create: discoveredZones }
      },
      include: { zones: true }
    });
    await db.setupState.upsert({
      where: { id: 1 },
      create: { id: 1, step: 3 },
      update: { step: 3 }
    });
    return reply.code(201).send({
      ...account,
      tokenCiphertext: undefined,
      tokenIv: undefined,
      tokenAuthTag: undefined
    });
  });

  app.get('/api/setup/ip', async (_request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    return detectCurrentAddresses(db, config);
  });

  app.get('/api/setup/cloudflare/:accountId/zones/:zoneId/records', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const { accountId, zoneId } = request.params as { accountId: string; zoneId: string };
    const context = await cloudflareContext(db, config, accountId, zoneId);
    const [remoteRecords, managedRecords, addresses] = await Promise.all([
      context.client.listRecords(context.zone.cloudflareId),
      db.managedDnsRecord.findMany({
        where: { accountId, zoneId },
        select: { id: true, cloudflareRecordId: true, enabled: true }
      }),
      detectCurrentAddresses(db, config)
    ]);
    await db.cloudflareZone.update({
      where: { id: zoneId },
      data: { recordCount: remoteRecords.length, lastSyncedAt: new Date() }
    });
    const managedByCloudflareId = new Map(
      managedRecords
        .filter((record): record is typeof record & { cloudflareRecordId: string } =>
          Boolean(record.cloudflareRecordId)
        )
        .map((record) => [record.cloudflareRecordId, record])
    );
    return {
      zone: context.zone,
      publicIp: addresses,
      items: remoteRecords.map((record) =>
        discoveryStatus(record, managedByCloudflareId.get(record.id), addresses)
      )
    };
  });

  app.post('/api/setup/records/manage', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = manageExistingRecordsSchema.parse(request.body);
    const items = [];
    for (const record of input.records) items.push(await linkExistingRecord(db, config, record));
    await db.setupState.update({ where: { id: 1 }, data: { step: 4 } });
    return reply.code(201).send({ items });
  });

  app.post('/api/setup/records', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = createDnsRecordSchema.parse(request.body);
    const record = await createManagedRecord(db, config, input);
    await db.setupState.update({ where: { id: 1 }, data: { step: 4 } });
    return reply.code(201).send(record);
  });

  app.get('/api/setup/cloudflare/accounts', async (_request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    return {
      items: await db.cloudflareAccount.findMany({
        select: {
          id: true,
          name: true,
          zones: {
            select: {
              id: true,
              cloudflareId: true,
              name: true,
              status: true,
              recordCount: true,
              lastSyncedAt: true,
              _count: { select: { records: true } }
            }
          }
        },
        orderBy: { name: 'asc' }
      })
    };
  });

  app.put('/api/setup/settings', async (request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const input = settingsSchema.parse(request.body);
    const settings = await db.appSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...input },
      update: input
    });
    return settings;
  });

  app.post('/api/setup/complete', async (_request, reply) => {
    if (!(await ensureSetupOpen(db, reply))) return;
    const [users, accounts, records] = await Promise.all([
      db.user.count(),
      db.cloudflareAccount.count(),
      db.managedDnsRecord.count()
    ]);
    if (!users || !accounts || !records) {
      return reply.code(400).send({
        error: {
          code: 'SETUP_INCOMPLETE',
          message: 'Administrator, Cloudflare account, and record are required'
        }
      });
    }
    const state = await db.setupState.update({
      where: { id: 1 },
      data: { step: 4, completedAt: new Date() }
    });
    return { completed: true, completedAt: state.completedAt };
  });
}
