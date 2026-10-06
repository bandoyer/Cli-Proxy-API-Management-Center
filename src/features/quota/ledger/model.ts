/**
 * Quota ledger model: per-credential quota windows and their per-provider totals.
 * React-free; consumed directly by tests/quotaLedger*.test.ts.
 */

import type { TFunction } from 'i18next';
import type { ClaudeQuotaState, CodexQuotaState, XaiQuotaState } from '@/types';
import { parseIsoToMs, resolveResetMs } from '@/utils/quota';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { resolveClaudePlanLabelKey } from '../providers/claude/data';
import { getCodexPlanLabel } from '../providers/codex/data';
import type { QuotaProviderType } from '../providers/types';

/** Providers shown as summary cards and provider panels; the rest keep stock cards. */
export const LEDGER_PROVIDERS: readonly QuotaProviderType[] = ['claude', 'codex', 'xai'];

export interface LedgerWindow {
  id: string;
  label: string;
  /** Percent left, 0..100; null when the reading has no value. */
  left: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface LedgerRow {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  status: QuotaCardState['status'];
  windows: LedgerWindow[];
  plan: string | null;
  /** True when the row offers a renewal day input: the provider reports no renewal date. */
  asksRenewalDay: boolean;
  renewalDay: number | null;
  renewal: LedgerRenewal | null;
  manualResets: { count: number; firstExpiryMs: number | null } | null;
  /** xAI monthly credits, in cents. */
  credits: { usedCents: number | null; limitCents: number | null } | null;
}

const leftFromUsed = (used: number | null | undefined): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? Math.min(100, Math.max(0, 100 - used)) : null;

type StockWindow = {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
};

const toLedgerWindow = (window: StockWindow, t: TFunction): LedgerWindow => ({
  id: window.id,
  label: window.labelKey ? String(t(window.labelKey, window.labelParams)) : window.label,
  left: leftFromUsed(window.usedPercent),
  resetAtMs: window.resetAtMs ?? null,
  periodHours: window.periodHours ?? null,
});

/** One provider-panel row: the credential's quota reading in ledger form. */
export function buildLedgerRow(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  t: TFunction,
  now: number
): LedgerRow {
  const renewalDay = readRenewalDay(entry.file);
  const row: LedgerRow = {
    entry,
    quota,
    status: quota?.status ?? 'idle',
    windows: [],
    plan: null,
    // Codex reports its renewal date, so it asks only once a reading shows it has none.
    asksRenewalDay: entry.type !== 'codex',
    renewalDay,
    renewal: resolveRenewal(null, renewalDay, now),
    manualResets: null,
    credits: null,
  };
  if (!quota || quota.status !== 'success') return row;

  if (entry.type === 'claude') {
    const claude = quota as unknown as ClaudeQuotaState;
    row.windows = (claude.windows ?? []).map((window) => toLedgerWindow(window, t));
    const planKey = resolveClaudePlanLabelKey(claude.planType, claude.rateLimitTier);
    row.plan = planKey ? String(t(planKey)) : null;
  } else if (entry.type === 'codex') {
    const codex = quota as unknown as CodexQuotaState;
    row.windows = (codex.windows ?? []).map((window) => toLedgerWindow(window, t));
    row.plan = getCodexPlanLabel(codex.planType, t);
    const reportedMs = resolveResetMs([codex.subscriptionActiveUntil ?? null]);
    row.asksRenewalDay = reportedMs === null;
    row.renewal = resolveRenewal(reportedMs, renewalDay, now);
    if (codex.rateLimitResetCreditsAvailableCount != null) {
      const expiries = (codex.rateLimitResetCredits ?? [])
        .filter((credit) => credit.status === 'available')
        .map((credit) => parseIsoToMs(credit.expiresAt))
        .filter((ms): ms is number => ms !== null)
        .sort((a, b) => a - b);
      row.manualResets = {
        count: codex.rateLimitResetCreditsAvailableCount,
        firstExpiryMs: expiries[0] ?? null,
      };
    }
  } else if (entry.type === 'xai') {
    // xAI's billing period end is when usage resets, not when the plan renews.
    const billing = (quota as unknown as XaiQuotaState).billing;
    if (billing) {
      const weekly = billing.periodType === 'weekly';
      row.windows = [
        {
          id: `xai:${billing.periodType}`,
          label: String(
            t(weekly ? 'xai_quota.weekly_limit' : 'quota_management.ledger.monthly_limit')
          ),
          left: leftFromUsed(billing.usedPercent ?? billing.usagePercent),
          resetAtMs:
            billing.resetAtMs ?? parseIsoToMs(billing.periodEnd ?? billing.billingPeriodEnd),
          periodHours: billing.periodHours ?? (weekly ? 168 : 720),
        },
      ];
      row.plan = billing.planLabel ?? null;
      row.credits = { usedCents: billing.usedCents, limitCents: billing.monthlyLimitCents };
    }
  }
  return row;
}

export interface LedgerWindowTotal {
  id: string;
  label: string;
  periodHours: number | null;
  /** Sum of percent left over the credentials that have this window. */
  sumLeft: number | null;
  /** 100 per credential that has this window. */
  outOf: number;
  /** Percent left per credential that has this window, in row order. */
  segments: (number | null)[];
  /** Earliest reset time after now among those credentials; null when none is pending. */
  soonestResetMs: number | null;
}

export interface LedgerSummary<R extends { windows: LedgerWindow[] }> {
  type: QuotaProviderType;
  rows: R[];
  /** One total per window, shortest window first. */
  totals: LedgerWindowTotal[];
  /** The longest window; ties go to the one with the least share left. */
  headline: LedgerWindowTotal | null;
}

export type LedgerRenewal =
  | { source: 'provider'; atMs: number }
  /** Local midnight of the next occurrence of the saved day of the month. */
  | { source: 'renewal_day'; atMs: number };

/** The `renewal_day` field the credential list returns: an integer from 1 to 31. */
export function readRenewalDay(file: Record<string, unknown>): number | null {
  const value = file.renewal_day;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31
    ? value
    : null;
}

/** Renewal day form text: a whole day from 1 to 31, or empty to clear the saved day. */
export function parseRenewalDayInput(
  text: string
): { ok: true; day: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, day: null };
  if (!/^\d{1,2}$/.test(trimmed)) return { ok: false };
  const day = Number(trimmed);
  return day >= 1 && day <= 31 ? { ok: true, day } : { ok: false };
}

/** Local midnight of `day` in the given month, clamped to the month's last day. */
const dayInMonth = (year: number, month: number, day: number): number => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay)).getTime();
};

/**
 * The renewal date to show: the provider's reported date when it has one,
 * otherwise the next occurrence (today included) of the saved renewal day.
 */
export function resolveRenewal(
  providerRenewalMs: number | null,
  renewalDay: number | null,
  now: number
): LedgerRenewal | null {
  if (providerRenewalMs !== null) return { source: 'provider', atMs: providerRenewalMs };
  if (renewalDay === null) return null;
  const today = new Date(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  const startOfToday = new Date(year, month, today.getDate()).getTime();
  const thisMonth = dayInMonth(year, month, renewalDay);
  const atMs = thisMonth >= startOfToday ? thisMonth : dayInMonth(year, month + 1, renewalDay);
  return { source: 'renewal_day', atMs };
}

const shareLeft = (total: LedgerWindowTotal): number =>
  total.sumLeft === null || total.outOf === 0 ? Infinity : total.sumLeft / total.outOf;

export function summarizeLedger<R extends { windows: LedgerWindow[] }>(
  type: QuotaProviderType,
  rows: R[],
  now: number
): LedgerSummary<R> {
  const byId = new Map<string, LedgerWindowTotal>();
  rows.forEach((row) =>
    row.windows.forEach((window) => {
      let total = byId.get(window.id);
      if (!total) {
        total = {
          id: window.id,
          label: window.label,
          periodHours: window.periodHours,
          sumLeft: null,
          outOf: 0,
          segments: [],
          soonestResetMs: null,
        };
        byId.set(window.id, total);
      }
      total.outOf += 100;
      total.segments.push(window.left);
      if (window.left !== null) total.sumLeft = (total.sumLeft ?? 0) + window.left;
      if (
        window.resetAtMs !== null &&
        window.resetAtMs > now &&
        (total.soonestResetMs === null || window.resetAtMs < total.soonestResetMs)
      ) {
        total.soonestResetMs = window.resetAtMs;
      }
    })
  );

  const totals = [...byId.values()].sort(
    (a, b) => (a.periodHours ?? Infinity) - (b.periodHours ?? Infinity)
  );
  const longest = Math.max(0, ...totals.map((total) => total.periodHours ?? 0));
  const headline =
    totals
      .filter((total) => (total.periodHours ?? 0) === longest)
      .sort((a, b) => shareLeft(a) - shareLeft(b))[0] ?? null;

  return { type, rows, totals, headline };
}
