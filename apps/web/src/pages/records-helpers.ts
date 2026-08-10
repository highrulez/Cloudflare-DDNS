import type { RecordItem } from '../api';

export type RecordFilters = {
  accountFilter: string;
  zoneFilter: string;
  typeFilter: string;
  ddnsFilter: string;
  statusFilter: string;
  proxyFilter: string;
  proxySort: string;
  search: string;
};

/** Pure filter/sort used by DNS Records — kept separate for regression tests. */
export function filterAndSortRecords(
  records: RecordItem[],
  filters: RecordFilters
): RecordItem[] {
  const {
    accountFilter,
    zoneFilter,
    typeFilter,
    ddnsFilter,
    statusFilter,
    proxyFilter,
    proxySort,
    search
  } = filters;
  return records
    .filter(
      (record) =>
        (!accountFilter || record.accountId === accountFilter) &&
        (!zoneFilter || record.zoneId === zoneFilter) &&
        (!typeFilter || record.type === typeFilter) &&
        (!ddnsFilter || (ddnsFilter === 'on' ? record.enabled : !record.enabled)) &&
        (!statusFilter || record.status === statusFilter) &&
        (!proxyFilter || (proxyFilter === 'proxied' ? record.proxied : !record.proxied)) &&
        (!search ||
          `${record.name} ${record.zoneName} ${record.content}`
            .toLowerCase()
            .includes(search.toLowerCase()))
    )
    .sort((left, right) => {
      if (!proxySort || left.proxied === right.proxied) return 0;
      return proxySort === 'proxied-first' ? (left.proxied ? -1 : 1) : left.proxied ? 1 : -1;
    });
}

export function truncateIp(value: string, max = 22): string {
  if (value.length <= max) return value;
  const head = Math.max(8, Math.floor((max - 1) / 2));
  const tail = Math.max(4, max - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function summarizeRecords(records: RecordItem[]) {
  return {
    managed: records.length,
    a: records.filter((record) => record.type === 'A').length,
    aaaa: records.filter((record) => record.type === 'AAAA').length,
    proxied: records.filter((record) => record.proxied).length,
    dnsOnly: records.filter((record) => !record.proxied).length
  };
}
