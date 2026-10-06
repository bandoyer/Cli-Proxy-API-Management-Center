/**
 * Ledger time text. Relative time comes first ("in 4 days · 10/10, 12:18"),
 * because it is what you react to; the absolute instant follows.
 */

import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import { DAY_MS } from '@/utils/time/durations';
import type { LedgerRenewal } from './model';

export function formatWhen(atMs: number, now: number, locale?: string): string {
  return `${formatRelativeInstant(atMs, now, locale)} · ${formatInstantShort(atMs)}`;
}

const dayFormatters = new Map<string, Intl.RelativeTimeFormat>();

/** "today", "tomorrow", "in 17 days": a saved renewal day has a date but no time. */
function formatRelativeDays(days: number, locale?: string): string {
  const key = locale ?? '';
  let formatter = dayFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    } catch {
      formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    }
    dayFormatters.set(key, formatter);
  }
  return formatter.format(days, 'day');
}

export function formatRenewal(renewal: LedgerRenewal, now: number, locale?: string): string {
  if (renewal.source === 'provider') return formatWhen(renewal.atMs, now, locale);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  // Rounded, so a daylight-saving change between now and then cannot shift the day.
  const days = Math.round((renewal.atMs - startOfToday) / DAY_MS);
  const date = new Date(renewal.atMs).toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
  });
  return `${formatRelativeDays(days, locale)} · ${date}`;
}
