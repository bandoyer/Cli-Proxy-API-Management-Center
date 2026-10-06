import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { QuotaLedger, type QuotaLedgerProps } from '@/features/quota/ledger/QuotaLedger';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import { formatInstantShort } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';

const NOW = new Date(2026, 9, 6, 12).getTime();
const previousLanguage = i18n.language;

// The i18n fallback is zh-CN; pin English so the text assertions read.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

const claudeWindow = (id: string, labelKey: string, used: number, resetAtMs: number | null) => ({
  id,
  label: id,
  labelKey,
  usedPercent: used,
  resetLabel: '',
  resetAtMs,
  periodHours: id === 'five-hour' ? 5 : 168,
});

const entries: QuotaFileEntry[] = [
  { type: 'claude', file: { name: 'claude-a.json', renewal_day: 9 } },
  { type: 'claude', file: { name: 'claude-b.json' } },
  { type: 'codex', file: { name: 'codex-a.json' } },
  { type: 'xai', file: { name: 'grok-a.json' } },
];

const quotas: Record<string, unknown> = {
  'claude-a.json': {
    status: 'success',
    planType: 'plan_max',
    rateLimitTier: 'default_claude_max_20x',
    windows: [
      claudeWindow('five-hour', 'claude_quota.five_hour', 0, null),
      claudeWindow('seven-day', 'claude_quota.seven_day', 40, NOW + 4 * DAY_MS),
    ],
  },
  'claude-b.json': {
    status: 'success',
    planType: 'plan_pro',
    windows: [claudeWindow('seven-day', 'claude_quota.seven_day', 10, NOW + 2 * HOUR_MS)],
  },
  'codex-a.json': {
    status: 'success',
    planType: 'pro',
    subscriptionActiveUntil: new Date(NOW + 16 * DAY_MS).toISOString(),
    rateLimitResetCreditsAvailableCount: 1,
    rateLimitResetCredits: [],
    windows: [
      {
        id: 'secondary',
        label: 'Weekly limit',
        usedPercent: 50,
        resetLabel: '',
        resetAtMs: NOW + DAY_MS,
        periodHours: 168,
      },
    ],
  },
  'grok-a.json': { status: 'idle', billing: null },
};

const render = (overrides: Partial<QuotaLedgerProps> = {}) =>
  renderToStaticMarkup(
    createElement(QuotaLedger, {
      entries,
      getQuota: (entry) => quotas[entry.file.name] as QuotaCardState | undefined,
      resolvedTheme: 'light',
      canRefresh: true,
      resettingQuotaName: null,
      onRefresh: () => undefined,
      onReset: () => undefined,
      onSaveRenewalDay: async () => true,
      now: NOW,
      ...overrides,
    })
  );

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('quota ledger page', () => {
  test('reads reset times relative first', () => {
    expect(text(render())).toContain(`in 4 days · ${formatInstantShort(NOW + 4 * DAY_MS)}`);
  });

  test('shows "No reset pending" for a window without a reset time', () => {
    expect(text(render())).toContain('No reset pending');
  });

  test('summary card totals the headline window across the provider', () => {
    // Claude 7-day: 60% + 90% = 150% of 200%; soonest reset in 2 hours.
    const markup = text(render());
    expect(markup).toContain('7-day limit 150% of 200%');
    expect(markup).toContain(`in 2 hours · ${formatInstantShort(NOW + 2 * HOUR_MS)}`);
  });

  test('plan line shows the Claude tier and the next saved renewal day', () => {
    expect(text(render())).toContain('Max 20x · renews in 3 days');
  });

  test("Codex's reported renewal date and manual resets are shown with its reset action", () => {
    const markup = text(render());
    expect(markup).toContain('Pro 200 · renews in 16 days');
    expect(markup).toContain('Manual resets 1 available');
    expect(markup).toContain('Reset quota');
  });

  test('a credential lacking a window gets an empty cell under that column', () => {
    // claude-b has no 5-hour window: its row has an empty cell in that column.
    expect(render()).toMatch(/claude-b\.json<\/div>.*?<\/div><div><\/div>/);
  });

  test('an xAI credential not loaded yet offers a click to load', () => {
    expect(text(render())).toContain('Click here to refresh quota');
  });
});
