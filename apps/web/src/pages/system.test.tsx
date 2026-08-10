import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemOverview } from '../api';
import { ToastProvider } from '../components/ui';
import { assertNoSensitiveSystemKeys } from './system-helpers';

const systemOverviewMock = vi.fn();
const mfaStatusMock = vi.fn();
const refreshNetworkMock = vi.fn();
const systemDiagnosticsMock = vi.fn();
const systemLogsMock = vi.fn();
const runSystemTestsMock = vi.fn();

vi.mock('../api', () => ({
  api: {
    systemOverview: (...args: unknown[]) => systemOverviewMock(...args) as Promise<unknown>,
    mfaStatus: (...args: unknown[]) => mfaStatusMock(...args) as Promise<unknown>,
    refreshSystemNetwork: (...args: unknown[]) => refreshNetworkMock(...args) as Promise<unknown>,
    systemDiagnostics: (...args: unknown[]) => systemDiagnosticsMock(...args) as Promise<unknown>,
    systemLogs: (...args: unknown[]) => systemLogsMock(...args) as Promise<unknown>,
    runSystemTests: (...args: unknown[]) => runSystemTestsMock(...args) as Promise<unknown>,
    systemLogsDownloadUrl: '/api/system/logs/download'
  }
}));

import { SystemPage } from './system';

function sampleOverview(overrides: Partial<SystemOverview> = {}): SystemOverview {
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
    ...overrides
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <SystemPage />
    </ToastProvider>
  );
}

describe('System page', () => {
  beforeEach(() => {
    systemOverviewMock.mockReset();
    mfaStatusMock.mockReset();
    refreshNetworkMock.mockReset();
    systemDiagnosticsMock.mockReset();
    systemLogsMock.mockReset();
    runSystemTestsMock.mockReset();
    mfaStatusMock.mockResolvedValue({
      enabled: true,
      enabledAt: '2026-08-01T00:00:00.000Z',
      recoveryCodesRemaining: 8,
      recoveryCodesTotal: 10
    });
    systemOverviewMock.mockResolvedValue(sampleOverview());
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders system status with service health, network, scheduler, application, security, and database', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'System Status' })).not.toBeNull();
    expect(screen.getByText('All systems operational')).not.toBeNull();
    expect(screen.getByText('Cloudflare API')).not.toBeNull();
    expect(screen.getByText('API connection available')).not.toBeNull();
    expect(screen.getAllByText('Database').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Application database reachable')).not.toBeNull();
    expect(screen.getAllByText('DDNS Scheduler').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('IP Detection')).not.toBeNull();
    expect(screen.getByText('IPv4 + IPv6 detected')).not.toBeNull();
    expect(screen.getByText('HTTPS / Reverse Proxy')).not.toBeNull();

    expect(screen.getByText('203.0.113.25')).not.toBeNull();
    expect(screen.getByText('2001:db8::25')).not.toBeNull();

    expect(screen.getByText('Managed records')).not.toBeNull();
    expect(screen.getByText('16')).not.toBeNull();
    expect(screen.getByText('30 minutes')).not.toBeNull();

    expect(screen.getByText('1.0.0')).not.toBeNull();
    expect(screen.getByText('a1b2c3d')).not.toBeNull();
    expect(screen.getByText('production')).not.toBeNull();
    expect(screen.getByText('v22.11.0')).not.toBeNull();

    expect(screen.getByText('Turnstile')).not.toBeNull();
    expect(screen.getByText('MFA')).not.toBeNull();
    expect(screen.getAllByText('Enabled').length).toBeGreaterThan(0);
    expect(screen.getByText('Connected')).not.toBeNull();
    expect(screen.getByText('MariaDB')).not.toBeNull();
    expect(screen.getByText('Connection latency')).not.toBeNull();
    expect(screen.getAllByText('18 ms').length).toBeGreaterThanOrEqual(1);
  });

  it('shows IPs by default and allows hide/show plus copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await screen.findByText('203.0.113.25');

    fireEvent.click(screen.getByRole('button', { name: 'Hide IPv4' }));
    expect(screen.queryByText('203.0.113.25')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show IPv4' }));
    expect(screen.getByText('203.0.113.25')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide IPv6' }));
    expect(screen.queryByText('2001:db8::25')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show IPv6' }));
    expect(screen.getByText('2001:db8::25')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy IPv4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy IPv6' }));
    expect(writeText).toHaveBeenCalledWith('203.0.113.25');
    expect(writeText).toHaveBeenCalledWith('2001:db8::25');
  });

  it('treats unknown git commit as not available and copies real commits', async () => {
    systemOverviewMock.mockResolvedValue(
      sampleOverview({
        application: {
          ...sampleOverview().application,
          commit: 'unknown'
        }
      })
    );
    renderPage();
    expect((await screen.findAllByText('Not available')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/^unknown$/i)).toBeNull();
    cleanup();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    systemOverviewMock.mockResolvedValue(sampleOverview());
    renderPage();
    await screen.findByText('a1b2c3d');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Git commit' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('a1b2c3d4e5f6');
    });
  });

  it('handles null and invalid scheduler timestamps safely', async () => {
    systemOverviewMock.mockResolvedValue(
      sampleOverview({
        ddns: {
          ...sampleOverview().ddns,
          lastRunAt: null,
          nextRunAt: 'not-a-date',
          lastSuccessfulUpdate: 'invalid'
        }
      })
    );
    renderPage();
    await screen.findByText('System Status');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/RangeError/)).toBeNull();
  });

  it('keeps the page usable when Cloudflare status is unknown/degraded', async () => {
    systemOverviewMock.mockResolvedValue(
      sampleOverview({
        cloudflare: {
          ...sampleOverview().cloudflare,
          status: 'warning',
          message: 'Unable to determine status'
        }
      })
    );
    renderPage();
    expect(await screen.findByText('Unable to determine status')).not.toBeNull();
    expect(screen.getByText('Some issues detected')).not.toBeNull();
    expect(screen.getByText('203.0.113.25')).not.toBeNull();
    expect(screen.getByText('MariaDB')).not.toBeNull();
  });

  it('refreshes status without blanking existing content', async () => {
    renderPage();
    await screen.findByText('203.0.113.25');
    systemOverviewMock.mockResolvedValueOnce(
      sampleOverview({
        network: { ...sampleOverview().network, ipv4: '198.51.100.10' }
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh Status/ }));
    expect(screen.getByText('203.0.113.25')).not.toBeNull();
    expect(await screen.findByText('198.51.100.10')).not.toBeNull();
  });

  it('does not render secret values from the overview payload', async () => {
    const payload = sampleOverview();
    expect(assertNoSensitiveSystemKeys(payload)).toEqual([]);
    systemOverviewMock.mockResolvedValue(payload);
    renderPage();
    await screen.findByText('System Status');
    expect(screen.queryByText(/SESSION_SECRET/i)).toBeNull();
    expect(screen.queryByText(/ENCRYPTION_KEY/i)).toBeNull();
    expect(screen.queryByText(/DATABASE_URL/i)).toBeNull();
    expect(screen.queryByText(/TURNSTILE_SECRET/i)).toBeNull();
  });
});
