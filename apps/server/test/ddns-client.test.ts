import { describe, expect, it, vi } from 'vitest';
import { CloudflareClient } from '../src/cloudflare/client.js';
import { decideUpdate } from '../src/ddns/engine.js';

describe('DDNS decisions', () => {
  it('skips unchanged records and updates drift', () => {
    expect(decideUpdate('1.1.1.1', '1.1.1.1', false, false)).toBe('SKIPPED');
    expect(decideUpdate('1.1.1.1', '8.8.8.8', false, false)).toBe('UPDATED');
  });

  it('honors check-only and force modes', () => {
    expect(decideUpdate('1.1.1.1', '8.8.8.8', true, true)).toBe('CHECKED');
    expect(decideUpdate('1.1.1.1', '1.1.1.1', true, false)).toBe('UPDATED');
  });
});

describe('Cloudflare client', () => {
  it('uses bearer auth and patches content only', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: {
            id: 'record',
            type: 'A',
            name: 'home.example.com',
            content: '8.8.8.8',
            proxied: false,
            ttl: 1
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'cf-ray': 'request-id' } }
      )
    );
    const client = new CloudflareClient('secret', fetcher, 1000, 1);
    const result = await client.patchRecord('zone', 'record', '8.8.8.8');
    expect(result.requestId).toBe('request-id');
    const [, init] = fetcher.mock.calls[0]!;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual({ content: '8.8.8.8' });
  });
});
