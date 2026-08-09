import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { prisma, type Prisma } from '@infra-hub/database';
import {
  createProviderRegistry,
  decryptCredential,
  loadWorkerConfig,
  ProviderError,
  type ProviderDiscovery
} from '@infra-hub/shared';
import {
  connectionJobSchema,
  defaultJobOptions,
  JOBS,
  observePublicIpJobSchema,
  QUEUES,
  type ConnectionJob,
  type ObservePublicIpJob
} from '@infra-hub/jobs';

const envFile = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')].find(
  existsSync
);
if (envFile) loadDotenv({ path: envFile, quiet: true });
const config = loadWorkerConfig();
const workerHealthFile = process.env.WORKER_HEALTH_FILE ?? '/tmp/infra-hub-worker-ready';
rmSync(workerHealthFile, { force: true });
const workerRedisOptions = {
  connectTimeout: config.REDIS_CONNECT_TIMEOUT_MS,
  maxRetriesPerRequest: null,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000)
} as const;
const connection = new Redis(config.REDIS_URL, workerRedisOptions);
const schedulerConnection = new Redis(config.REDIS_URL, workerRedisOptions);
const cacheConnection = new Redis(config.REDIS_URL, {
  connectTimeout: config.REDIS_CONNECT_TIMEOUT_MS,
  commandTimeout: config.REDIS_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: true,
  retryStrategy: workerRedisOptions.retryStrategy
});
const providers = createProviderRegistry(config.CLOUDFLARE_API_BASE);

function dashboardCacheKey(userId: string): string {
  return `infra-hub:dashboard:${userId}`;
}

function safeError(error: unknown): string {
  if (error instanceof ProviderError || error instanceof Error)
    return error.message.slice(0, 1_000);
  return 'Unknown worker failure';
}

async function credentialForJob(connectionId: string, useStaged: boolean, credentialId?: string) {
  const credential = await prisma.providerCredential.findFirst({
    where: {
      connectionId,
      ...(credentialId ? { id: credentialId } : {}),
      status: useStaged ? { in: ['STAGED', 'ACTIVE'] } : 'ACTIVE'
    },
    orderBy: { createdAt: 'desc' }
  });
  if (!credential)
    throw new ProviderError(
      useStaged ? 'No staged credential found' : 'No active credential found'
    );
  return credential;
}

async function promoteCredential(connectionId: string, credentialId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const staged = await tx.providerCredential.findFirst({
      where: { id: credentialId, connectionId, status: 'STAGED' }
    });
    if (!staged) {
      const alreadyActive = await tx.providerCredential.findFirst({
        where: { id: credentialId, connectionId, status: 'ACTIVE' }
      });
      if (alreadyActive) return;
      throw new ProviderError('Staged credential is no longer available');
    }
    await tx.providerCredential.updateMany({
      where: { connectionId, status: 'ACTIVE', id: { not: credentialId } },
      data: { status: 'REVOKED' }
    });
    await tx.providerCredential.update({
      where: { id: credentialId },
      data: { status: 'ACTIVE', verifiedAt: new Date() }
    });
  });
}

async function reconcileDiscovery(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionId: string,
  discovery: ProviderDiscovery
): Promise<void> {
  const seenAccountIds: string[] = [];
  const accountByExternal = new Map<string, string>();
  for (const account of discovery.accounts) {
    const saved = await tx.providerAccount.upsert({
      where: { connectionId_externalId: { connectionId, externalId: account.externalId } },
      update: {
        name: account.name,
        userId,
        isSynthetic: account.isSynthetic ?? false,
        staleAt: null
      },
      create: {
        connectionId,
        userId,
        externalId: account.externalId,
        name: account.name,
        isSynthetic: account.isSynthetic ?? false
      }
    });
    seenAccountIds.push(saved.id);
    accountByExternal.set(account.externalId, saved.id);
  }
  await tx.providerAccount.updateMany({
    where: { connectionId, id: { notIn: seenAccountIds }, staleAt: null },
    data: { staleAt: new Date() }
  });

  const seenZoneIds: string[] = [];
  const zoneByExternal = new Map<string, string>();
  for (const zone of discovery.zones) {
    const accountId = accountByExternal.get(zone.accountExternalId);
    if (!accountId)
      throw new ProviderError(
        `Provider returned a zone for unknown account ${zone.accountExternalId}`
      );
    const saved = await tx.dnsZone.upsert({
      where: { accountId_externalId: { accountId, externalId: zone.externalId } },
      update: {
        name: zone.name,
        status: zone.status ?? null,
        nameservers: JSON.stringify(zone.nameservers),
        staleAt: null
      },
      create: {
        accountId,
        externalId: zone.externalId,
        name: zone.name,
        status: zone.status ?? null,
        nameservers: JSON.stringify(zone.nameservers)
      }
    });
    seenZoneIds.push(saved.id);
    zoneByExternal.set(zone.externalId, saved.id);
  }
  await tx.dnsZone.updateMany({
    where: { account: { connectionId }, id: { notIn: seenZoneIds }, staleAt: null },
    data: { staleAt: new Date() }
  });

  const seenRecordIds: string[] = [];
  for (const record of discovery.records) {
    const zoneId = zoneByExternal.get(record.zoneExternalId);
    if (!zoneId)
      throw new ProviderError(
        `Provider returned a record for unknown zone ${record.zoneExternalId}`
      );
    const saved = await tx.dnsRecord.upsert({
      where: { zoneId_externalId: { zoneId, externalId: record.externalId } },
      update: {
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl,
        proxied: record.proxied ?? null,
        priority: record.priority ?? null,
        staleAt: null
      },
      create: {
        zoneId,
        externalId: record.externalId,
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl,
        proxied: record.proxied ?? null,
        priority: record.priority ?? null
      }
    });
    seenRecordIds.push(saved.id);
  }
  await tx.dnsRecord.updateMany({
    where: { zone: { account: { connectionId } }, id: { notIn: seenRecordIds }, staleAt: null },
    data: { staleAt: new Date() }
  });
}

async function processConnectionJob(job: Job<ConnectionJob>): Promise<void> {
  const payload = connectionJobSchema.parse(job.data);
  const owned = await prisma.providerConnection.findFirst({
    where: { id: payload.connectionId, userId: payload.userId }
  });
  if (!owned) throw new ProviderError('Provider connection no longer exists');
  const syncRun = await prisma.syncRun.findFirst({
    where: { id: payload.syncRunId, connectionId: owned.id }
  });
  if (!syncRun) throw new ProviderError('Sync run no longer exists');
  if (syncRun.status === 'SUCCEEDED') return;

  const stagedOperation = job.name === JOBS.connectProvider || job.name === JOBS.replaceCredential;
  await prisma.syncRun.update({
    where: { id: syncRun.id },
    data: { status: 'RUNNING', startedAt: syncRun.startedAt ?? new Date(), errorMessage: null }
  });
  await prisma.providerConnection.update({
    where: { id: owned.id },
    data: { status: stagedOperation ? 'CONNECTING' : owned.status }
  });

  try {
    const encrypted = await credentialForJob(owned.id, stagedOperation, payload.credentialId);
    const credentials = decryptCredential(encrypted, config.APP_ENCRYPTION_KEY, owned.id);
    const adapter = providers.get(owned.providerKey);
    await job.updateProgress({ phase: 'validating' });
    await adapter.verify(credentials);
    if (stagedOperation && encrypted.status === 'STAGED')
      await promoteCredential(owned.id, encrypted.id);

    if (job.name === JOBS.testProvider) {
      await prisma.$transaction([
        prisma.providerConnection.update({
          where: { id: owned.id },
          data: { status: 'ACTIVE', statusMessage: null, lastCheckedAt: new Date() }
        }),
        prisma.syncRun.update({
          where: { id: syncRun.id },
          data: { status: 'SUCCEEDED', completedAt: new Date() }
        }),
        prisma.auditEvent.create({
          data: {
            userId: owned.userId,
            action: 'provider.test',
            entityType: 'ProviderConnection',
            entityId: owned.id,
            message: 'Provider credentials verified'
          }
        })
      ]);
      await cacheConnection.del(dashboardCacheKey(owned.userId));
      return;
    }

    await job.updateProgress({ phase: 'discovering' });
    const discovery = await adapter.discover(credentials);
    await job.updateProgress({
      phase: 'persisting',
      accounts: discovery.accounts.length,
      zones: discovery.zones.length
    });
    await prisma.$transaction(async (tx) => {
      await reconcileDiscovery(tx, owned.userId, owned.id, discovery);
      await tx.providerConnection.update({
        where: { id: owned.id },
        data: {
          status: 'ACTIVE',
          statusMessage: null,
          lastCheckedAt: new Date(),
          lastSyncedAt: new Date()
        }
      });
      await tx.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'SUCCEEDED',
          accountsFound: discovery.accounts.length,
          zonesFound: discovery.zones.length,
          recordsFound: discovery.records.length,
          completedAt: new Date()
        }
      });
      await tx.auditEvent.create({
        data: {
          userId: owned.userId,
          action: stagedOperation ? 'provider.connect' : 'provider.sync',
          entityType: 'ProviderConnection',
          entityId: owned.id,
          message: `Discovered ${discovery.accounts.length} accounts, ${discovery.zones.length} zones, and ${discovery.records.length} records`
        }
      });
    });
    await cacheConnection.del(dashboardCacheKey(owned.userId));
    await job.updateProgress({ phase: 'complete' });
  } catch (error) {
    const message = safeError(error);
    await prisma.$transaction([
      prisma.syncRun.update({
        where: { id: syncRun.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() }
      }),
      prisma.providerConnection.update({
        where: { id: owned.id },
        data: { status: 'FAILED', statusMessage: message, lastCheckedAt: new Date() }
      }),
      prisma.auditEvent.create({
        data: {
          userId: owned.userId,
          action: 'provider.failure',
          entityType: 'ProviderConnection',
          entityId: owned.id,
          message
        }
      })
    ]);
    await cacheConnection.del(dashboardCacheKey(owned.userId));
    throw error;
  }
}

async function fetchAddress(url: string, family: 4 | 6, source: string): Promise<void> {
  const response = await fetch(url, { headers: { accept: 'text/plain' } });
  if (!response.ok)
    throw new Error(`Public IPv${family} lookup failed with HTTP ${response.status}`);
  const address = (await response.text()).trim();
  const valid =
    family === 4
      ? /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) &&
        address.split('.').every((part) => Number(part) <= 255)
      : /^[0-9a-f:]+$/i.test(address) && address.includes(':');
  if (!valid) throw new Error(`Public IPv${family} service returned an invalid address`);
  const previous = await prisma.ipObservation.findFirst({
    where: { family },
    orderBy: { createdAt: 'desc' }
  });
  await prisma.ipObservation.create({
    data: { address, family, source, changed: Boolean(previous && previous.address !== address) }
  });
}

async function processObservation(job: Job<ObservePublicIpJob>): Promise<void> {
  const payload = observePublicIpJobSchema.parse(job.data);
  const results = await Promise.allSettled([
    fetchAddress(config.PUBLIC_IPV4_URL, 4, payload.source),
    fetchAddress(config.PUBLIC_IPV6_URL, 6, payload.source)
  ]);
  if (results.every((result) => result.status === 'rejected')) {
    throw new Error('All public IP observation sources failed');
  }
  const users = await prisma.user.findMany({ select: { id: true } });
  if (users.length) {
    await cacheConnection.del(...users.map((user) => dashboardCacheKey(user.id)));
  }
}

const dnsWorker = new Worker<ConnectionJob>(QUEUES.dns, processConnectionJob, {
  connection,
  concurrency: 4,
  lockDuration: 120_000
});
const systemWorker = new Worker<ObservePublicIpJob>(QUEUES.system, processObservation, {
  connection,
  concurrency: 1
});

async function configureScheduler(): Promise<Queue> {
  const queue = new Queue(QUEUES.system, { connection: schedulerConnection });
  await queue.upsertJobScheduler(
    'public-ip-observation',
    { pattern: config.IP_OBSERVATION_CRON },
    {
      name: JOBS.observePublicIp,
      data: { source: 'schedule' },
      opts: defaultJobOptions
    }
  );
  return queue;
}

const systemQueue = await configureScheduler();
writeFileSync(workerHealthFile, new Date().toISOString(), { encoding: 'utf8' });

for (const worker of [dnsWorker, systemWorker]) {
  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed: ${safeError(error)}`);
  });
}

async function shutdown(): Promise<void> {
  rmSync(workerHealthFile, { force: true });
  await Promise.all([dnsWorker.close(), systemWorker.close(), systemQueue.close()]);
  await Promise.all([
    connection.quit(),
    schedulerConnection.quit(),
    cacheConnection.quit(),
    prisma.$disconnect()
  ]);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
