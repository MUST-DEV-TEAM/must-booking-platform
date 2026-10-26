import { describe, it, expect } from 'vitest';
import { compareOtb, priorYear, type HistoryDay } from './report-otb';
import { COUNTRY_CODES, countryCode } from '@must/domain-contracts';
import { nightlySnapshot } from './report-metrics';
const day = (
  snapshotDate: string,
  stayDate: string,
  sold = 2,
  minor: string | null = '101',
): HistoryDay => ({
  snapshotDate,
  stayDate,
  sold,
  available: 5,
  currency: 'EUR',
  minor,
  currencySold: sold,
  source: 'LOCAL',
  timezone: 'Europe/Tirane',
  capturedAt: snapshotDate + 'T02:00:00Z',
});
describe('additive report evidence', () => {
  it('validates all 249 assigned country codes', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(countryCode('al')).toBe('AL');
    expect(countryCode(null)).toBeNull();
    expect(countryCode(undefined)).toBeUndefined();
    for (const bad of ['ZZ', 'UK', 'XK', 'Albania', 1, {}, 'USA'])
      expect(() => countryCode(bad)).toThrow();
  });
  it('requires complete history instead of manufacturing zero', () => {
    for (const rows of [[], [day('2026-03-29', '2026-03-29'), day('2026-03-28', '2026-03-29')]])
      expect(
        compareOtb(
          rows,
          '2026-03-29',
          '2026-03-28',
          '2026-03-29',
          '2026-03-30',
          'LOCAL',
          'Europe/Tirane',
        ),
      ).toMatchObject({ status: 'No history yet' });
  });
  it('preserves negative pickup and exact large currency differences at DST', () => {
    const rows = [
      day('2026-03-29', '2026-03-29', 1, '9007199254740991'),
      day('2026-03-28', '2026-03-29', 3, '9007199254740993'),
    ];
    expect(
      compareOtb(
        rows,
        '2026-03-29',
        '2026-03-28',
        '2026-03-29',
        '2026-03-29',
        'LOCAL',
        'Europe/Tirane',
      ),
    ).toMatchObject({
      status: 'Available',
      change: -2,
      revenue: [{ currency: 'EUR', change: '-0.02' }],
    });
    expect(
      compareOtb(
        rows,
        '2026-03-29',
        '2026-03-28',
        '2026-03-29',
        '2026-03-29',
        'LOCAL',
        'Europe/Tirane',
        false,
        false,
      ),
    ).not.toHaveProperty('revenue');
  });
  it('rejects changed source and propagates unknown money', () => {
    const rows = [day('2026-10-25', '2026-10-25', 2, null), day('2026-10-24', '2026-10-25')];
    expect(
      compareOtb(
        rows,
        '2026-10-25',
        '2026-10-24',
        '2026-10-25',
        '2026-10-25',
        'CLOCK',
        'Europe/Tirane',
      ),
    ).toMatchObject({ status: 'No history yet' });
    expect(
      compareOtb(
        rows,
        '2026-10-25',
        '2026-10-24',
        '2026-10-25',
        '2026-10-25',
        'LOCAL',
        'Europe/Tirane',
      ),
    ).toMatchObject({ revenue: [{ change: null }] });
  });
  it('clamps leap-year pace dates and keeps equal lead distances', () => {
    expect(priorYear('2028-02-29')).toBe('2027-02-28');
    expect(
      compareOtb(
        [day('2028-02-29', '2028-03-01', 3), day('2027-02-28', '2027-03-01', 1)],
        '2028-02-29',
        '2027-02-28',
        '2028-03-01',
        '2028-03-01',
        'LOCAL',
        'Europe/Tirane',
        true,
      ),
    ).toMatchObject({ status: 'Available', change: 2 });
  });
  it('uses new tax categories without rewriting older charge evidence', () => {
    const snapshot = (category?: string) =>
      nightlySnapshot(
        [
          {
            date: '2026-01-01',
            amount: '110',
            components: [
              { kind: 'base', amount: '100' },
              {
                kind: 'charge',
                id: 'tax',
                name: 'Tax',
                amount: '10',
                ...(category ? { category } : {}),
              },
            ],
          },
        ],
        '2026-01-01',
        '2026-01-02',
      );
    expect(snapshot('vat')![0]!.charges[0]).toMatchObject({ category: 'vat', amount: '10.00' });
    expect(snapshot()![0]!.charges[0]).toMatchObject({ category: 'Unclassified' });
  });
});
