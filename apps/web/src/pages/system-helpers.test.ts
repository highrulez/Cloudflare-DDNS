import { describe, expect, it } from 'vitest';
import type { SystemOverview } from '../api';
import {
  assertNoSensitiveSystemKeys,
  detectionLabel,
  detectionTone,
  formatGitCommit,
  healthTone,
  ipDetectionSummary,
  isGitCommitAvailable,
  overallSystemStatus
} from './system-helpers';

function overview(partial: Partial<SystemOverview> = {}): SystemOverview {
  return {
    generatedAt: '2026-08-10T13:00:00.000Z',
    network: {
      ipv4: '203.0.113.25',
      ipv6: '2001:db8::25',
      ipv4Status: 'DETECTED',
      ipv6Status: 'DETECTED',
      ipv4Provider: 'https://ipv4.example.com',
      ipv6Provider: 'https://ipv6.example.com',
      ipv4LatencyMs: 18,
      ipv6LatencyMs: 22,
      detectedAt: '2026-08-10T12:55:00.000Z'
    },
    synology: {
      hostname: 'nas-example',
      operatingSystem: 'Synology DSM 7.2.2',
      kernel: '4.4.0',
      architecture: 'x64',
      timezone: 'Asia/Kuala_Lumpur'
    },
    docker: {
      containerId: 'abc123',
      containerName: 'cloudflare-ddns-manager',
      networkMode: 'host',
      hostNetworking: true,
      uptimeSeconds: 3600,
      nodeVersion: 'v22.11.0',
      platform: 'linux x64'
    },
    database: {
      status: 'healthy',
      type: 'MariaDB',
      version: '11.4.0',
      database: 'ddns',
      latencyMs: 18,
      currentMigration: '20240101000000_init',
      pendingMigrations: []
    },
    cloudflare: {
      status: 'healthy',
      accounts: 1,
      zones: 2,
      latencyMs: 40,
      lastSuccessfulRequest: '2026-08-10T12:00:00.000Z',
      permissions: { zoneRead: 'granted', dnsEdit: 'not_verified' },
      message: 'API connection available'
    },
    ddns: {
      scheduler: 'running',
      intervalMinutes: 30,
      lastRunAt: '2026-08-10T13:22:00.000Z',
      nextRunAt: '2026-08-10T13:52:00.000Z',
      lastSuccessfulUpdate: '2026-08-10T10:42:00.000Z',
      lastError: null,
      managedRecords: 16,
      leaseOwner: 'worker-1',
      schedulerVersion: '1'
    },
    reverseProxy: {
      reverseProxyDetected: true,
      https: true,
      protocol: 'https',
      hostname: 'dns.example.com',
      clientIp: '192.0.2.20',
      forwardedProto: 'https',
      forwardedHost: 'dns.example.com',
      forwardedPort: '443',
      forwardedFor: '192.0.2.20',
      appOrigin: 'https://dns.example.com',
      cookieSecure: true,
      trustProxy: true,
      warnings: []
    },
    security: {
      https: true,
      reverseProxyDetected: true,
      cookieSecure: true,
      turnstileConfigured: true,
      strongAuthAvailable: true
    },
    application: {
      version: '1.0.0',
      commit: 'a1b2c3d4e5f6',
      buildDate: null,
      environment: 'production',
      configurationVersion: '1',
      latestRelease: null,
      startedAt: '2026-08-10T01:00:00.000Z'
    },
    ...partial
  };
}

describe('System helpers', () => {
  it('formats git commits and treats unknown as unavailable', () => {
    expect(formatGitCommit('a1b2c3d4e5f6')).toBe('a1b2c3d');
    expect(isGitCommitAvailable('a1b2c3d4e5f6')).toBe(true);
    expect(formatGitCommit('unknown')).toBe('Not available');
    expect(formatGitCommit('UNKNOWN')).toBe('Not available');
    expect(formatGitCommit(null)).toBe('Not available');
    expect(isGitCommitAvailable('unknown')).toBe(false);
  });

  it('derives overall operational status from existing health signals', () => {
    expect(overallSystemStatus(overview())).toEqual({
      tone: 'operational',
      label: 'All systems operational'
    });
    expect(
      overallSystemStatus(
        overview({
          cloudflare: {
            ...overview().cloudflare,
            status: 'error',
            message: 'Unable to reach Cloudflare'
          }
        })
      )
    ).toEqual({ tone: 'error', label: 'Action required' });
    expect(
      overallSystemStatus(
        overview({
          database: { ...overview().database, status: 'warning' }
        })
      )
    ).toEqual({ tone: 'warning', label: 'Some issues detected' });
  });

  it('maps service and detection statuses without inventing health', () => {
    expect(healthTone('healthy')).toBe('operational');
    expect(healthTone('running')).toBe('operational');
    expect(healthTone('degraded')).toBe('warning');
    expect(healthTone('failed')).toBe('error');
    expect(healthTone('mystery')).toBe('unknown');
    expect(detectionTone('DETECTED')).toBe('operational');
    expect(detectionTone(null)).toBe('unknown');
    expect(detectionLabel(null)).toBe('Unknown');
    expect(detectionLabel('PROVIDER_FAILED')).toBe('Provider failed');
  });

  it('summarizes IP detection from existing statuses', () => {
    expect(ipDetectionSummary(overview())).toBe('IPv4 + IPv6 detected');
    expect(
      ipDetectionSummary(
        overview({
          network: { ...overview().network, ipv6: null, ipv6Status: 'NETWORK_UNAVAILABLE' }
        })
      )
    ).toBe('IPv4 detected');
    expect(
      ipDetectionSummary(
        overview({
          network: {
            ...overview().network,
            ipv4: null,
            ipv6: null,
            ipv4Status: 'NO_GLOBAL_ADDRESS',
            ipv6Status: 'DISABLED'
          }
        })
      )
    ).toBe('No public address detected');
  });

  it('rejects secret-looking keys while allowing safe status fields', () => {
    expect(assertNoSensitiveSystemKeys(overview())).toEqual([]);
    expect(
      assertNoSensitiveSystemKeys({
        security: { turnstileConfigured: true, cookieSecure: true },
        DATABASE_URL: 'mysql://example',
        SESSION_SECRET: 'x',
        token: 'cf-token'
      })
    ).toEqual(['DATABASE_URL', 'SESSION_SECRET', 'token']);
  });
});
