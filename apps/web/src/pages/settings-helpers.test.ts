import { describe, expect, it } from 'vitest';
import {
  accountSecurityStatus,
  assertNoSensitiveSettingsKeys,
  formatRecoverySummary,
  mfaBadge
} from './settings-helpers';

describe('Settings helpers', () => {
  it('derives account security status from MFA state', () => {
    expect(accountSecurityStatus(true)).toEqual({
      tone: 'active',
      label: 'Account protected'
    });
    expect(accountSecurityStatus(false)).toEqual({
      tone: 'attention',
      label: 'Additional protection recommended'
    });
    expect(accountSecurityStatus(null).tone).toBe('neutral');
  });

  it('maps MFA badge states without inventing enabled', () => {
    expect(mfaBadge(true)).toEqual({ status: 'enabled', label: 'Enabled' });
    expect(mfaBadge(false)).toEqual({ status: 'warning', label: 'Disabled' });
    expect(mfaBadge(null).label).toBe('Not available');
  });

  it('formats recovery summaries from safe backend counts', () => {
    expect(formatRecoverySummary(null)).toBe('Not configured');
    expect(
      formatRecoverySummary({
        enabled: true,
        enabledAt: '2026-08-10T00:00:00.000Z',
        recoveryCodesRemaining: 8,
        recoveryCodesTotal: 10
      })
    ).toBe('8 of 10 remaining');
  });

  it('rejects secret-looking keys in settings snapshots', () => {
    expect(
      assertNoSensitiveSettingsKeys({
        enabled: true,
        recoveryCodesRemaining: 8
      })
    ).toEqual([]);
    expect(
      assertNoSensitiveSettingsKeys({
        passwordHash: 'x',
        setupKey: 'ABCD',
        SESSION_SECRET: 'y'
      })
    ).toEqual(['passwordHash', 'setupKey', 'SESSION_SECRET']);
  });
});
