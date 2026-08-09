import type { PrismaClient, RecordType, UpdateAction } from '@ddns/database';
import type { CreateDnsRecordInput, ManageExistingRecordInput } from '@ddns/shared';
import type { Config } from '../config.js';
import { CloudflareClient, type CloudflareRecordDto } from '../cloudflare/client.js';
import { detectPublicIp, parsePublicAddress } from '../ip/detection.js';
import { decryptSecret } from '../security/crypto.js';

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export async function cloudflareContext(
  db: PrismaClient,
  config: Config,
  accountId: string,
  zoneId: string
) {
  const [account, zone] = await Promise.all([
    db.cloudflareAccount.findUnique({ where: { id: accountId } }),
    db.cloudflareZone.findFirst({ where: { id: zoneId, accountId } })
  ]);
  if (!account || !zone)
    throw new RequestError('Invalid Cloudflare account or zone', 400, 'BAD_ZONE');
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
    zone,
    client: new CloudflareClient(
      token,
      fetch,
      config.HTTP_TIMEOUT_MS,
      4,
      config.CLOUDFLARE_API_BASE
    )
  };
}

export function normalizeHostname(input: string, zoneName: string) {
  const value = input.trim().toLowerCase().replace(/\.$/, '');
  const hostname = value === '@' ? zoneName : value.includes('.') ? value : `${value}.${zoneName}`;
  if (hostname !== zoneName && !hostname.endsWith(`.${zoneName}`)) {
    throw new RequestError('Hostname is outside the selected zone', 400, 'HOST_OUTSIDE_ZONE');
  }
  if (
    hostname.length > 253 ||
    hostname.split('.').some((label) => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))
  ) {
    throw new RequestError('Hostname is invalid', 400, 'INVALID_HOSTNAME');
  }
  return hostname;
}

export async function detectCurrentAddresses(db: PrismaClient, config: Config) {
  const settings = await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const run = await db.ipDetectionRun.create({ data: {} });
  const outcomes = await Promise.all(
    (['IPV4', 'IPV6'] as const).map(async (family) => {
      const configured = family === 'IPV4' ? settings.ipv4Providers : settings.ipv6Providers;
      const providers = Array.isArray(configured)
        ? configured.filter((item): item is string => typeof item === 'string')
        : family === 'IPV4'
          ? config.IPV4_PROVIDERS
          : config.IPV6_PROVIDERS;
      return {
        family,
        outcome: await detectPublicIp(family, providers, fetch, settings.requestTimeoutMs)
      };
    })
  );
  await db.ipDetectionResult.createMany({
    data: outcomes.flatMap(({ family, outcome }) =>
      outcome.attempts.map((attempt) => ({
        runId: run.id,
        family,
        provider: attempt.provider,
        success: attempt.success,
        address: attempt.address ?? null,
        error: attempt.error ?? null,
        durationMs: attempt.durationMs
      }))
    )
  });
  const addresses = {
    ipv4: outcomes.find(({ family }) => family === 'IPV4')?.outcome.address ?? null,
    ipv6: outcomes.find(({ family }) => family === 'IPV6')?.outcome.address ?? null
  };
  await db.ipDetectionRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      ipv4: addresses.ipv4,
      ipv6: addresses.ipv6,
      success: Boolean(addresses.ipv4 || addresses.ipv6)
    }
  });
  return { ...addresses, detectedAt: new Date().toISOString() };
}

export async function writeAudit(
  db: PrismaClient,
  record: { id: string; hostname: string; type: RecordType; content: string | null },
  action: UpdateAction,
  previousIp: string | null,
  newIp: string | null
) {
  const run = await db.ddnsRun.create({
    data: {
      trigger: 'MANUAL_UPDATE',
      status: 'SUCCESS',
      finishedAt: new Date(),
      recordsTotal: 1,
      recordsUpdated: action === 'CREATED' || action === 'UPDATED' ? 1 : 0,
      summary: `${action.toLowerCase()} ${record.hostname}`
    }
  });
  await db.ddnsUpdateLog.create({
    data: {
      runId: run.id,
      recordId: record.id,
      hostname: record.hostname,
      type: record.type,
      previousIp,
      newIp,
      action,
      result: 'SUCCESS',
      durationMs: 0
    }
  });
}

export async function linkExistingRecord(
  db: PrismaClient,
  config: Config,
  input: ManageExistingRecordInput
) {
  const context = await cloudflareContext(db, config, input.accountId, input.zoneId);
  const remote = await context.client.getRecord(
    context.zone.cloudflareId,
    input.cloudflareRecordId
  );
  if (remote.type !== 'A' && remote.type !== 'AAAA') {
    throw new RequestError(
      'Only A and AAAA records can be managed',
      400,
      'UNSUPPORTED_RECORD_TYPE'
    );
  }
  const hostname = normalizeHostname(remote.name, context.zone.name);
  const record = await db.managedDnsRecord.upsert({
    where: {
      accountId_zoneId_normalizedHostname_type: {
        accountId: input.accountId,
        zoneId: input.zoneId,
        normalizedHostname: hostname,
        type: remote.type
      }
    },
    create: {
      accountId: input.accountId,
      zoneId: input.zoneId,
      cloudflareRecordId: remote.id,
      type: remote.type,
      hostname,
      normalizedHostname: hostname,
      content: remote.content,
      proxied: remote.proxied,
      ttl: remote.ttl,
      enabled: input.ddnsEnabled,
      automatic: input.ddnsEnabled,
      health: input.ddnsEnabled ? 'UNKNOWN' : 'DISABLED'
    },
    update: {
      cloudflareRecordId: remote.id,
      content: remote.content,
      proxied: remote.proxied,
      ttl: remote.ttl,
      enabled: input.ddnsEnabled,
      automatic: input.ddnsEnabled,
      health: input.ddnsEnabled ? 'UNKNOWN' : 'DISABLED',
      lastError: null
    },
    include: { account: { select: { id: true, name: true } }, zone: true }
  });
  await writeAudit(db, record, 'CHECKED', remote.content, remote.content);
  return record;
}

function detectedContent(
  input: CreateDnsRecordInput,
  addresses: { ipv4: string | null; ipv6: string | null }
) {
  const family = input.type === 'A' ? 'IPV4' : 'IPV6';
  const value =
    input.ipSource === 'CUSTOM'
      ? input.customIp
      : input.ipSource === 'DETECTED_IPV4'
        ? addresses.ipv4
        : addresses.ipv6;
  if (!value)
    throw new RequestError(
      `Detected public ${family === 'IPV4' ? 'IPv4' : 'IPv6'} is unavailable`,
      422,
      'PUBLIC_IP_UNAVAILABLE'
    );
  return parsePublicAddress(value, family);
}

export async function createManagedRecord(
  db: PrismaClient,
  config: Config,
  input: CreateDnsRecordInput
) {
  const context = await cloudflareContext(db, config, input.accountId, input.zoneId);
  const hostname = normalizeHostname(input.hostname, context.zone.name);
  const existing = await context.client.findRecords(
    context.zone.cloudflareId,
    input.type,
    hostname
  );
  if (existing.length) {
    throw new RequestError('DNS record already exists', 409, 'DNS_RECORD_EXISTS', {
      record: existing[0],
      accountId: input.accountId,
      zoneId: input.zoneId
    });
  }
  const addresses =
    input.ipSource === 'CUSTOM'
      ? { ipv4: null, ipv6: null }
      : await detectCurrentAddresses(db, config);
  const content = detectedContent(input, addresses);
  const response = await context.client.createRecord(context.zone.cloudflareId, {
    type: input.type,
    name: hostname,
    content,
    proxied: input.proxied,
    ttl: input.ttl
  });
  try {
    const record = await db.managedDnsRecord.create({
      data: {
        accountId: input.accountId,
        zoneId: input.zoneId,
        cloudflareRecordId: response.data.id,
        type: response.data.type,
        hostname: response.data.name,
        normalizedHostname: response.data.name.toLowerCase(),
        content: response.data.content,
        proxied: response.data.proxied,
        ttl: response.data.ttl,
        enabled: input.ddnsEnabled,
        automatic: input.ddnsEnabled,
        health: input.ddnsEnabled ? 'HEALTHY' : 'DISABLED',
        lastCheckedAt: new Date(),
        lastUpdatedAt: new Date()
      },
      include: { account: { select: { id: true, name: true } }, zone: true }
    });
    await writeAudit(db, record, 'CREATED', null, response.data.content);
    return record;
  } catch (error) {
    await context.client
      .deleteRecord(context.zone.cloudflareId, response.data.id)
      .catch(() => undefined);
    throw error;
  }
}

export function discoveryStatus(
  remote: CloudflareRecordDto,
  managed: { id: string; enabled: boolean } | undefined,
  addresses: { ipv4: string | null; ipv6: string | null }
) {
  const publicIp = remote.type === 'A' ? addresses.ipv4 : addresses.ipv6;
  return {
    ...remote,
    managed: Boolean(managed),
    managedRecordId: managed?.id ?? null,
    ddnsEnabled: managed?.enabled ?? false,
    detectedIp: publicIp,
    syncStatus: !publicIp
      ? 'NO_PUBLIC_IP'
      : remote.content === publicIp
        ? 'SYNCHRONIZED'
        : 'NEEDS_UPDATE'
  };
}
