import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { buildLedgerRow } from '@/features/quota/ledger/model';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import type { ClaudeQuotaState, CodexQuotaState, XaiQuotaState } from '@/types';

const t = ((key: string) => key) as unknown as TFunction;
const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
const NOW = at(2026, 10, 6, 12);

const entry = (type: QuotaFileEntry['type'], extra: Record<string, unknown> = {}) =>
  ({ type, file: { name: `${type}.json`, ...extra } }) as QuotaFileEntry;
const state = (value: unknown) => value as QuotaCardState;

const claude = (extra: Partial<ClaudeQuotaState> = {}): ClaudeQuotaState => ({
  status: 'success',
  windows: [
    {
      id: 'seven-day',
      label: '7-day limit',
      labelKey: 'claude_quota.seven_day',
      usedPercent: 30,
      resetLabel: '',
      resetAtMs: at(2026, 10, 10, 12, 18),
      periodHours: 168,
    },
  ],
  planType: 'plan_max',
  ...extra,
});

const codex = (extra: Partial<CodexQuotaState> = {}): CodexQuotaState => ({
  status: 'success',
  windows: [
    {
      id: 'secondary',
      label: 'Weekly limit',
      usedPercent: 60,
      resetLabel: '',
      resetAtMs: at(2026, 10, 9),
      periodHours: 168,
    },
  ],
  planType: 'pro',
  subscriptionActiveUntil: '2026-10-22T23:47:00Z',
  rateLimitResetCreditsAvailableCount: 2,
  rateLimitResetCredits: [
    { id: 'b', status: 'available', expiresAt: '2026-11-30T00:00:00Z' },
    { id: 'a', status: 'available', expiresAt: '2026-10-30T00:00:00Z' },
    { id: 'c', status: 'used', expiresAt: '2026-10-07T00:00:00Z' },
  ],
  ...extra,
});

const xai = (): XaiQuotaState => ({
  status: 'success',
  billing: {
    mode: 'billing',
    periodType: 'weekly',
    usagePercent: 20,
    usedPercent: 20,
    periodEnd: '2026-10-11T00:00:00Z',
    billingPeriodEnd: '2026-11-01T00:00:00Z',
    productUsage: [],
    monthlyLimitCents: 5000,
    usedCents: 1250,
    includedUsedCents: null,
    onDemandCapCents: null,
    onDemandUsedCents: null,
    onDemandUsedPercent: null,
    planLabel: 'SuperGrok',
  },
});

describe('ledger row quota windows', () => {
  test('turn used percent into percent left with the reset time', () => {
    const row = buildLedgerRow(entry('claude'), state(claude()), t, NOW);

    expect(row.windows).toEqual([
      {
        id: 'seven-day',
        label: 'claude_quota.seven_day',
        left: 70,
        resetAtMs: at(2026, 10, 10, 12, 18),
        periodHours: 168,
      },
    ]);
  });

  test('are empty until the quota reading has loaded', () => {
    const row = buildLedgerRow(entry('claude'), undefined, t, NOW);

    expect(row.status).toBe('idle');
    expect(row.windows).toEqual([]);
  });
});

describe('ledger row plan line', () => {
  test('a Claude Max plan carries the tier from rate_limit_tier', () => {
    const row = buildLedgerRow(
      entry('claude'),
      state(claude({ rateLimitTier: 'default_claude_max_20x' })),
      t,
      NOW
    );

    expect(row.plan).toBe('claude_quota.plan_max20');
  });

  test('a Claude plan without a known tier keeps the plan name', () => {
    const row = buildLedgerRow(entry('claude'), state(claude({ rateLimitTier: null })), t, NOW);

    expect(row.plan).toBe('claude_quota.plan_max');
  });

  test('Codex uses the stock plan label', () => {
    expect(buildLedgerRow(entry('codex'), state(codex()), t, NOW).plan).toBe(
      'codex_quota.plan_pro'
    );
  });
});

describe('ledger row renewal date', () => {
  test("Codex's reported renewal date wins over a saved renewal day", () => {
    const row = buildLedgerRow(entry('codex', { renewal_day: 3 }), state(codex()), t, NOW);

    expect(row.renewal).toEqual({ source: 'provider', atMs: Date.UTC(2026, 9, 22, 23, 47) });
    expect(row.asksRenewalDay).toBe(false);
  });

  test('Codex without a reported date falls back to the saved renewal day', () => {
    const row = buildLedgerRow(
      entry('codex', { renewal_day: 3 }),
      state(codex({ subscriptionActiveUntil: null })),
      t,
      NOW
    );

    expect(row.renewal).toEqual({ source: 'renewal_day', atMs: at(2026, 11, 3) });
    expect(row.asksRenewalDay).toBe(true);
  });

  test('Codex asks for no renewal day before its reading shows whether it reports one', () => {
    expect(buildLedgerRow(entry('codex'), undefined, t, NOW).asksRenewalDay).toBe(false);
    expect(buildLedgerRow(entry('claude'), undefined, t, NOW).asksRenewalDay).toBe(true);
    expect(buildLedgerRow(entry('xai'), undefined, t, NOW).asksRenewalDay).toBe(true);
  });

  test('Claude shows the next occurrence of the saved renewal day', () => {
    const row = buildLedgerRow(entry('claude', { renewal_day: 9 }), state(claude()), t, NOW);

    expect(row.renewal).toEqual({ source: 'renewal_day', atMs: at(2026, 10, 9) });
  });

  test("xAI's billing period end is not taken as the renewal date", () => {
    expect(buildLedgerRow(entry('xai'), state(xai()), t, NOW).renewal).toBeNull();
    expect(buildLedgerRow(entry('xai', { renewal_day: 3 }), state(xai()), t, NOW).renewal).toEqual({
      source: 'renewal_day',
      atMs: at(2026, 11, 3),
    });
  });

  test('the saved renewal day shows before the quota reading loads', () => {
    const row = buildLedgerRow(entry('claude', { renewal_day: 9 }), undefined, t, NOW);

    expect(row.renewal?.atMs).toBe(at(2026, 10, 9));
  });
});

describe('ledger row extras', () => {
  test('Codex shows its manual reset count and the first expiry of an available one', () => {
    const row = buildLedgerRow(entry('codex'), state(codex()), t, NOW);

    expect(row.manualResets).toEqual({ count: 2, firstExpiryMs: Date.UTC(2026, 9, 30) });
  });

  test('xAI shows its monthly credits and its billing window', () => {
    const row = buildLedgerRow(entry('xai'), state(xai()), t, NOW);

    expect(row.credits).toEqual({ usedCents: 1250, limitCents: 5000 });
    expect(row.plan).toBe('SuperGrok');
    expect(row.windows).toEqual([
      {
        id: 'xai:weekly',
        label: 'xai_quota.weekly_limit',
        left: 80,
        resetAtMs: Date.UTC(2026, 9, 11),
        periodHours: 168,
      },
    ]);
  });
});
