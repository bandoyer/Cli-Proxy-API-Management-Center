import { describe, expect, test } from 'bun:test';
import { summarizeLedger, type LedgerWindow } from '@/features/quota/ledger/model';

const NOW = Date.UTC(2026, 9, 6, 12);
const HOUR = 3_600_000;

const win = (
  id: string,
  periodHours: number | null,
  left: number | null,
  resetAtMs: number | null = null
): LedgerWindow => ({ id, label: id, periodHours, left, resetAtMs });

describe('ledger window totals', () => {
  test('sum % left out of 100% per credential that has the window, one segment each', () => {
    const summary = summarizeLedger(
      'codex',
      [
        { windows: [win('5h', 5, 40), win('weekly', 168, 70)] },
        { windows: [win('weekly', 168, 25)] },
        { windows: [win('5h', 5, null), win('weekly', 168, 100)] },
      ],
      NOW
    );

    const byId = Object.fromEntries(summary.totals.map((total) => [total.id, total]));
    expect(byId['5h']).toMatchObject({ sumLeft: 40, outOf: 200, segments: [40, null] });
    expect(byId.weekly).toMatchObject({ sumLeft: 195, outOf: 300, segments: [70, 25, 100] });
  });

  test('are ordered shortest window first', () => {
    const summary = summarizeLedger(
      'claude',
      [{ windows: [win('7d', 168, 1), win('5h', 5, 1)] }],
      NOW
    );

    expect(summary.totals.map((total) => total.id)).toEqual(['5h', '7d']);
  });
});

describe('ledger soonest reset time', () => {
  test('is the earliest future reset time in the window across credentials', () => {
    const summary = summarizeLedger(
      'claude',
      [
        { windows: [win('7d', 168, 50, NOW + 30 * HOUR)] },
        { windows: [win('7d', 168, 50, NOW - HOUR)] },
        { windows: [win('7d', 168, 50, NOW + 4 * HOUR)] },
        { windows: [win('7d', 168, 50, null)] },
      ],
      NOW
    );

    expect(summary.totals[0].soonestResetMs).toBe(NOW + 4 * HOUR);
  });

  test('is null when no credential has a pending reset time', () => {
    const summary = summarizeLedger(
      'claude',
      [{ windows: [win('7d', 168, 100, null)] }, { windows: [win('7d', 168, 100, NOW)] }],
      NOW
    );

    expect(summary.totals[0].soonestResetMs).toBeNull();
  });
});

describe('ledger summary headline window', () => {
  test('is the longest quota window', () => {
    const summary = summarizeLedger(
      'codex',
      [{ windows: [win('5h', 5, 10), win('weekly', 168, 90)] }],
      NOW
    );

    expect(summary.headline?.id).toBe('weekly');
  });

  test('among equally long windows, is the one with the least share left across the provider', () => {
    // Theo's card: "7-day Fable 5 409%" headlines over "7-day limit 454%".
    const summary = summarizeLedger(
      'claude',
      [
        { windows: [win('5h', 5, 100), win('7d', 168, 90), win('7d-fable', 168, 80)] },
        { windows: [win('5h', 5, 100), win('7d', 168, 95), win('7d-fable', 168, 90)] },
        { windows: [win('5h', 5, 100), win('7d', 168, 89), win('7d-fable', 168, 79)] },
        { windows: [win('5h', 5, 100), win('7d', 168, 90), win('7d-fable', 168, 80)] },
        { windows: [win('5h', 5, 100), win('7d', 168, 90), win('7d-fable', 168, 80)] },
      ],
      NOW
    );

    expect(summary.headline?.id).toBe('7d-fable');
    expect(summary.headline?.sumLeft).toBe(409);
  });

  test('compares share left, not raw sums, when credentials lack a window', () => {
    // a: 150 of 200 (75%); b: 90 of 100 (90%). b has the larger share, so a binds first.
    const summary = summarizeLedger(
      'claude',
      [{ windows: [win('a', 168, 75), win('b', 168, 90)] }, { windows: [win('a', 168, 75)] }],
      NOW
    );

    expect(summary.headline?.id).toBe('a');
  });

  test('is null when no credential has a quota reading', () => {
    expect(summarizeLedger('xai', [{ windows: [] }], NOW).headline).toBeNull();
  });
});
