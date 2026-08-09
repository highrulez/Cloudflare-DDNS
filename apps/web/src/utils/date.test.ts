import { describe, expect, it } from 'vitest';
import { safeFormatDate, safeRelativeTime, type DateValue } from './date';

describe('safe date formatting', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['unknown placeholder', 'unknown'],
    ['malformed date', 'not-a-real-date']
  ] satisfies Array<[string, DateValue]>)('returns Unavailable for %s', (_label, value) => {
    expect(safeFormatDate(value)).toBe('Unavailable');
    expect(safeRelativeTime(value)).toBe('Unavailable');
  });

  it('formats a valid ISO timestamp', () => {
    const timestamp = '2026-08-09T12:00:00.000Z';
    expect(safeFormatDate(timestamp)).not.toBe('Unavailable');
    expect(safeRelativeTime(timestamp, Date.parse('2026-08-09T12:02:00.000Z'))).toBe(
      '2 minutes ago'
    );
  });
});
