export type SecurityTone = 'active' | 'attention' | 'neutral';

export type MfaStatusSnapshot = {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  recoveryCodesTotal: number;
};

export function accountSecurityStatus(mfaEnabled: boolean | null): {
  tone: SecurityTone;
  label: string;
} {
  if (mfaEnabled === true) return { tone: 'active', label: 'Account protected' };
  if (mfaEnabled === false)
    return { tone: 'attention', label: 'Additional protection recommended' };
  return { tone: 'neutral', label: 'Security status unavailable' };
}

export function mfaBadge(enabled: boolean | null): { status: string; label: string } {
  if (enabled === true) return { status: 'enabled', label: 'Enabled' };
  if (enabled === false) return { status: 'warning', label: 'Disabled' };
  return { status: 'disabled', label: 'Not available' };
}

export function formatRecoverySummary(status: MfaStatusSnapshot | null): string {
  if (!status?.enabled) return 'Not configured';
  if (status.recoveryCodesTotal > 0) {
    return `${status.recoveryCodesRemaining} of ${status.recoveryCodesTotal} remaining`;
  }
  return `${status.recoveryCodesRemaining} remaining`;
}

export function assertNoSensitiveSettingsKeys(payload: unknown): string[] {
  const sensitive =
    /^(authorization|password|passwordHash|secret|token|ciphertext|cipher|iv|authtag|database_url|encryption_key|session_secret|turnstile_secret|totp(_?secret)?|setupKey|recovery_?codes?|otpauth)$/i;
  const found: string[] = [];
  const walk = (value: unknown, path = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${key}` : key;
      if (sensitive.test(key)) found.push(next);
      walk(nested, next);
    }
  };
  walk(payload);
  return found;
}
