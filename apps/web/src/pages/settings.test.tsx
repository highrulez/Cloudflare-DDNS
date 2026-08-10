import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { StrongAuthProvider } from '../components/strong-auth';
import { assertNoSensitiveSettingsKeys } from './settings-helpers';

const mfaStatusMock = vi.fn();
const listSessionsMock = vi.fn();
const turnstileConfigMock = vi.fn();
const settingsMock = vi.fn();
const changePasswordMock = vi.fn();
const mfaEnrollStartMock = vi.fn();
const mfaEnrollConfirmMock = vi.fn();
const mfaDisableMock = vi.fn();
const mfaRegenerateMock = vi.fn();
const revokeOthersMock = vi.fn();
const updateProfileMock = vi.fn();
const updateSettingsMock = vi.fn();
const reauthMock = vi.fn();

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string
    ) {
      super(message);
    }
  },
  api: {
    mfaStatus: (...args: unknown[]) => mfaStatusMock(...args) as Promise<unknown>,
    listSessions: (...args: unknown[]) => listSessionsMock(...args) as Promise<unknown>,
    turnstileConfig: (...args: unknown[]) => turnstileConfigMock(...args) as Promise<unknown>,
    settings: (...args: unknown[]) => settingsMock(...args) as Promise<unknown>,
    changePassword: (...args: unknown[]) => changePasswordMock(...args) as Promise<unknown>,
    mfaEnrollStart: (...args: unknown[]) => mfaEnrollStartMock(...args) as Promise<unknown>,
    mfaEnrollConfirm: (...args: unknown[]) => mfaEnrollConfirmMock(...args) as Promise<unknown>,
    mfaDisable: (...args: unknown[]) => mfaDisableMock(...args) as Promise<unknown>,
    mfaRegenerateRecovery: (...args: unknown[]) => mfaRegenerateMock(...args) as Promise<unknown>,
    revokeOtherSessions: (...args: unknown[]) => revokeOthersMock(...args) as Promise<unknown>,
    updateProfile: (...args: unknown[]) => updateProfileMock(...args) as Promise<unknown>,
    updateSettings: (...args: unknown[]) => updateSettingsMock(...args) as Promise<unknown>,
    reauth: (...args: unknown[]) => reauthMock(...args) as Promise<unknown>
  }
}));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'admin' },
    setUser: vi.fn()
  })
}));

import { SettingsPage } from './settings';

function renderSettings() {
  return render(
    <ToastProvider>
      <StrongAuthProvider>
        <SettingsPage />
      </StrongAuthProvider>
    </ToastProvider>
  );
}

describe('Settings page', () => {
  beforeEach(() => {
    mfaStatusMock.mockReset();
    listSessionsMock.mockReset();
    turnstileConfigMock.mockReset();
    settingsMock.mockReset();
    changePasswordMock.mockReset();
    mfaEnrollStartMock.mockReset();
    mfaEnrollConfirmMock.mockReset();
    mfaDisableMock.mockReset();
    mfaRegenerateMock.mockReset();
    revokeOthersMock.mockReset();
    updateProfileMock.mockReset();
    updateSettingsMock.mockReset();
    reauthMock.mockReset();

    mfaStatusMock.mockResolvedValue({
      enabled: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
      recoveryCodesTotal: 0
    });
    listSessionsMock.mockResolvedValue({
      items: [
        {
          current: true,
          createdAt: '2026-08-10T15:22:00.000Z',
          lastSeenAt: '2026-08-10T15:22:00.000Z',
          expiresAt: '2026-08-11T15:22:00.000Z',
          stronglyAuthenticated: true
        },
        {
          current: false,
          createdAt: '2026-08-10T12:31:00.000Z',
          lastSeenAt: '2026-08-10T12:31:00.000Z',
          expiresAt: '2026-08-11T12:31:00.000Z',
          stronglyAuthenticated: false
        }
      ]
    });
    turnstileConfigMock.mockResolvedValue({
      siteKey: 'site-key-example',
      expectedHostname: 'dns.example.com',
      expectedAction: 'login',
      appOrigin: 'https://dns.example.com'
    });
    settingsMock.mockResolvedValue({
      intervalMinutes: 30,
      ipv4Enabled: true,
      ipv6Enabled: false,
      automaticUpdates: true,
      requestTimeoutMs: 5000,
      retentionDays: 90,
      timezone: 'Asia/Kuala_Lumpur'
    });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Settings with Security as the default section', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { name: 'Settings' })).not.toBeNull();
    expect(screen.getByText('Security overview')).not.toBeNull();
    expect(screen.getAllByText('Multi-factor authentication').length).toBeGreaterThan(0);
    expect(screen.getByText('Additional protection recommended')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Set up MFA' })).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Settings sections' }).querySelector('[aria-current="page"]')?.textContent).toBe('Security');
  });

  it('shows MFA enabled state from backend status', async () => {
    mfaStatusMock.mockResolvedValue({
      enabled: true,
      enabledAt: '2026-08-01T10:00:00.000Z',
      recoveryCodesRemaining: 8,
      recoveryCodesTotal: 10
    });
    renderSettings();
    expect(await screen.findByText('Account protected')).not.toBeNull();
    expect(screen.getByText('8 of 10 remaining')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerate recovery codes' })).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /Disable MFA|Disable multi-factor/ }).length).toBeGreaterThan(0);
  });

  it('opens MFA enrollment modal and supports setup-key reveal plus TOTP verify', async () => {
    mfaEnrollStartMock.mockResolvedValue({
      otpauthUrl: 'otpauth://totp/Example',
      qrDataUrl: 'data:image/png;base64,AAAA',
      setupKey: 'ABCD EFGH IJKL',
      expiresAt: '2026-08-10T16:00:00.000Z'
    });
    mfaEnrollConfirmMock.mockResolvedValue({
      enabled: true,
      recoveryCodes: Array.from({ length: 10 }, (_, index) => `CODE-${index + 1}`)
    });
    mfaStatusMock
      .mockResolvedValueOnce({
        enabled: false,
        enabledAt: null,
        recoveryCodesRemaining: 0,
        recoveryCodesTotal: 0
      })
      .mockResolvedValue({
        enabled: true,
        enabledAt: '2026-08-10T15:30:00.000Z',
        recoveryCodesRemaining: 10,
        recoveryCodesTotal: 10
      });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up MFA' }));
    expect(await screen.findByRole('dialog', { name: 'Set Up MFA' })).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct horse battery staple' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByAltText('Authenticator QR code')).not.toBeNull();
    expect(screen.queryByText('ABCD EFGH IJKL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show setup key/i }));
    expect(screen.getByText('ABCD EFGH IJKL')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('Authenticator code'), {
      target: { value: '123456' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('dialog', { name: 'Recovery Codes' })).not.toBeNull();
    expect(screen.getByText('CODE-1')).not.toBeNull();
    expect(screen.getByText('These codes will not be shown again.')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it('opens password modal and surfaces validation errors', async () => {
    renderSettings();
    await screen.findByText('Security overview');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change Password' });
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'old-password-12' }
    });
    fireEvent.change(within(dialog).getByLabelText('New password'), {
      target: { value: 'new-password-12' }
    });
    fireEvent.change(within(dialog).getByLabelText('Confirm new password'), {
      target: { value: 'mismatch-password' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords do not match.')).not.toBeNull();
  });

  it('requires authenticator code on password change when MFA is enabled', async () => {
    mfaStatusMock.mockResolvedValue({
      enabled: true,
      enabledAt: '2026-08-01T10:00:00.000Z',
      recoveryCodesRemaining: 8,
      recoveryCodesTotal: 10
    });
    changePasswordMock.mockResolvedValue(undefined);
    renderSettings();
    await screen.findByText('Account protected');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change Password' });
    expect(within(dialog).getByLabelText('Authenticator code')).not.toBeNull();
  });

  it('lists sessions and identifies the current device', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(await screen.findByText('Current session')).not.toBeNull();
    expect(screen.getByText('This device')).not.toBeNull();
    expect(screen.getByText('Other session')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out other sessions' })).not.toBeNull();
  });

  it('signs out other sessions through strong-auth when required', async () => {
    const { ApiError } = await import('../api');
    revokeOthersMock
      .mockRejectedValueOnce(new ApiError('Need verification', 403, 'STRONG_AUTH_REQUIRED'))
      .mockResolvedValueOnce({ revoked: 1 });
    reauthMock.mockResolvedValue({
      stronglyAuthenticatedUntil: '2026-08-10T16:00:00.000Z',
      recentlyStronglyAuthenticated: true
    });
    mfaStatusMock.mockResolvedValue({
      enabled: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
      recoveryCodesTotal: 0
    });

    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out other sessions' }));

    expect(await screen.findByRole('dialog', { name: 'Security Verification' })).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct horse battery staple' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(reauthMock).toHaveBeenCalled();
      expect(revokeOthersMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Other sessions signed out.')).not.toBeNull();
  });

  it('renders Profile and Preferences sections', async () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByDisplayValue('admin')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(await screen.findByDisplayValue('Asia/Kuala_Lumpur')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Dark' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Light' })).not.toBeNull();
  });

  it('handles null/invalid session timestamps safely', async () => {
    listSessionsMock.mockResolvedValue({
      items: [
        {
          current: true,
          createdAt: null,
          lastSeenAt: 'not-a-date',
          expiresAt: '2026-08-11T00:00:00.000Z',
          stronglyAuthenticated: false
        }
      ]
    });
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    await screen.findByText('Current session');
    expect(screen.queryByText(/RangeError/)).toBeNull();
    expect(screen.getAllByText(/—|Signed in|Last activity/).length).toBeGreaterThan(0);
  });

  it('keeps Settings usable when sessions fail to load', async () => {
    listSessionsMock.mockRejectedValue(new Error('Unable to load active sessions.'));
    renderSettings();
    expect(await screen.findByText('Security overview')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(await screen.findByText('Unable to load active sessions.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
  });

  it('does not render secret values in the security overview', async () => {
    const payload = {
      enabled: true,
      recoveryCodesRemaining: 8,
      recoveryCodesTotal: 10
    };
    expect(assertNoSensitiveSettingsKeys(payload)).toEqual([]);
    renderSettings();
    await screen.findByText('Security overview');
    expect(screen.queryByText(/SESSION_SECRET/i)).toBeNull();
    expect(screen.queryByText(/passwordHash/i)).toBeNull();
    expect(screen.queryByText(/ENCRYPTION_KEY/i)).toBeNull();
  });

  it('supports Escape to close safe dialogs', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Change Password' }));
    expect(await screen.findByRole('dialog', { name: 'Change Password' })).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Change Password' })).toBeNull();
    });
  });
});
