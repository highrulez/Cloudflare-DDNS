import type { HistoryItem } from '../api';
import { truncateIp } from './records-helpers';

export type HistoryResultFilter = '' | 'success' | 'failed' | 'skipped';
export type HistoryTypeFilter = '' | 'A' | 'AAAA';
export type HistorySourceFilter = '' | HistoryItem['trigger'];

export function resultLabel(item: HistoryItem): string {
  if (item.status === 'failed') return 'Failed';
  if (item.status === 'skipped') return 'No change';
  if (item.status === 'pending') return 'Pending';
  if (item.action === 'update') return 'Updated';
  if (item.action === 'create') return 'Created';
  if (item.action === 'delete') return 'Deleted';
  if (item.action === 'stop-managing') return 'Stopped';
  return 'Success';
}

export function resultTone(item: HistoryItem): HistoryItem['status'] {
  if (item.status === 'skipped') return 'skipped';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'pending') return 'pending';
  return 'success';
}

export function triggerLabel(trigger: HistoryItem['trigger']): string | undefined {
  if (!trigger) return undefined;
  if (trigger === 'SCHEDULED') return 'Automatic';
  if (trigger === 'MANUAL_CHECK') return 'Check Now';
  if (trigger === 'FORCE') return 'Force Update';
  if (trigger === 'MANUAL_UPDATE') return 'Manual';
  if (trigger === 'SETUP') return 'Setup';
  return trigger;
}

export function addressChanged(item: HistoryItem): boolean {
  if (!item.oldValue || !item.newValue) return Boolean(item.oldValue || item.newValue);
  return item.oldValue !== item.newValue;
}

export function changePresentation(item: HistoryItem): {
  kind: 'changed' | 'unchanged' | 'message' | 'empty';
  previous?: string;
  next?: string;
  current?: string;
  message?: string;
} {
  if (item.status === 'skipped' || (item.oldValue && item.newValue && item.oldValue === item.newValue)) {
    return {
      kind: 'unchanged',
      current: item.newValue ?? item.oldValue
    };
  }
  if (item.oldValue && item.newValue && item.oldValue !== item.newValue) {
    return { kind: 'changed', previous: item.oldValue, next: item.newValue };
  }
  if (item.message) {
    return { kind: 'message', message: sanitizeHistoryMessage(item.message), current: item.newValue };
  }
  if (item.newValue || item.oldValue) {
    return { kind: 'unchanged', current: item.newValue ?? item.oldValue };
  }
  return { kind: 'empty' };
}

/** Keep UI free of stack-like / secret-looking payloads. */
export function sanitizeHistoryMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Operation failed';
  if (/token|secret|password|authorization|bearer/i.test(trimmed)) {
    return 'Cloudflare request failed';
  }
  if (trimmed.length > 180) return `${trimmed.slice(0, 177)}…`;
  return trimmed;
}

export function summarizePage(items: HistoryItem[]) {
  return {
    total: items.length,
    updated: items.filter((item) => item.status === 'success' && item.action === 'update').length,
    unchanged: items.filter((item) => item.status === 'skipped').length,
    failed: items.filter((item) => item.status === 'failed').length
  };
}

export function applyClientHistoryFilters(
  items: HistoryItem[],
  filters: { type: HistoryTypeFilter; source: HistorySourceFilter }
): HistoryItem[] {
  return items.filter((item) => {
    if (filters.type && item.recordType !== filters.type) return false;
    if (filters.source && item.trigger !== filters.source) return false;
    return true;
  });
}

export function formatHistoryIp(value: string, max = 24): { display: string; full: string } {
  return { display: truncateIp(value, max), full: value };
}

export function pageRange(page: number, pageSize: number, total: number) {
  if (total <= 0) return { start: 0, end: 0 };
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return { start, end };
}
