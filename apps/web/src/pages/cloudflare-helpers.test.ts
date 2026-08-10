import { describe, expect, it } from 'vitest';
import type { Account } from '../api';
import {
  accountConnectionLabel,
  filterZonesBySearch,
  summarizeAccounts,
  visibleZoneChips,
  ZONE_CHIP_LIMIT
} from './cloudflare-helpers';

function account(partial: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    tokenHint: 'tok_…mpl1',
    status: 'healthy',
    zones: partial.zoneItems?.length ?? 0,
    zoneItems: [],
    ...partial
  };
}

describe('Cloudflare account helpers', () => {
  it('summarizes a single healthy account', () => {
    const accounts = [
      account({
        id: 'a1',
        name: 'Example Cloudflare',
        zoneItems: [
          {
            id: 'z1',
            name: 'example.com',
            cloudflareId: 'cf1',
            status: 'active',
            recordCount: 4,
            managedCount: 2
          },
          {
            id: 'z2',
            name: 'example.net',
            cloudflareId: 'cf2',
            status: 'active',
            recordCount: 1,
            managedCount: 0
          }
        ]
      })
    ];
    const summary = summarizeAccounts(accounts);
    expect(summary.connected).toBe(1);
    expect(summary.zones).toBe(2);
    expect(summary.summary).toContain('1 connected account');
    expect(summary.summary).toContain('2 accessible zones');
    expect(summary.summary).toContain('API operational');
  });

  it('summarizes multiple accounts and connection issues', () => {
    const accounts = [
      account({
        id: 'a1',
        name: 'Example Cloudflare',
        zoneItems: [
          {
            id: 'z1',
            name: 'example.com',
            cloudflareId: 'cf1',
            status: 'active',
            recordCount: 1,
            managedCount: 1
          }
        ]
      }),
      account({
        id: 'a2',
        name: 'Business Cloudflare',
        status: 'error',
        zoneItems: [
          {
            id: 'z2',
            name: 'example.org',
            cloudflareId: 'cf2',
            status: 'active',
            recordCount: 3,
            managedCount: 0
          },
          {
            id: 'z3',
            name: 'example.net',
            cloudflareId: 'cf3',
            status: 'active',
            recordCount: 2,
            managedCount: 1
          }
        ]
      })
    ];
    const summary = summarizeAccounts(accounts);
    expect(summary.connected).toBe(2);
    expect(summary.zones).toBe(3);
    expect(summary.summary).toContain('2 connected accounts');
    expect(summary.summary).toContain('Connection issues detected');
  });

  it('limits zone chips and reports remaining overflow', () => {
    const zones = Array.from({ length: ZONE_CHIP_LIMIT + 3 }, (_, index) => ({
      id: `z${index}`,
      name: `zone${index}.example.com`,
      cloudflareId: `cf${index}`,
      status: 'active',
      recordCount: 1,
      managedCount: 0
    }));
    const item = account({ id: 'a1', name: 'Example Cloudflare', zoneItems: zones });
    const collapsed = visibleZoneChips(item, false);
    expect(collapsed.zones).toHaveLength(ZONE_CHIP_LIMIT);
    expect(collapsed.remaining).toBe(3);
    const expanded = visibleZoneChips(item, true);
    expect(expanded.zones).toHaveLength(zones.length);
    expect(expanded.remaining).toBe(0);
  });

  it('maps existing status labels without inventing backend states', () => {
    expect(accountConnectionLabel('healthy')).toBe('Healthy');
    expect(accountConnectionLabel('error')).toBe('Error');
    expect(accountConnectionLabel('degraded')).toBe('Degraded');
  });

  it('filters zones by search and supports empty results', () => {
    const zones = [
      {
        id: 'z1',
        name: 'example.com',
        cloudflareId: 'cf1',
        status: 'active',
        recordCount: 1,
        managedCount: 0
      },
      {
        id: 'z2',
        name: 'example.net',
        cloudflareId: 'cf2',
        status: 'active',
        recordCount: 1,
        managedCount: 0
      }
    ];
    expect(filterZonesBySearch(zones, 'NET').map((zone) => zone.name)).toEqual(['example.net']);
    expect(filterZonesBySearch(zones, 'missing.example')).toEqual([]);
  });

  it('keeps token hints masked-style in account fixtures', () => {
    const item = account({ id: 'a1', name: 'Example Cloudflare', tokenHint: 'abcd…wxyz' });
    expect(item.tokenHint).not.toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(item.tokenHint.includes('…') || item.tokenHint.includes('...')).toBe(true);
  });
});
