import { describe, expect, test } from 'bun:test';
import {
  parseRenewalDayInput,
  readRenewalDay,
  resolveRenewal,
} from '@/features/quota/ledger/model';

// Local wall-clock instants, so the cases hold in any time zone.
const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

describe('next occurrence of the saved renewal day', () => {
  test('is later this month when the day has not come yet', () => {
    expect(resolveRenewal(null, 23, at(2026, 10, 6, 12))).toEqual({
      source: 'renewal_day',
      atMs: at(2026, 10, 23),
    });
  });

  test('is today on the renewal day itself', () => {
    expect(resolveRenewal(null, 6, at(2026, 10, 6, 23, 59))?.atMs).toBe(at(2026, 10, 6));
  });

  test('is next month once the day has passed', () => {
    expect(resolveRenewal(null, 5, at(2026, 10, 6, 12))?.atMs).toBe(at(2026, 11, 5));
  });

  test('rolls over into January after December', () => {
    expect(resolveRenewal(null, 5, at(2026, 12, 20))?.atMs).toBe(at(2027, 1, 5));
  });

  test('falls on the last day of a month that is too short', () => {
    expect(resolveRenewal(null, 31, at(2026, 11, 6))?.atMs).toBe(at(2026, 11, 30));
    expect(resolveRenewal(null, 30, at(2027, 2, 10))?.atMs).toBe(at(2027, 2, 28));
    expect(resolveRenewal(null, 31, at(2026, 10, 6))?.atMs).toBe(at(2026, 10, 31));
  });
});

describe('renewal date precedence', () => {
  test('a provider-reported renewal date wins over the saved renewal day', () => {
    const reported = at(2026, 10, 22, 23, 47);
    expect(resolveRenewal(reported, 9, at(2026, 10, 6))).toEqual({
      source: 'provider',
      atMs: reported,
    });
  });

  test('is absent when there is neither a reported date nor a saved day', () => {
    expect(resolveRenewal(null, null, at(2026, 10, 6))).toBeNull();
  });
});

describe('renewal day input', () => {
  test('saves a whole day of the month from 1 to 31', () => {
    expect(parseRenewalDayInput('23')).toEqual({ ok: true, day: 23 });
    expect(parseRenewalDayInput(' 1 ')).toEqual({ ok: true, day: 1 });
  });

  test('clears the saved day when empty', () => {
    expect(parseRenewalDayInput('  ')).toEqual({ ok: true, day: null });
  });

  test('rejects anything else', () => {
    for (const text of ['0', '32', '1.5', 'x', '-3', '1e1']) {
      expect(parseRenewalDayInput(text)).toEqual({ ok: false });
    }
  });
});

describe('saved renewal day on the credential list entry', () => {
  test('reads an integer from 1 to 31', () => {
    expect(readRenewalDay({ name: 'a.json', renewal_day: 23 })).toBe(23);
    expect(readRenewalDay({ name: 'a.json', renewal_day: 1 })).toBe(1);
    expect(readRenewalDay({ name: 'a.json', renewal_day: 31 })).toBe(31);
  });

  test('ignores a missing or invalid value', () => {
    expect(readRenewalDay({ name: 'a.json' })).toBeNull();
    for (const value of [0, 32, 1.5, '15', true, null]) {
      expect(readRenewalDay({ name: 'a.json', renewal_day: value })).toBeNull();
    }
  });
});
