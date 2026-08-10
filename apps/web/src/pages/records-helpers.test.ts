import { describe, expect, it } from 'vitest';
import type { RecordItem } from '../api';
import { filterAndSortRecords, summarizeRecords, truncateIp } from './records-helpers';

function record(partial: Partial<RecordItem> & Pick<RecordItem, 'id' | 'name'>): RecordItem {
  return {
    accountId: 'account-1',
    accountName: 'Main Cloudflare',
    zoneId: 'zone-1',
    zoneName: 'example.com',
    type: 'A',
    content: '203.0.113.10',
    ttl: 1,
    proxied: false,
    enabled: true,
    status: 'healthy',
    ...partial
  };
}

const sample: RecordItem[] = [
  record({
    id: '1',
    name: 'nas.example.com',
    type: 'A',
    proxied: true,
    enabled: true,
    content: '203.0.113.10'
  }),
  record({
    id: '2',
    name: 'vpn.example.com',
    type: 'AAAA',
    accountId: 'account-2',
    accountName: 'Secondary',
    zoneId: 'zone-2',
    zoneName: 'other.example.com',
    proxied: false,
    enabled: false,
    status: 'disabled',
    content: '2001:db8:1234:5678:20c:29ff:fe5a:9840'
  }),
  record({
    id: '3',
    name: 'dns.example.com',
    type: 'A',
    proxied: false,
    enabled: true,
    status: 'degraded',
    content: '198.51.100.10'
  })
];

const emptyFilters = {
  accountFilter: '',
  zoneFilter: '',
  typeFilter: '',
  ddnsFilter: '',
  statusFilter: '',
  proxyFilter: '',
  proxySort: '',
  search: ''
};

describe('DNS Records helpers', () => {
  it('summarizes managed/proxy/type counts from existing records', () => {
    expect(summarizeRecords(sample)).toEqual({
      managed: 3,
      a: 2,
      aaaa: 1,
      proxied: 1,
      dnsOnly: 2
    });
  });

  it('filters by account, zone, type, proxy, DDNS, status, and search', () => {
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, accountFilter: 'account-2' }).map((r) => r.id)
    ).toEqual(['2']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, zoneFilter: 'zone-1' }).map((r) => r.id)
    ).toEqual(['1', '3']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, typeFilter: 'AAAA' }).map((r) => r.id)
    ).toEqual(['2']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, proxyFilter: 'proxied' }).map((r) => r.id)
    ).toEqual(['1']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, proxyFilter: 'dns-only' }).map((r) => r.id)
    ).toEqual(['2', '3']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, ddnsFilter: 'off' }).map((r) => r.id)
    ).toEqual(['2']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, statusFilter: 'degraded' }).map((r) => r.id)
    ).toEqual(['3']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, search: '198.51.100' }).map((r) => r.id)
    ).toEqual(['3']);
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, search: 'vpn' }).map((r) => r.id)
    ).toEqual(['2']);
  });

  it('sorts by proxy state when requested', () => {
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, proxySort: 'proxied-first' }).map((r) => r.id)
    ).toEqual(['1', '2', '3']);
    expect(
      filterAndSortRecords(sample, {
        ...emptyFilters,
        proxySort: 'dns-only-first'
      }).map((r) => r.id)
    ).toEqual(['2', '3', '1']);
  });

  it('truncates long IPv6 for table display while keeping the full value available separately', () => {
    const full = '2001:db8:1234:5678:20c:29ff:fe5a:9840';
    const truncated = truncateIp(full);
    expect(truncated.length).toBeLessThan(full.length);
    expect(truncated).toContain('…');
    expect(truncated.startsWith('2001:db8')).toBe(true);
    expect(truncateIp('203.0.113.10')).toBe('203.0.113.10');
  });

  it('returns an empty list for no matching filters', () => {
    expect(
      filterAndSortRecords(sample, { ...emptyFilters, search: 'does-not-exist.example.com' })
    ).toEqual([]);
  });

  it('renders multi-account and multi-zone metadata fields on sample records', () => {
    const secondary = sample.find((item) => item.id === '2')!;
    expect(secondary.accountName).toBe('Secondary');
    expect(secondary.zoneName).toBe('other.example.com');
    expect(secondary.name).toBe('vpn.example.com');
  });
});
