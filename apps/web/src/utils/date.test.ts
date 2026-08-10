import { describe, expect, it } from 'vitest';
import {
  safeFormatDate,
  safeOperationalTimestamp,
  safeRelativeTime,
  type DateValue
} from './date';

describe('safe date formatting', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['unknown placeholder', 'unknown'],
    ['malformed date', 'not-a-real-date']
  ] satisfies Array<[string, DateValue]>)('returns an em dash for %s', (_label, value) => {
    expect(safeFormatDate(value)).toBe('—');
    expect(safeRelativeTime(value)).toBe('—');
    expect(safeOperationalTimestamp(value)).toBeNull();
  });

  it('formats a valid ISO timestamp', () => {
    const timestamp = '2026-08-09T12:00:00.000Z';
    expect(safeFormatDate(timestamp)).not.toBe('—');
    expect(safeRelativeTime(timestamp, Date.parse('2026-08-09T12:02:00.000Z'))).toBe(
      '2 minutes ago'
    );
    const operational = safeOperationalTimestamp(
      timestamp,
      Date.parse('2026-08-09T12:02:00.000Z')
    );
    expect(operational).not.toBeNull();
    expect(operational?.relative).toBe('2 minutes ago');
    expect(operational?.absolute).toContain('2026');
  });
});
