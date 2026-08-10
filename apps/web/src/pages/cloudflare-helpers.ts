import type { Account } from '../api';

const ZONE_CHIP_LIMIT = 4;

export function summarizeAccounts(accounts: Account[]) {
  const connected = accounts.length;
  const zones = accounts.reduce((sum, account) => sum + account.zoneItems.length, 0);
  const healthy = accounts.every((account) => account.status === 'healthy');
  const hasError = accounts.some((account) => account.status === 'error');
  const apiLabel = hasError
    ? 'Connection issues detected'
    : healthy
      ? connected === 1
        ? 'API operational'
        : 'All connections healthy'
      : 'Attention required';
  return {
    connected,
    zones,
    apiLabel,
    summary: `${connected} connected account${connected === 1 ? '' : 's'}  ·  ${zones} accessible zone${zones === 1 ? '' : 's'}  ·  ${apiLabel}`
  };
}

export function visibleZoneChips(account: Account, expanded = false) {
  const zones = account.zoneItems;
  if (expanded || zones.length <= ZONE_CHIP_LIMIT) {
    return { zones, remaining: 0 };
  }
  return {
    zones: zones.slice(0, ZONE_CHIP_LIMIT),
    remaining: zones.length - ZONE_CHIP_LIMIT
  };
}

export function accountConnectionLabel(status: Account['status']) {
  if (status === 'healthy') return 'Healthy';
  if (status === 'error') return 'Error';
  if (status === 'degraded') return 'Degraded';
  if (status === 'updating') return 'Updating';
  if (status === 'disabled') return 'Disabled';
  return status;
}

export function filterZonesBySearch<T extends { name: string }>(zones: T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return zones;
  return zones.filter((zone) => zone.name.toLowerCase().includes(query));
}

export { ZONE_CHIP_LIMIT };
