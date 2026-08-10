import type { DetectionStatus, SystemOverview } from '../api';

export type ServiceTone = 'operational' | 'warning' | 'error' | 'unknown' | 'secure';

export function formatGitCommit(commit: string | null | undefined): string {
  const value = commit?.trim() ?? '';
  if (!value || value.toLowerCase() === 'unknown') return 'Not available';
  return value.slice(0, 7);
}

export function isGitCommitAvailable(commit: string | null | undefined): boolean {
  return formatGitCommit(commit) !== 'Not available';
}

export function detectionTone(status: DetectionStatus | null | undefined): ServiceTone {
  if (status === 'DETECTED') return 'operational';
  if (status === 'DISABLED') return 'unknown';
  if (!status) return 'unknown';
  return 'warning';
}

export function detectionLabel(status: DetectionStatus | null | undefined): string {
  if (status === 'DETECTED') return 'Detected';
  if (status === 'DISABLED') return 'Disabled';
  if (status === 'NETWORK_UNAVAILABLE') return 'Unavailable';
  if (status === 'PROVIDER_FAILED') return 'Provider failed';
  if (status === 'NO_GLOBAL_ADDRESS') return 'No address';
  return 'Unknown';
}

export function healthTone(status: string): ServiceTone {
  if (status === 'healthy' || status === 'running') return 'operational';
  if (status === 'warning' || status === 'degraded' || status === 'updating') return 'warning';
  if (status === 'error' || status === 'failed' || status === 'stopped') return 'error';
  return 'unknown';
}

export function healthLabel(tone: ServiceTone): string {
  if (tone === 'operational') return 'Operational';
  if (tone === 'secure') return 'Secure';
  if (tone === 'warning') return 'Attention';
  if (tone === 'error') return 'Failed';
  return 'Unknown';
}

export function overallSystemStatus(data: SystemOverview): {
  tone: ServiceTone;
  label: string;
} {
  const issues: ServiceTone[] = [];
  issues.push(healthTone(data.cloudflare.status));
  issues.push(healthTone(data.database.status));
  issues.push(healthTone(data.ddns.scheduler));
  issues.push(detectionTone(data.network.ipv4Status));
  if (data.reverseProxy.warnings.length) issues.push('warning');
  else if (data.reverseProxy.https) issues.push('operational');
  else issues.push('warning');

  if (issues.includes('error')) return { tone: 'error', label: 'Action required' };
  if (issues.includes('warning') || issues.includes('unknown')) {
    return { tone: 'warning', label: 'Some issues detected' };
  }
  return { tone: 'operational', label: 'All systems operational' };
}

export function ipDetectionSummary(data: SystemOverview): string {
  const ipv4 = data.network.ipv4Status === 'DETECTED';
  const ipv6 = data.network.ipv6Status === 'DETECTED';
  if (ipv4 && ipv6) return 'IPv4 + IPv6 detected';
  if (ipv4) return 'IPv4 detected';
  if (ipv6) return 'IPv6 detected';
  return 'No public address detected';
}

export function durationLabel(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

export function hostLabel(value: string | null): string {
  if (!value) return 'No provider';
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

/** Ensure diagnostic payloads never accidentally include secret-looking keys. */
export function assertNoSensitiveSystemKeys(payload: unknown): string[] {
  const sensitive =
    /^(authorization|password|secret|token|ciphertext|cipher|iv|authtag|database_url|encryption_key|session_secret|turnstile_secret|totp(_?secret)?|recovery_?codes?)$/i;
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
