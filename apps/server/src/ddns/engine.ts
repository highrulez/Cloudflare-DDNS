import type { PrismaClient, RunTrigger } from '@ddns/database';
import type { Config } from '../config.js';
import { CloudflareClient, CloudflareError } from '../cloudflare/client.js';
import { decryptSecret } from '../security/crypto.js';
import { detectPublicIp, type AddressFamily } from '../ip/detection.js';

export function decideUpdate(
  current: string,
  detected: string,
  force: boolean,
  checkOnly: boolean
) {
  if (checkOnly) return 'CHECKED' as const;
  if (force || current !== detected) return 'UPDATED' as const;
  return 'SKIPPED' as const;
}

async function mapConcurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        if (item !== undefined) await task(item);
      }
    })
  );
}

export class DdnsEngine {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: Config,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async run(options: { trigger: RunTrigger; force?: boolean; recordId?: string }) {
    const force = options.force === true;
    const checkOnly = options.trigger === 'MANUAL_CHECK';
    const run = await this.db.ddnsRun.create({ data: { trigger: options.trigger, force } });
    try {
      const settings = await this.db.appSettings.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: {}
      });
      const enabledFamilies: AddressFamily[] = [
        ...(settings.ipv4Enabled ? (['IPV4'] as const) : []),
        ...(settings.ipv6Enabled ? (['IPV6'] as const) : [])
      ];
      const detected = new Map<AddressFamily, string>();
      const detectionStatuses = new Map<AddressFamily, string>([
        ['IPV4', settings.ipv4Enabled ? 'PROVIDER_FAILED' : 'DISABLED'],
        ['IPV6', settings.ipv6Enabled ? 'PROVIDER_FAILED' : 'DISABLED']
      ]);
      const detectionRun = await this.db.ipDetectionRun.create({ data: { ddnsRunId: run.id } });

      for (const family of enabledFamilies) {
        const configured = family === 'IPV4' ? settings.ipv4Providers : settings.ipv6Providers;
        const providers = Array.isArray(configured)
          ? configured.filter((item): item is string => typeof item === 'string')
          : undefined;
        const fallbackProviders =
          family === 'IPV4' ? this.config.IPV4_PROVIDERS : this.config.IPV6_PROVIDERS;
        const outcome = await detectPublicIp(
          family,
          providers?.length ? providers : fallbackProviders,
          this.fetcher,
          settings.requestTimeoutMs
        );
        detectionStatuses.set(family, outcome.status);
        if (outcome.address) detected.set(family, outcome.address);
        await this.db.ipDetectionResult.createMany({
          data: outcome.attempts.map((attempt) => ({
            runId: detectionRun.id,
            family: attempt.family,
            provider: attempt.provider,
            success: attempt.success,
            address: attempt.address ?? null,
            error: attempt.error ?? null,
            durationMs: attempt.durationMs
          }))
        });
      }
      await this.db.ipDetectionRun.update({
        where: { id: detectionRun.id },
        data: {
          finishedAt: new Date(),
          ipv4: detected.get('IPV4') ?? null,
          ipv6: detected.get('IPV6') ?? null,
          ipv4Status: detectionStatuses.get('IPV4') ?? 'PROVIDER_FAILED',
          ipv6Status: detectionStatuses.get('IPV6') ?? 'PROVIDER_FAILED',
          success: detected.size > 0
        }
      });

      const enabledTypes = [
        ...(settings.ipv4Enabled ? (['A'] as const) : []),
        ...(settings.ipv6Enabled ? (['AAAA'] as const) : [])
      ];
      const records = await this.db.managedDnsRecord.findMany({
        where: {
          enabled: true,
          type: { in: enabledTypes },
          ...(options.recordId ? { id: options.recordId } : {})
        },
        include: { account: true, zone: true }
      });
      await this.db.ddnsRun.update({
        where: { id: run.id },
        data: { recordsTotal: records.length }
      });

      let updated = 0;
      let failed = 0;
      await mapConcurrent(records, 3, async (record) => {
        const started = Date.now();
        const address = detected.get(record.type === 'A' ? 'IPV4' : 'IPV6');
        if (!address) {
          failed += 1;
          await this.db.ddnsUpdateLog.create({
            data: {
              runId: run.id,
              recordId: record.id,
              hostname: record.hostname,
              type: record.type,
              action: 'NO_IP',
              result: 'ERROR',
              error: `No public ${record.type === 'A' ? 'IPv4' : 'IPv6'} address was detected`,
              durationMs: Date.now() - started
            }
          });
          await this.db.managedDnsRecord.update({
            where: { id: record.id },
            data: {
              health: 'ERROR',
              lastCheckedAt: new Date(),
              lastError: 'Public IP detection failed'
            }
          });
          return;
        }

        try {
          if (!record.cloudflareRecordId) throw new Error('Cloudflare record is not linked');
          const token = decryptSecret(
            {
              ciphertext: Buffer.from(record.account.tokenCiphertext),
              iv: Buffer.from(record.account.tokenIv),
              authTag: Buffer.from(record.account.tokenAuthTag),
              keyVersion: record.account.tokenKeyVersion
            },
            this.config.ENCRYPTION_KEY
          );
          const client = new CloudflareClient(
            token,
            this.fetcher,
            settings.requestTimeoutMs,
            4,
            this.config.CLOUDFLARE_API_BASE
          );
          const remote = await client.getRecord(
            record.zone.cloudflareId,
            record.cloudflareRecordId
          );
          const action = decideUpdate(
            remote.content,
            address,
            force,
            checkOnly || !settings.automaticUpdates || !record.automatic
          );
          let requestId: string | undefined;
          if (action === 'UPDATED') {
            const response = await client.patchRecord(record.zone.cloudflareId, remote.id, address);
            requestId = response.requestId;
            updated += 1;
          }
          await this.db.$transaction([
            this.db.ddnsUpdateLog.create({
              data: {
                runId: run.id,
                recordId: record.id,
                hostname: record.hostname,
                type: record.type,
                previousIp: remote.content,
                newIp: address,
                action,
                result: action === 'SKIPPED' || action === 'CHECKED' ? 'UNCHANGED' : 'SUCCESS',
                providerRequestId: requestId ?? null,
                durationMs: Date.now() - started
              }
            }),
            this.db.managedDnsRecord.update({
              where: { id: record.id },
              data: {
                content: action === 'UPDATED' ? address : remote.content,
                health: remote.content === address || action === 'UPDATED' ? 'HEALTHY' : 'DRIFTED',
                lastCheckedAt: new Date(),
                ...(action === 'UPDATED' ? { lastUpdatedAt: new Date() } : {}),
                lastError: null
              }
            })
          ]);
        } catch (error) {
          failed += 1;
          const message = error instanceof Error ? error.message : 'Record processing failed';
          const requestId = error instanceof CloudflareError ? error.requestId : undefined;
          await this.db.$transaction([
            this.db.ddnsUpdateLog.create({
              data: {
                runId: run.id,
                recordId: record.id,
                hostname: record.hostname,
                type: record.type,
                previousIp: record.content,
                newIp: address,
                action: 'FAILED',
                result: 'ERROR',
                providerRequestId: requestId ?? null,
                error: message,
                durationMs: Date.now() - started
              }
            }),
            this.db.managedDnsRecord.update({
              where: { id: record.id },
              data: { health: 'ERROR', lastCheckedAt: new Date(), lastError: message }
            })
          ]);
        }
      });

      const status =
        records.length === 0
          ? 'SKIPPED'
          : failed === 0
            ? 'SUCCESS'
            : failed === records.length
              ? 'FAILED'
              : 'PARTIAL';
      return await this.db.ddnsRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          recordsUpdated: updated,
          recordsFailed: failed,
          summary: `${updated} updated, ${failed} failed`
        },
        include: { logs: true }
      });
    } catch (error) {
      await this.db.ddnsRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          summary: error instanceof Error ? error.message : 'Run failed'
        }
      });
      throw error;
    }
  }
}
