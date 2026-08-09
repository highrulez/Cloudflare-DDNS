import type { PrismaClient } from '@ddns/database';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { DdnsEngine } from '../src/ddns/engine.js';

describe('DDNS record selection safety', () => {
  it('queries only explicitly enabled managed records and skips an empty run', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const updates: Array<Record<string, unknown>> = [];
    const database = {
      ddnsRun: {
        create: async () => ({ id: 'run-1' }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { id: 'run-1', ...data, logs: [] };
        }
      },
      appSettings: {
        upsert: async () => ({
          ipv4Enabled: true,
          ipv6Enabled: false,
          ipv4Providers: ['https://ip.test'],
          ipv6Providers: [],
          requestTimeoutMs: 1000,
          automaticUpdates: true
        })
      },
      ipDetectionRun: {
        create: async () => ({ id: 'ip-run-1' }),
        update: async () => undefined
      },
      ipDetectionResult: { createMany: async () => undefined },
      managedDnsRecord: { findMany }
    } as unknown as PrismaClient;
    const config = {
      ENCRYPTION_KEY: Buffer.alloc(32),
      IPV4_PROVIDERS: ['https://ip.test'],
      IPV6_PROVIDERS: [],
      CLOUDFLARE_API_BASE: 'https://api.cloudflare.com/client/v4'
    } as unknown as Config;
    const fetcher = vi.fn().mockResolvedValue(new Response('8.8.8.8', { status: 200 }));
    const engine = new DdnsEngine(database, config, fetcher);

    const result = await engine.run({ trigger: 'SCHEDULED' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ enabled: true, type: { in: ['A'] } })
      })
    );
    expect(result.status).toBe('SKIPPED');
    expect(updates).toContainEqual(expect.objectContaining({ recordsTotal: 0 }));
    expect(updates.at(-1)).toMatchObject({ recordsUpdated: 0, recordsFailed: 0 });
  });
});
