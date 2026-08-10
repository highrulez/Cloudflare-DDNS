import { ChevronDown, RefreshCw, Search, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type HistoryItem } from '../api';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  PageTitle,
  SelectField,
  cx
} from '../components/ui';
import { safeOperationalTimestamp } from '../utils/date';
import {
  applyClientHistoryFilters,
  changePresentation,
  formatHistoryIp,
  pageRange,
  resultLabel,
  resultTone,
  sanitizeHistoryMessage,
  summarizePage,
  triggerLabel,
  type HistoryResultFilter,
  type HistorySourceFilter,
  type HistoryTypeFilter
} from './history-helpers';

function useHistoryLoad(query: URLSearchParams) {
  const [data, setData] = useState<{
    items: HistoryItem[];
    page: number;
    pageSize: number;
    total: number;
  }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .history(query)
      .then(setData)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, [query]);
  useEffect(load, [load]);
  return { data, loading, error, reload: load };
}

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState<HistoryResultFilter>('');
  const [record, setRecord] = useState('');
  const [typeFilter, setTypeFilter] = useState<HistoryTypeFilter>('');
  const [sourceFilter, setSourceFilter] = useState<HistorySourceFilter>('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>();

  const query = useMemo(() => {
    const value = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    if (status) value.set('status', status);
    if (record.trim()) value.set('record', record.trim());
    return value;
  }, [page, pageSize, status, record]);

  const state = useHistoryLoad(query);
  const serverItems = state.data?.items ?? [];
  const visible = useMemo(
    () => applyClientHistoryFilters(serverItems, { type: typeFilter, source: sourceFilter }),
    [serverItems, typeFilter, sourceFilter]
  );
  const pageSummary = useMemo(() => summarizePage(visible), [visible]);
  const total = state.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const range = pageRange(page, pageSize, total);
  const clientFiltersActive = Boolean(typeFilter || sourceFilter);
  const filtersActive = Boolean(status || record.trim() || typeFilter || sourceFilter);

  const clearFilters = () => {
    setStatus('');
    setRecord('');
    setTypeFilter('');
    setSourceFilter('');
    setPage(1);
  };

  const toolbarSelect =
    'h-9 min-w-[7.5rem] rounded-lg border border-slate-200/90 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-900 dark:text-slate-100';

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageTitle
        eyebrow="Audit Log"
        title="Update History"
        description="Review DDNS checks, address changes, synchronization events, and management activity."
        actions={
          <Button variant="secondary" onClick={state.reload}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {!state.loading && !state.error && (
        <p className="text-[12px] text-slate-500 dark:text-slate-400">
          {total.toLocaleString()} total events
          {visible.length > 0 && (
            <>
              {' '}
              · Current page: {pageSummary.updated} updated · {pageSummary.unchanged} no change ·{' '}
              {pageSummary.failed} failed
            </>
          )}
          {clientFiltersActive && ' · Type/source filters apply to this page'}
        </p>
      )}

      <Card className="p-3">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Result"
              className={toolbarSelect}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as HistoryResultFilter);
                setPage(1);
              }}
            >
              <option value="">All results</option>
              <option value="success">Updated / success</option>
              <option value="skipped">No change</option>
              <option value="failed">Failed</option>
            </select>
            <select
              aria-label="Type"
              className={cx(toolbarSelect, 'min-w-[6.5rem]')}
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as HistoryTypeFilter)}
            >
              <option value="">All types</option>
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
            </select>
            <select
              aria-label="Source"
              className={toolbarSelect}
              value={sourceFilter ?? ''}
              onChange={(event) =>
                setSourceFilter((event.target.value || '') as HistorySourceFilter)
              }
            >
              <option value="">All sources</option>
              <option value="SCHEDULED">Automatic</option>
              <option value="MANUAL_CHECK">Check Now</option>
              <option value="FORCE">Force Update</option>
              <option value="MANUAL_UPDATE">Manual</option>
              <option value="SETUP">Setup</option>
            </select>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            <label className="relative min-w-[12rem] flex-1 lg:max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                aria-label="Search hostname"
                value={record}
                onChange={(event) => {
                  setRecord(event.target.value);
                  setPage(1);
                }}
                placeholder="Search hostname…"
                className="h-9 w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-8 pr-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent/20 dark:border-white/10 dark:bg-console-900 dark:text-slate-100"
              />
            </label>
            <div className="relative">
              <Button
                type="button"
                variant="secondary"
                className="min-h-9 px-2.5"
                aria-label="Rows per page"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
              {moreOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-label="Close options"
                    onClick={() => setMoreOpen(false)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-panel dark:border-white/10 dark:bg-console-850 dark:shadow-panel-dark">
                    <SelectField
                      label="Rows per page"
                      value={pageSize}
                      onChange={(event) => {
                        setPageSize(Number(event.target.value));
                        setPage(1);
                        setMoreOpen(false);
                      }}
                    >
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </SelectField>
                  </div>
                </>
              )}
            </div>
            {filtersActive && (
              <Button type="button" variant="ghost" className="min-h-9 px-2.5" onClick={clearFilters}>
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {state.loading ? (
        <HistorySkeleton />
      ) : state.error ? (
        <ErrorState message="Unable to load update history." retry={state.reload} />
      ) : total === 0 && !filtersActive ? (
        <Empty
          title="No DDNS activity yet"
          message="Activity will appear here after records are checked or synchronized."
        />
      ) : visible.length === 0 ? (
        <Empty
          title="No events match your filters"
          message="Try adjusting result, type, source, or hostname search."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="ops-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-white/[0.06]">
                  {['Time', 'Record', 'Type', 'Change', 'Result', 'Source', ''].map((label) => (
                    <th
                      key={label || 'expand'}
                      className="ops-eyebrow whitespace-nowrap px-3 py-2.5 first:pl-4 last:pr-4"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    expanded={expanded === item.id}
                    onToggle={() =>
                      setExpanded((current) => (current === item.id ? undefined : item.id))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-4 py-3 text-[13px] text-slate-500 dark:border-white/[0.06]">
            <span>
              {range.start}–{range.end} of {total.toLocaleString()}
              {clientFiltersActive ? ` · ${visible.length} shown on this page` : ''}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="min-h-8"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                Page {page} of {pages}
              </span>
              <Button
                variant="secondary"
                className="min-h-8"
                disabled={page >= pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  item,
  expanded,
  onToggle
}: {
  item: HistoryItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stamp = safeOperationalTimestamp(item.createdAt);
  const change = changePresentation(item);
  const source = triggerLabel(item.trigger);
  const tone = resultTone(item);

  return (
    <>
      <tr className="border-t border-slate-100/90 transition-colors hover:bg-slate-50/80 dark:border-white/[0.04] dark:hover:bg-white/[0.025]">
        <td className="whitespace-nowrap px-3 py-3 first:pl-4">
          {stamp ? (
            <div>
              <p className="ops-mono text-[12px] text-slate-700 dark:text-slate-200">
                {stamp.absolute}
              </p>
              <p className="text-[11px] text-slate-500">{stamp.relative}</p>
            </div>
          ) : (
            <span className="text-[12px] text-slate-400">—</span>
          )}
        </td>
        <td className="max-w-[16rem] px-3 py-3">
          <p className="truncate font-medium text-slate-900 dark:text-slate-50">
            {item.recordName ?? item.action}
          </p>
          {item.zoneName && (
            <p className="mt-0.5 truncate text-[12px] text-slate-500">{item.zoneName}</p>
          )}
        </td>
        <td className="px-3 py-3">
          {item.recordType ? (
            <>
              <span className="ops-mono text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                {item.recordType}
              </span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                {item.recordType === 'A' ? 'IPv4' : 'IPv6'}
              </span>
            </>
          ) : (
            <span className="text-[12px] text-slate-400">—</span>
          )}
        </td>
        <td className="max-w-[16rem] px-3 py-3">
          <ChangeCell change={change} failed={item.status === 'failed'} message={item.message} />
        </td>
        <td className="px-3 py-3">
          <Badge status={tone}>{resultLabel(item)}</Badge>
        </td>
        <td className="px-3 py-3 text-[12px] text-slate-600 dark:text-slate-300">
          {source ?? '—'}
        </td>
        <td className="px-3 py-3 pr-4 text-right">
          <Button
            type="button"
            variant="ghost"
            className="min-h-8 px-2"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide event details' : 'Show event details'}
            title="Event details"
            onClick={onToggle}
          >
            <ChevronDown
              className={cx('h-4 w-4 transition', expanded && 'rotate-180')}
              aria-hidden
            />
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100/90 bg-slate-50/70 dark:border-white/[0.04] dark:bg-white/[0.02]">
          <td colSpan={7} className="px-4 py-4">
            <EventDetails item={item} source={source} />
          </td>
        </tr>
      )}
    </>
  );
}

function ChangeCell({
  change,
  failed,
  message
}: {
  change: ReturnType<typeof changePresentation>;
  failed: boolean;
  message?: string;
}) {
  if (failed && message) {
    return (
      <div>
        <p className="text-[12px] font-medium text-rose-700 dark:text-rose-300">
          {sanitizeHistoryMessage(message)}
        </p>
        {change.current && (
          <p className="ops-mono mt-0.5 text-[11px] text-slate-500" title={change.current}>
            {formatHistoryIp(change.current).display}
          </p>
        )}
      </div>
    );
  }
  if (change.kind === 'changed' && change.previous && change.next) {
    const previous = formatHistoryIp(change.previous);
    const next = formatHistoryIp(change.next);
    return (
      <div className="ops-mono text-[12px] leading-relaxed text-slate-700 dark:text-slate-200">
        <p title={previous.full}>{previous.display}</p>
        <p className="text-slate-400">→</p>
        <p title={next.full}>{next.display}</p>
      </div>
    );
  }
  if (change.kind === 'unchanged') {
    return (
      <div>
        <p className="text-[12px] font-medium text-slate-600 dark:text-slate-300">No address change</p>
        {change.current && (
          <p className="ops-mono mt-0.5 text-[11px] text-slate-500" title={change.current}>
            {formatHistoryIp(change.current).display}
          </p>
        )}
      </div>
    );
  }
  if (change.kind === 'message' && change.message) {
    return <p className="text-[12px] text-slate-600 dark:text-slate-300">{change.message}</p>;
  }
  return <span className="text-[12px] text-slate-400">—</span>;
}

function EventDetails({
  item,
  source
}: {
  item: HistoryItem;
  source?: string;
}) {
  const stamp = safeOperationalTimestamp(item.createdAt);
  const rows: Array<[string, string]> = [
    ['Record', item.recordName ?? '—'],
    ['Type', item.recordType ? `${item.recordType} / ${item.recordType === 'A' ? 'IPv4' : 'IPv6'}` : '—'],
    ['Previous value', item.oldValue ?? '—'],
    ['Detected value', item.newValue ?? '—'],
    ['Result', resultLabel(item)],
    ['Action', item.action],
    ['Triggered', source ?? '—'],
    ['Timestamp', stamp?.absolute ?? '—']
  ];
  if (item.message) rows.push(['Detail', sanitizeHistoryMessage(item.message)]);

  return (
    <div>
      <p className="ops-eyebrow mb-3">Event details</p>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200/70 px-3 py-2 dark:border-white/[0.06]">
            <dt className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{label}</dt>
            <dd
              className={cx(
                'mt-1 text-[13px] text-slate-800 dark:text-slate-100',
                (label.includes('value') || label === 'Record') && 'ops-mono break-all'
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="ops-panel overflow-hidden" role="status" aria-label="Loading update history">
      <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3.5">
            <div className="h-8 w-28 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
            <div className="h-4 flex-1 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
            <div className="hidden h-4 w-24 animate-pulse rounded bg-slate-200/70 sm:block dark:bg-white/5" />
            <div className="h-4 w-16 animate-pulse rounded bg-slate-200/70 dark:bg-white/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
