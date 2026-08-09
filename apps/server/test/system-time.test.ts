import { describe, expect, it } from 'vitest';
import { normalizeSystemTimestamp } from '../src/routes/system.js';

describe('System API timestamp normalization', () => {
  it.each([null, undefined, '', 'unknown', 'not-a-real-date'])(
    'normalizes unavailable timestamp %s to null',
    (value) => {
      expect(normalizeSystemTimestamp(value)).toBeNull();
    }
  );

  it('returns a valid ISO timestamp', () => {
    expect(normalizeSystemTimestamp('2026-08-09T12:00:00Z')).toBe('2026-08-09T12:00:00.000Z');
  });
});
