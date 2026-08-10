import type { PrismaClient } from '@ddns/database';
import { cloudflareAccountSchema } from '@ddns/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import { CloudflareClient } from '../cloudflare/client.js';
import { cloudflareContext, detectCurrentAddresses, discoveryStatus } from '../records/service.js';
import { decryptSecret, encryptSecret } from '../security/crypto.js';
import { writeAuthAudit } from '../security/auth-audit.js';
import {
  assertRecentStrongAuth,
  requireAuth,
  requireRecentStrongAuth
} from '../security/sessions.js';

function publicAccount(account: {
  id: string;
  name: string;
  tokenHint: string;
  verifiedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  zones?: unknown;
}) {
  return account;
}

async function clientFor(db: PrismaClient, config: Config, id: string, reply: FastifyReply) {
  const account = await db.cloudflareAccount.findUnique({ where: { id } });
  if (!account) {
    await reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'Cloudflare account not found' } });
    return null;
  }
  const token = decryptSecret(
    {
      ciphertext: Buffer.from(account.tokenCiphertext),
      iv: Buffer.from(account.tokenIv),
      authTag: Buffer.from(account.tokenAuthTag),
      keyVersion: account.tokenKeyVersion
    },
    config.ENCRYPTION_KEY
  );
  return {
    account,
    client: new CloudflareClient(
      token,
      fetch,
      config.HTTP_TIMEOUT_MS,
      4,
      config.CLOUDFLARE_API_BASE
    )
  };
}

async function reconcileZones(db: PrismaClient, accountId: string, client: CloudflareClient) {
  const zones = await client.listZones();
  for (const zone of zones) {
    const records = await client.listRecords(zone.id);
    await db.cloudflareZone.upsert({
      where: { accountId_cloudflareId: { accountId, cloudflareId: zone.id } },
      create: {
        accountId,
        cloudflareId: zone.id,
        name: zone.name,
        status: zone.status,
        recordCount: records.length,
        lastSyncedAt: new Date()
      },
      update: {
        name: zone.name,
        status: zone.status,
        recordCount: records.length,
        lastSyncedAt: new Date()
      }
    });
  }
  const accessibleIds = zones.map((zone) => zone.id);
  const staleZones = await db.cloudflareZone.findMany({
    where: {
      accountId,
      ...(accessibleIds.length ? { cloudflareId: { notIn: accessibleIds } } : {})
    },
    include: { _count: { select: { records: true } } }
  });
  for (const zone of staleZones) {
    if (zone._count.records === 0) {
      await db.cloudflareZone.delete({ where: { id: zone.id } });
    } else {
      await db.cloudflareZone.update({
        where: { id: zone.id },
        data: { status: 'inaccessible', lastSyncedAt: new Date() }
      });
    }
  }
  return zones;
}

export function registerCloudflareRoutes(app: FastifyInstance, db: PrismaClient, config: Config) {
  const strongAuth = requireRecentStrongAuth(db);

  app.get('/api/cloudflare/accounts', { preHandler: requireAuth }, async () => {
    const accounts = await db.cloudflareAccount.findMany({
      select: {
        id: true,
        name: true,
        tokenHint: true,
        verifiedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
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
        },
        _count: { select: { records: true } }
      },
      orderBy: { name: 'asc' }
    });
    return { items: accounts };
  });

  app.post(
    '/api/cloudflare/accounts',
    { preHandler: [requireAuth, strongAuth] },
    async (request, reply) => {
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
      select: {
        id: true,
        name: true,
        tokenHint: true,
        verifiedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        zones: true
      }
    });
    await writeAuthAudit(db, request.log, {
      type: 'CLOUDFLARE_CREDENTIAL_ADDED',
      success: true,
      request,
      username: request.authUser?.username
    });
    return reply.code(201).send(publicAccount(account));
  });

  app.post('/api/cloudflare/accounts/test', { preHandler: requireAuth }, async (request) => {
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

  app.post(
    '/api/cloudflare/accounts/:id/test',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const context = await clientFor(db, config, id, reply);
      if (!context) return;
      const verification = await context.client.verifyToken();
      await db.cloudflareAccount.update({
        where: { id },
        data: { verifiedAt: new Date(), lastError: null }
      });
      return { valid: verification.status === 'active' };
    }
  );

  app.put(
    '/api/cloudflare/accounts/:id/token',
    { preHandler: [requireAuth, strongAuth] },
    async (request) => {
    const { id } = request.params as { id: string };
    const token = (request.body as { token?: unknown })?.token;
    const input = cloudflareAccountSchema.pick({ token: true }).parse({ token });
    const client = new CloudflareClient(
      input.token,
      fetch,
      config.HTTP_TIMEOUT_MS,
      4,
      config.CLOUDFLARE_API_BASE
    );
    await client.verifyToken();
    const encrypted = encryptSecret(input.token, config.ENCRYPTION_KEY);
    const account = await db.cloudflareAccount.update({
      where: { id },
      data: {
        tokenCiphertext: new Uint8Array(encrypted.ciphertext),
        tokenIv: new Uint8Array(encrypted.iv),
        tokenAuthTag: new Uint8Array(encrypted.authTag),
        tokenKeyVersion: encrypted.keyVersion,
        tokenHint: encrypted.hint,
        verifiedAt: new Date(),
        lastError: null
      },
      select: {
        id: true,
        name: true,
        tokenHint: true,
        verifiedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true
      }
    });
    await writeAuthAudit(db, request.log, {
      type: 'CLOUDFLARE_CREDENTIAL_CHANGED',
      success: true,
      request,
      username: request.authUser?.username
    });
    return account;
  });

  app.patch('/api/cloudflare/accounts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = cloudflareAccountSchema.partial().parse(request.body);
    let tokenData = {};
    let replacementClient: CloudflareClient | undefined;
    if (input.token) {
      if (!(await assertRecentStrongAuth(db, request, reply))) return;
      const client = new CloudflareClient(
        input.token,
        fetch,
        config.HTTP_TIMEOUT_MS,
        4,
        config.CLOUDFLARE_API_BASE
      );
      await client.verifyToken();
      replacementClient = client;
      const encrypted = encryptSecret(input.token, config.ENCRYPTION_KEY);
      tokenData = {
        tokenCiphertext: new Uint8Array(encrypted.ciphertext),
        tokenIv: new Uint8Array(encrypted.iv),
        tokenAuthTag: new Uint8Array(encrypted.authTag),
        tokenKeyVersion: encrypted.keyVersion,
        tokenHint: encrypted.hint,
        verifiedAt: new Date(),
        lastError: null
      };
    }
    await db.cloudflareAccount.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...tokenData
      }
    });
    if (replacementClient) {
      await reconcileZones(db, id, replacementClient);
      await writeAuthAudit(db, request.log, {
        type: 'CLOUDFLARE_CREDENTIAL_CHANGED',
        success: true,
        request,
        username: request.authUser?.username
      });
    }
    return db.cloudflareAccount.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        tokenHint: true,
        verifiedAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        zones: {
          include: { _count: { select: { records: true } } }
        },
        _count: { select: { records: true } }
      }
    });
  });

  app.post(
    '/api/cloudflare/accounts/:id/zones/refresh',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const context = await clientFor(db, config, id, reply);
      if (!context) return;
      await reconcileZones(db, id, context.client);
      return {
        items: await db.cloudflareZone.findMany({
          where: { accountId: id },
          orderBy: { name: 'asc' }
        })
      };
    }
  );

  app.get(
    '/api/cloudflare/accounts/:id/zones/:zoneId/records',
    { preHandler: requireAuth },
    async (request) => {
      const { id, zoneId } = request.params as { id: string; zoneId: string };
      const context = await cloudflareContext(db, config, id, zoneId);
      const [remoteRecords, managedRecords, addresses] = await Promise.all([
        context.client.listRecords(context.zone.cloudflareId),
        db.managedDnsRecord.findMany({
          where: { accountId: id, zoneId },
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
      const discovered = remoteRecords.map((record) =>
        discoveryStatus(record, managedByCloudflareId.get(record.id), addresses)
      );
      const remoteIds = new Set(remoteRecords.map((record) => record.id));
      await Promise.all([
        ...discovered
          .filter((record) => record.managedRecordId)
          .map((record) =>
            db.managedDnsRecord.update({
              where: { id: record.managedRecordId! },
              data: {
                content: record.content,
                proxied: record.proxied,
                ttl: record.ttl,
                health: !record.ddnsEnabled
                  ? 'DISABLED'
                  : record.syncStatus === 'SYNCHRONIZED'
                    ? 'HEALTHY'
                    : record.syncStatus === 'NEEDS_UPDATE'
                      ? 'DRIFTED'
                      : 'ERROR',
                lastCheckedAt: new Date()
              }
            })
          ),
        ...managedRecords
          .filter(
            (record) => record.cloudflareRecordId && !remoteIds.has(record.cloudflareRecordId)
          )
          .map((record) =>
            db.managedDnsRecord.update({
              where: { id: record.id },
              data: {
                health: 'ERROR',
                lastCheckedAt: new Date(),
                lastError: 'Cloudflare DNS record no longer exists'
              }
            })
          )
      ]);
      return {
        zone: context.zone,
        publicIp: addresses,
        items: discovered
      };
    }
  );

  app.delete(
    '/api/cloudflare/accounts/:id',
    { preHandler: [requireAuth, strongAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (await db.managedDnsRecord.count({ where: { accountId: id } })) {
        return reply.code(409).send({
          error: {
            code: 'ACCOUNT_IN_USE',
            message: 'Remove managed records before deleting this account'
          }
        });
      }
      await db.cloudflareAccount.delete({ where: { id } });
      await writeAuthAudit(db, request.log, {
        type: 'CLOUDFLARE_CONNECTION_REMOVED',
        success: true,
        request,
        username: request.authUser?.username
      });
      return reply.code(204).send();
    }
  );
}
