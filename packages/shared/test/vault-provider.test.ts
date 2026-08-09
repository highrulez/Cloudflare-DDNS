import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareAdapter,
  decryptCredential,
  encryptCredential,
  loadWorkerConfig
} from '../src/index.js';

describe('credential vault', () => {
  const key = Buffer.alloc(32, 7);

  it('round trips credentials without persisting plaintext', () => {
    const encrypted = encryptCredential({ apiToken: 'top-secret-1234' }, key, 'connection-1');
    expect(encrypted.ciphertext).not.toContain('top-secret');
    expect(encrypted.maskedHint).toBe('••••1234');
    expect(decryptCredential(encrypted, key, 'connection-1')).toEqual({
      apiToken: 'top-secret-1234'
    });
  });

  it('binds ciphertext to its connection through AAD', () => {
    const encrypted = encryptCredential({ apiToken: 'top-secret-1234' }, key, 'connection-1');
    expect(() => decryptCredential(encrypted, key, 'connection-2')).toThrow();
  });
});

describe('worker configuration', () => {
  it('does not require administrator credentials', () => {
    const config = loadWorkerConfig({
      DATABASE_URL: 'mysql://infrahub_app:password@192.168.68.100:3306/infrahub',
      REDIS_URL: 'redis://:password@redis:6379',
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64')
    });
    expect(config.DATABASE_URL).toContain('/infrahub');
    expect(config.APP_ENCRYPTION_KEY).toHaveLength(32);
  });

  it('accepts authenticated Redis URLs and rejects non-Redis protocols', () => {
    const env = {
      DATABASE_URL: 'mysql://infrahub_app:password@192.168.68.100:3306/infrahub',
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64')
    };
    expect(
      loadWorkerConfig({
        ...env,
        REDIS_URL: 'rediss://user:password@redis.example.com:6380'
      }).REDIS_URL
    ).toBe('rediss://user:password@redis.example.com:6380');
    expect(() => loadWorkerConfig({ ...env, REDIS_URL: 'https://redis.example.com' })).toThrow();
  });
});

describe('Cloudflare provider mapping', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps accounts, zones, and records to provider-neutral data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const result = url.includes('/user/tokens/verify')
          ? { id: 'token', status: 'active' }
          : url.includes('/accounts')
            ? [{ id: 'account-1', name: 'Account' }]
            : url.includes('/dns_records')
              ? [
                  {
                    id: 'record-1',
                    type: 'A',
                    name: 'www.example.com',
                    content: '192.0.2.1',
                    ttl: 120,
                    proxied: false
                  }
                ]
              : [
                  {
                    id: 'zone-1',
                    account: { id: 'account-1', name: 'Account' },
                    name: 'example.com',
                    status: 'active',
                    name_servers: ['ns1.example']
                  }
                ];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              result,
              result_info: { page: 1, total_pages: 1 }
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      })
    );

    const result = await new CloudflareAdapter('https://example.test').discover({
      apiToken: 'token'
    });
    expect(result.accounts).toEqual([
      { externalId: 'account-1', name: 'Account', isSynthetic: false }
    ]);
    expect(result.zones[0]).toMatchObject({ externalId: 'zone-1', accountExternalId: 'account-1' });
    expect(result.records[0]).toMatchObject({
      externalId: 'record-1',
      zoneExternalId: 'zone-1',
      type: 'A'
    });
  });
});
