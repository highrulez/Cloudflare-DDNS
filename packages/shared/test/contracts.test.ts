import { describe, expect, it } from 'vitest';
import { createDnsRecordSchema, recordInputSchema, settingsSchema } from '../src/index.js';

describe('shared API contracts', () => {
  it('normalizes safe record defaults', () => {
    const value = recordInputSchema.parse({
      accountId: 'account',
      zoneId: 'zone',
      type: 'A',
      hostname: 'Home.Example.com'
    });
    expect(value).toMatchObject({ ttl: 1, proxied: false, enabled: true, automatic: true });
  });

  it('requires at least one address family', () => {
    const result = settingsSchema.safeParse({
      intervalMinutes: 5,
      ipv4Enabled: false,
      ipv6Enabled: false,
      automaticUpdates: true,
      providerPolicy: 'ordered',
      requestTimeoutMs: 5000,
      retentionDays: 90,
      timezone: 'Asia/Kuala_Lumpur'
    });
    expect(result.success).toBe(false);
  });

  it('enforces matching detected address sources and custom IP input', () => {
    const base = {
      accountId: 'account',
      zoneId: 'zone',
      hostname: 'nas',
      type: 'A' as const,
      proxied: false,
      ttl: 1,
      ddnsEnabled: true
    };
    expect(createDnsRecordSchema.safeParse({ ...base, ipSource: 'DETECTED_IPV4' }).success).toBe(
      true
    );
    expect(createDnsRecordSchema.safeParse({ ...base, ipSource: 'DETECTED_IPV6' }).success).toBe(
      false
    );
    expect(createDnsRecordSchema.safeParse({ ...base, ipSource: 'CUSTOM' }).success).toBe(false);
  });
});
