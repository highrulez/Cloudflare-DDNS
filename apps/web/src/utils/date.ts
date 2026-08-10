export type DateValue = string | number | Date | null | undefined;

function validDate(value: DateValue): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized || normalized.toLowerCase() === 'unknown') return null;
    value = normalized;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function safeFormatDate(value: DateValue): string {
  const date = validDate(value);
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  } catch {
    return '—';
  }
}

/** Absolute + relative pair for operational tables. Never throws on invalid input. */
export function safeOperationalTimestamp(
  value: DateValue,
  now = Date.now()
): { absolute: string; relative: string } | null {
  const date = validDate(value);
  if (!date) return null;
  try {
    const absolute = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
      .format(date)
      .replace(', ', ' · ')
      .replace(/, (?=\d)/, ' · ');
    return {
      absolute,
      relative: safeRelativeTime(date, now)
    };
  } catch {
    return null;
  }
}

export function safeRelativeTime(value: DateValue, now = Date.now()): string {
  const date = validDate(value);
  if (!date || !Number.isFinite(now)) return '—';
  const differenceSeconds = Math.round((date.getTime() - now) / 1000);
  const absoluteSeconds = Math.abs(differenceSeconds);
  if (absoluteSeconds < 10) return 'Just now';

  const [amount, unit] =
    absoluteSeconds < 60
      ? [differenceSeconds, 'second' as const]
      : absoluteSeconds < 3600
        ? [Math.round(differenceSeconds / 60), 'minute' as const]
        : absoluteSeconds < 86_400
          ? [Math.round(differenceSeconds / 3600), 'hour' as const]
          : [Math.round(differenceSeconds / 86_400), 'day' as const];
  try {
    return new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(amount, unit);
  } catch {
    return '—';
  }
}
