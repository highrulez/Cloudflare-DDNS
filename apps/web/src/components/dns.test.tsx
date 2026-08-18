import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Account, RecordItem } from '../api';
import { CreateDnsRecordDialog } from './dns';

const account: Account = {
  id: 'account-1',
  name: 'Example Cloudflare',
  tokenHint: '****abcd',
  status: 'healthy',
  zones: 1,
  zoneItems: [
    {
      id: 'zone-1',
      name: 'example.com',
      cloudflareId: 'cf-zone-1',
      status: 'active',
      recordCount: 2,
      managedCount: 1
    }
  ]
};

const record: RecordItem = {
  id: 'rec-1',
  name: 'dns.example.com',
  type: 'A',
  content: '203.0.113.25',
  proxied: false,
  ttl: 1,
  enabled: true,
  status: 'healthy',
  lastCheckedAt: '2026-08-18T00:00:00.000Z',
  zoneId: 'zone-1',
  zoneName: 'example.com',
  accountId: 'account-1'
};

describe('CreateDnsRecordDialog layout', () => {
  it('keeps IP source within its column and exposes the full value on hover', () => {
    render(
      <CreateDnsRecordDialog
        open
        accounts={[account]}
        publicIp={{ ipv4: '203.0.113.25', ipv6: null, ipv4Status: 'DETECTED' }}
        onClose={vi.fn()}
        onCreate={vi.fn(async () => record)}
        onManageExisting={vi.fn(async () => record)}
        onCreated={vi.fn()}
      />
    );

    const form = screen.getByRole('button', { name: 'Create record' }).closest('form');
    expect(form?.className).toContain('minmax(0,1fr)');
    expect(form?.className).toContain('min-w-0');

    const ipSource = screen.getByLabelText('IP source');
    expect(ipSource).toHaveProperty(
      'title',
      'Detected public IPv4 (203.0.113.25)'
    );
    expect(ipSource.className).toContain('min-w-0');
    expect(ipSource.className).toContain('max-w-full');
    expect(ipSource.className).toContain('overflow-hidden');
    expect(ipSource.className).toContain('text-ellipsis');

    for (const label of ['Cloudflare account', 'Zone', 'Record type', 'TTL', 'Proxy']) {
      expect(screen.getByLabelText(label).className).toContain('min-w-0');
      expect(screen.getByLabelText(label).className).toContain('max-w-full');
    }
  });
});
