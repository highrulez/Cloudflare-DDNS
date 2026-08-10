import { describe, expect, it } from 'vitest';
import type { HistoryItem } from '../api';
import {
  addressChanged,
  applyClientHistoryFilters,
  changePresentation,
  formatHistoryIp,
  pageRange,
  resultLabel,
  sanitizeHistoryMessage,
  summarizePage,
  triggerLabel
} from './history-helpers';

function item(partial: Partial<HistoryItem> & Pick<HistoryItem, 'id'>): HistoryItem {
  return {
    action: 'check',
    status: 'success',
    createdAt: '2026-08-10T10:18:00.000Z',
    ...partial
  };
}

describe('Update History helpers', () => {
  it('presents updated A record changes', () => {
    const event = item({
      id: '1',
      recordName: 'dns.example.com',
      recordType: 'A',
      action: 'update',
      status: 'success',
      oldValue: '203.0.113.10',
      newValue: '203.0.113.25',
      trigger: 'SCHEDULED'
    });
    expect(resultLabel(event)).toBe('Updated');
    expect(addressChanged(event)).toBe(true);
    expect(changePresentation(event)).toEqual({
      kind: 'changed',
      previous: '203.0.113.10',
      next: '203.0.113.25'
    });
    expect(triggerLabel(event.trigger)).toBe('Automatic');
  });

  it('presents unchanged/skipped events without implying a change', () => {
    const event = item({
      id: '2',
      recordName: 'dns.example.com',
      recordType: 'A',
      status: 'skipped',
      oldValue: '203.0.113.25',
      newValue: '203.0.113.25',
      trigger: 'MANUAL_CHECK'
    });
    expect(resultLabel(event)).toBe('No change');
    expect(changePresentation(event)).toEqual({
      kind: 'unchanged',
      current: '203.0.113.25'
    });
    expect(triggerLabel(event.trigger)).toBe('Check Now');
  });

  it('presents failed events with sanitized messages', () => {
    const event = item({
      id: '3',
      status: 'failed',
      action: 'configuration',
      message: 'Cloudflare update failed',
      recordType: 'AAAA',
      oldValue: '2001:db8::10',
      trigger: 'FORCE'
    });
    expect(resultLabel(event)).toBe('Failed');
    expect(sanitizeHistoryMessage(event.message!)).toBe('Cloudflare update failed');
    expect(sanitizeHistoryMessage('Authorization bearer token rejected')).toBe(
      'Cloudflare request failed'
    );
    expect(triggerLabel(event.trigger)).toBe('Force Update');
  });

  it('truncates long IPv6 for table display while keeping the full value', () => {
    const full = '2001:db8:1234:5678:20c:29ff:fe5a:9840';
    const formatted = formatHistoryIp(full);
    expect(formatted.full).toBe(full);
    expect(formatted.display.length).toBeLessThan(full.length);
    expect(formatted.display).toContain('…');
  });

  it('filters by type and source on the current page', () => {
    const items = [
      item({
        id: 'a',
        recordType: 'A',
        trigger: 'SCHEDULED',
        status: 'skipped'
      }),
      item({
        id: 'b',
        recordType: 'AAAA',
        trigger: 'FORCE',
        action: 'update',
        status: 'success',
        oldValue: '2001:db8::1',
        newValue: '2001:db8::2'
      })
    ];
    expect(applyClientHistoryFilters(items, { type: 'AAAA', source: '' }).map((row) => row.id)).toEqual([
      'b'
    ]);
    expect(
      applyClientHistoryFilters(items, { type: '', source: 'SCHEDULED' }).map((row) => row.id)
    ).toEqual(['a']);
  });

  it('summarizes the current page without inventing lifetime totals', () => {
    expect(
      summarizePage([
        item({ id: '1', action: 'update', status: 'success' }),
        item({ id: '2', status: 'skipped' }),
        item({ id: '3', status: 'failed' })
      ])
    ).toEqual({ total: 3, updated: 1, unchanged: 1, failed: 1 });
  });

  it('computes pagination ranges safely', () => {
    expect(pageRange(1, 25, 0)).toEqual({ start: 0, end: 0 });
    expect(pageRange(2, 25, 48)).toEqual({ start: 26, end: 48 });
  });
});
