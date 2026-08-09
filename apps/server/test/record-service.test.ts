import { describe, expect, it } from 'vitest';
import { discoveryStatus, normalizeHostname, RequestError } from '../src/records/service.js';

describe('multi-zone DNS record lifecycle', () => {
  it('normalizes relative and apex hostnames inside the selected zone', () => {
    expect(normalizeHostname('nas', 'blnco.my')).toBe('nas.blnco.my');
    expect(normalizeHostname('@', 'blnco.my')).toBe('blnco.my');
    expect(normalizeHostname('vpn.blnco.my.', 'blnco.my')).toBe('vpn.blnco.my');
  });

  it('rejects hostnames outside the selected zone', () => {
    expect(() => normalizeHostname('nas.example.com', 'blnco.my')).toThrow(RequestError);
  });

  it('compares discovered records with the matching detected address family', () => {
    const base = { id: 'record', name: 'nas.blnco.my', proxied: false, ttl: 1 };
    expect(
      discoveryStatus({ ...base, type: 'A', content: '203.0.113.10' }, undefined, {
        ipv4: '203.0.113.11',
        ipv6: '2001:db8::1'
      }).syncStatus
    ).toBe('NEEDS_UPDATE');
    expect(
      discoveryStatus({ ...base, type: 'AAAA', content: '2001:db8::1' }, undefined, {
        ipv4: '203.0.113.11',
        ipv6: '2001:db8::1'
      }).syncStatus
    ).toBe('SYNCHRONIZED');
  });
});
