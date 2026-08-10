import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@ddns/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { CloudflareClient } from '../cloudflare/client.js';
import type { Scheduler } from '../ddns/scheduler.js';
import { detectCurrentAddresses } from '../records/service.js';
import { decryptSecret, encryptSecret } from '../security/crypto.js';
import { requireAuth } from '../security/sessions.js';
import { sanitizeDiagnosticText, systemLogs } from '../system/logs.js';

type TestStatus = 'success' | 'warning' | 'error';
interface SelfTest {
  id: string;
  name: string;
  status: TestStatus;
  latencyMs: number;
  message: string;
  timestamp: string;
}

const startedAt = new Date();
let cloudflareCache:
  | {
      expiresAt: number;
      value: Awaited<ReturnType<typeof probeCloudflare>>;
    }
  | undefined;
let selfTestsRunning = false;
let selfTestsLastStartedAt = 0;

function elapsed(started: number) {
  return Math.max(0, Date.now() - started);
}

export function normalizeSystemTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized || normalized.toLowerCase() === 'unknown') return null;
    value = normalized;
  }
  try {
    const date = value instanceof Date ? value : new Date(value as string | number);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch {
    return null;
  }
}

function forwarded(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

function requestProxyInfo(request: FastifyRequest, config: Config) {
  const forwardedProto = forwarded(request.headers['x-forwarded-proto']);
  const forwardedHost = forwarded(request.headers['x-forwarded-host']);
  const forwardedPort = forwarded(request.headers['x-forwarded-port']);
  const forwardedFor = forwarded(request.headers['x-forwarded-for']);
  const expected = config.APP_ORIGIN ? new URL(config.APP_ORIGIN) : undefined;
  const warnings: string[] = [];
  const reverseProxyDetected = Boolean(
    forwardedProto || forwardedHost || forwardedPort || forwardedFor
  );
  if (!reverseProxyDetected) warnings.push('Reverse proxy headers missing');
  if (request.protocol !== 'https') warnings.push('HTTPS detection failed');
  if (expected && request.protocol !== expected.protocol.replace(':', ''))
    warnings.push('APP_ORIGIN protocol mismatch');
  if (expected && request.hostname !== expected.hostname)
    warnings.push('APP_ORIGIN hostname mismatch');
  if (config.COOKIE_SECURE && request.protocol !== 'https')
    warnings.push('Secure cookies require detected HTTPS');
  return {
    reverseProxyDetected,
    https: request.protocol === 'https',
    protocol: request.protocol,
    hostname: request.hostname,
    clientIp: request.ip,
    forwardedProto: forwardedProto ?? null,
    forwardedHost: forwardedHost ?? null,
    forwardedPort: forwardedPort ?? null,
    forwardedFor: forwardedFor ?? null,
    appOrigin: config.APP_ORIGIN ?? null,
    cookieSecure: config.COOKIE_SECURE,
    trustProxy: true,
    warnings
  };
}

async function readSynologyVersion() {
  for (const filename of [
    '/host/etc.defaults/VERSION',
    '/etc.defaults/VERSION',
    '/host/etc/VERSION'
  ]) {
    try {
      const text = await fs.readFile(filename, 'utf8');
      const values = Object.fromEntries(
        text
          .split(/\r?\n/)
          .map((line) => line.match(/^([A-Za-z0-9_]+)=["']?(.*?)["']?$/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .map((match) => [match[1]!, match[2]!])
      );
      const version = values.productversion ?? values.majorversion;
      const build = values.buildnumber;
      return `Synology DSM${version ? ` ${version}` : ''}${build ? `-${build}` : ''}`;
    } catch {
      // Try the next DSM version path.
    }
  }
  return process.env.SYNOLOGY_OS ?? 'Synology DSM';
}

async function containerId() {
  for (const filename of ['/proc/self/cgroup', '/proc/self/mountinfo']) {
    try {
      const text = await fs.readFile(filename, 'utf8');
      const match = text.match(/(?:docker[-/]|containers\/)([a-f0-9]{12,64})/i);
      if (match?.[1]) return match[1].slice(0, 12);
    } catch {
      // Container metadata is best effort and never requires the Docker socket.
    }
  }
  return process.env.CONTAINER_ID ?? 'Unavailable';
}

async function databaseInfo(db: PrismaClient) {
  const started = Date.now();
  const rows = await db.$queryRaw<Array<{ version: string; databaseName: string | null }>>`
    SELECT VERSION() AS version, DATABASE() AS databaseName
  `;
  const migrationsRoot = process.env.MIGRATIONS_ROOT ?? '/app/database/prisma/migrations';
  let knownMigrations: string[];
  try {
    knownMigrations = (await fs.readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    const localRoot = path.resolve('packages/database/prisma/migrations');
    knownMigrations = (await fs.readdir(localRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }
  const applied = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
  `;
  const appliedNames = new Set(applied.map((migration) => migration.migration_name));
  const pending = knownMigrations.filter((migration) => !appliedNames.has(migration));
  return {
    status: 'healthy' as const,
    type: rows[0]?.version?.toLowerCase().includes('mariadb') ? 'MariaDB' : 'MySQL-compatible',
    version: rows[0]?.version ?? 'Unknown',
    database: rows[0]?.databaseName ?? 'Unknown',
    latencyMs: elapsed(started),
    currentMigration: applied[0]?.migration_name ?? null,
    pendingMigrations: pending
  };
}

async function probeCloudflare(db: PrismaClient, config: Config) {
  const accounts = await db.cloudflareAccount.findMany({ include: { zones: true } });
  if (!accounts.length) {
    return {
      status: 'warning' as const,
      accounts: 0,
      zones: 0,
      latencyMs: 0,
      lastSuccessfulRequest: null,
      permissions: { zoneRead: 'not_verified' as const, dnsEdit: 'not_verified' as const },
      message: 'No Cloudflare accounts configured'
    };
  }
  const started = Date.now();
  let healthy = 0;
  let zoneRead = false;
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const token = decryptSecret(
          {
            ciphertext: Buffer.from(account.tokenCiphertext),
            iv: Buffer.from(account.tokenIv),
            authTag: Buffer.from(account.tokenAuthTag),
            keyVersion: account.tokenKeyVersion
          },
          config.ENCRYPTION_KEY
        );
        const client = new CloudflareClient(
          token,
          fetch,
          config.HTTP_TIMEOUT_MS,
          2,
          config.CLOUDFLARE_API_BASE
        );
        await client.verifyToken();
        await client.listZones();
        healthy += 1;
        zoneRead = true;
      } catch {
        // Account errors are summarized without exposing provider responses or credentials.
      }
    })
  );
  return {
    status: healthy === accounts.length ? ('healthy' as const) : ('warning' as const),
    accounts: accounts.length,
    zones: new Set(accounts.flatMap((account) => account.zones.map((zone) => zone.cloudflareId)))
      .size,
    latencyMs: elapsed(started),
    lastSuccessfulRequest:
      accounts
        .map((account) => account.verifiedAt)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
    permissions: {
      zoneRead:
        zoneRead && healthy === accounts.length ? ('granted' as const) : ('denied' as const),
      // Cloudflare does not expose this token scope through the safe verify endpoint.
      dnsEdit: 'not_verified' as const
    },
    message: `${healthy}/${accounts.length} accounts reachable`
  };
}

async function cachedCloudflare(db: PrismaClient, config: Config, refresh = false) {
  if (!refresh && cloudflareCache && cloudflareCache.expiresAt > Date.now())
    return cloudflareCache.value;
  const value = await probeCloudflare(db, config);
  cloudflareCache = { expiresAt: Date.now() + 60_000, value };
  return value;
}

async function runTest(name: string, task: () => Promise<string> | string): Promise<SelfTest> {
  const started = Date.now();
  try {
    const message = await task();
    return {
      id: randomUUID(),
      name,
      status: 'success',
      latencyMs: elapsed(started),
      message,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      id: randomUUID(),
      name,
      status: 'error',
      latencyMs: elapsed(started),
      message: sanitizeDiagnosticText(error instanceof Error ? error.message : 'Test failed'),
      timestamp: new Date().toISOString()
    };
  }
}

export function registerSystemRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  scheduler: Scheduler
) {
  app.addHook('onSend', (request, reply, payload, done) => {
    if (request.url.startsWith('/api/system/')) {
      reply.header('cache-control', 'no-store, max-age=0');
      reply.header('pragma', 'no-cache');
    }
    done(null, payload);
  });

  app.get('/api/system/overview', { preHandler: requireAuth }, async (request) => {
    const [
      latestIp,
      detectionResults,
      database,
      cloudflare,
      settings,
      schedulerState,
      lease,
      lastRun,
      lastUpdate,
      managedRecords,
      osName,
      id
    ] = await Promise.all([
      db.ipDetectionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      db.ipDetectionResult.findMany({
        where: { success: true },
        orderBy: { createdAt: 'desc' },
        distinct: ['family']
      }),
      databaseInfo(db),
      cachedCloudflare(db, config),
      db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
      db.schedulerState.findUnique({ where: { id: 1 } }),
      db.schedulerLease.findUnique({ where: { name: 'ddns' } }),
      db.ddnsRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      db.ddnsUpdateLog.findFirst({
        where: { action: 'UPDATED', result: 'SUCCESS' },
        orderBy: { createdAt: 'desc' }
      }),
      db.managedDnsRecord.count(),
      readSynologyVersion(),
      containerId()
    ]);
    const resultFor = (family: 'IPV4' | 'IPV6') =>
      detectionResults.find((result) => result.family === family);
    const proxy = requestProxyInfo(request, config);
    return {
      generatedAt: new Date().toISOString(),
      network: {
        ipv4: latestIp?.ipv4 ?? null,
        ipv6: latestIp?.ipv6 ?? null,
        ipv4Status: latestIp?.ipv4Status ?? null,
        ipv6Status: latestIp?.ipv6Status ?? null,
        ipv4Provider: resultFor('IPV4')?.provider ?? null,
        ipv6Provider: resultFor('IPV6')?.provider ?? null,
        ipv4LatencyMs: resultFor('IPV4')?.durationMs ?? null,
        ipv6LatencyMs: resultFor('IPV6')?.durationMs ?? null,
        detectedAt: normalizeSystemTimestamp(latestIp?.finishedAt)
      },
      synology: {
        hostname: os.hostname(),
        operatingSystem: osName,
        kernel: os.release(),
        architecture: os.arch(),
        timezone: settings.timezone
      },
      docker: {
        containerId: id,
        containerName: process.env.CONTAINER_NAME ?? 'cloudflare-ddns-manager',
        networkMode: process.env.DOCKER_NETWORK_MODE ?? 'host',
        hostNetworking: (process.env.DOCKER_NETWORK_MODE ?? 'host') === 'host',
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: `${process.platform} ${process.arch}`
      },
      database,
      cloudflare: {
        ...cloudflare,
        lastSuccessfulRequest: normalizeSystemTimestamp(cloudflare.lastSuccessfulRequest)
      },
      ddns: {
        scheduler: schedulerState?.lastError ? 'degraded' : 'running',
        intervalMinutes: settings.intervalMinutes,
        lastRunAt: normalizeSystemTimestamp(lastRun?.finishedAt ?? lastRun?.startedAt),
        nextRunAt: normalizeSystemTimestamp(schedulerState?.nextCheckAt),
        lastSuccessfulUpdate: normalizeSystemTimestamp(lastUpdate?.createdAt),
        lastError: schedulerState?.lastError
          ? sanitizeDiagnosticText(schedulerState.lastError)
          : null,
        managedRecords,
        leaseOwner: lease?.ownerId ?? schedulerState?.ownerId ?? scheduler.ownerId,
        schedulerVersion: process.env.CONFIG_VERSION ?? '1'
      },
      reverseProxy: proxy,
      security: {
        https: proxy.https,
        reverseProxyDetected: proxy.reverseProxyDetected,
        cookieSecure: config.COOKIE_SECURE,
        turnstileConfigured: Boolean(config.TURNSTILE_SITE_KEY && config.TURNSTILE_SECRET_KEY),
        strongAuthAvailable: true
      },
      application: {
        version: process.env.APP_VERSION ?? '1.0.0',
        commit: process.env.GIT_COMMIT ?? 'unknown',
        buildDate: normalizeSystemTimestamp(process.env.BUILD_DATE),
        environment: config.NODE_ENV,
        configurationVersion: process.env.CONFIG_VERSION ?? '1',
        latestRelease: process.env.LATEST_RELEASE ?? null,
        startedAt: normalizeSystemTimestamp(startedAt)
      }
    };
  });

  app.post('/api/system/network/refresh', { preHandler: requireAuth }, async () =>
    detectCurrentAddresses(db, config)
  );

  app.post('/api/system/tests', { preHandler: requireAuth }, async (request, reply) => {
    if (selfTestsRunning) {
      return reply.code(409).send({
        error: { code: 'SELF_TEST_RUNNING', message: 'System self-tests are already running' }
      });
    }
    if (Date.now() - selfTestsLastStartedAt < 30_000) {
      return reply.code(429).send({
        error: { code: 'SELF_TEST_COOLDOWN', message: 'Wait 30 seconds before running tests again' }
      });
    }
    selfTestsRunning = true;
    selfTestsLastStartedAt = Date.now();
    try {
      const proxy = requestProxyInfo(request, config);
      const detection = detectCurrentAddresses(db, config);
      const tests = await Promise.all([
        runTest('IPv4 detection', async () => {
          const result = await detection;
          if (!result.ipv4) throw new Error(result.ipv4Status);
          return `Detected ${result.ipv4}`;
        }),
        runTest('IPv6 detection', async () => {
          const result = await detection;
          if (!result.ipv6) throw new Error(result.ipv6Status);
          return `Detected ${result.ipv6}`;
        }),
        runTest('Cloudflare API', async () => (await cachedCloudflare(db, config, true)).message),
        runTest('MariaDB connection', async () => {
          const value = await databaseInfo(db);
          return `${value.type} ${value.version}; ${value.latencyMs} ms`;
        }),
        runTest('Scheduler', async () => {
          const state = await db.schedulerState.findUnique({ where: { id: 1 } });
          if (state?.lastError) throw new Error(state.lastError);
          return 'Scheduler state and lease storage are reachable';
        }),
        runTest('Encryption', () => {
          const marker = randomUUID();
          const encrypted = encryptSecret(marker, config.ENCRYPTION_KEY);
          const decrypted = decryptSecret(encrypted, config.ENCRYPTION_KEY);
          if (decrypted !== marker) throw new Error('Encryption round trip failed');
          return 'AES-256-GCM round trip passed';
        }),
        runTest('Session', async () => {
          await db.session.count();
          return `Session store reachable; secure cookies ${config.COOKIE_SECURE ? 'enabled' : 'disabled'}`;
        }),
        runTest('Reverse Proxy', () => {
          if (proxy.warnings.length) throw new Error(proxy.warnings.join('; '));
          return `${proxy.protocol}://${proxy.hostname}; client ${proxy.clientIp}`;
        }),
        runTest('HTTPS', () => {
          if (!proxy.https) throw new Error('Request was not detected as HTTPS');
          return 'HTTPS detected through trusted proxy headers';
        }),
        runTest('DNS Resolution', async () => {
          const result = await dns.lookup('api.cloudflare.com');
          return `api.cloudflare.com resolved to ${result.address}`;
        }),
        runTest('Internet Connectivity', async () => {
          const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
            signal: AbortSignal.timeout(config.HTTP_TIMEOUT_MS)
          });
          if (!response.ok) throw new Error(`Internet probe returned HTTP ${response.status}`);
          return 'Outbound HTTPS connectivity passed';
        }),
        runTest('Cloudflare DNS lookup', async () => {
          const record = await db.managedDnsRecord.findFirst({ orderBy: { hostname: 'asc' } });
          const hostname = record?.hostname ?? 'cloudflare.com';
          const addresses = await dns.resolve(hostname);
          return `${hostname} resolved to ${addresses.slice(0, 3).join(', ')}`;
        })
      ]);
      return { timestamp: new Date().toISOString(), tests };
    } finally {
      selfTestsRunning = false;
    }
  });

  app.get('/api/system/logs', { preHandler: requireAuth }, (request) => {
    const query = request.query as { level?: string; category?: string; limit?: string };
    return {
      items: systemLogs.list({
        ...(query.level ? { level: query.level } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.limit ? { limit: Number(query.limit) } : {})
      })
    };
  });

  app.get('/api/system/logs/download', { preHandler: requireAuth }, async (_request, reply) => {
    const content = systemLogs
      .list({ limit: 1000 })
      .reverse()
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    return reply
      .header('content-type', 'application/x-ndjson; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="cloudflare-ddns-logs-${new Date().toISOString().slice(0, 10)}.ndjson"`
      )
      .send(content);
  });

  app.get('/api/system/diagnostics', { preHandler: requireAuth }, async (request, reply) => {
    const proxy = requestProxyInfo(request, config);
    const [latestIp, database, cloudflare, schedulerState] = await Promise.all([
      db.ipDetectionRun.findFirst({ orderBy: { startedAt: 'desc' } }),
      databaseInfo(db),
      cachedCloudflare(db, config),
      db.schedulerState.findUnique({ where: { id: 1 } })
    ]);
    const report = [
      `Application Version: ${process.env.APP_VERSION ?? '1.0.0'}`,
      `Git Commit: ${process.env.GIT_COMMIT ?? 'unknown'}`,
      `Docker: ${(process.env.DOCKER_NETWORK_MODE ?? 'host') === 'host' ? 'Host Networking' : 'Unknown'}`,
      `IPv4: ${latestIp?.ipv4 ?? latestIp?.ipv4Status ?? 'Not detected'}`,
      `IPv6: ${latestIp?.ipv6 ?? latestIp?.ipv6Status ?? 'Not detected'}`,
      `Database: ${database.status} (${database.type} ${database.version})`,
      `Migrations: ${database.pendingMigrations.length ? `${database.pendingMigrations.length} pending` : 'Up to date'}`,
      `Cloudflare: ${cloudflare.status} (${cloudflare.accounts} accounts, ${cloudflare.zones} zones)`,
      `Scheduler: ${schedulerState?.lastError ? 'Degraded' : 'Running'}`,
      `Reverse Proxy: ${proxy.warnings.length ? proxy.warnings.join('; ') : 'Healthy'}`,
      `APP_ORIGIN: ${config.APP_ORIGIN ?? 'Not configured'}`
    ].join('\n');
    return reply.header('content-type', 'text/plain; charset=utf-8').send(report);
  });
}
