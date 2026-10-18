import { describe, expect, it } from 'vitest';
import {
  accrualMetrics,
  reservationMetrics,
  REPORT_METRICS,
  ageingBucket,
  cashMetrics,
  comparisonRange,
  dayDistance,
  groupDay,
  isoDay,
  moneyPerNight,
  moneyPercent,
  nightlySnapshot,
  outstanding,
  percent,
  propertyDay,
  ratio,
  reportRange,
  shiftDay,
  snapshotDelta,
  withinFreeCancellation,
} from './report-metrics';

describe('shared report metric definitions and dates', () => {
  it('provides unique auditable definitions for all core KPIs', () => {
    expect(new Set(REPORT_METRICS.map((m) => m.key)).size).toBe(REPORT_METRICS.length);
    expect(REPORT_METRICS.length).toBe(39);
    for (const metric of REPORT_METRICS) {
      expect(metric.formula.length).toBeGreaterThan(10);
      expect(metric.dateBasis.length).toBeGreaterThan(3);
      expect(metric.source.length).toBeGreaterThan(3);
    }
  });
  it('rejects impossible dates and handles leap years and year/month edges', () => {
    expect(isoDay('2025-02-29')).toBe(false);
    expect(isoDay('2024-02-29')).toBe(true);
    expect(isoDay('2026-13-01')).toBe(false);
    expect(reportRange('2024-02-28', '2024-03-01')).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ]);
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('caps ranges, permits a single day, and rejects reversed/invalid ranges', () => {
    expect(reportRange('2026-01-01', '2026-01-01')).toHaveLength(1);
    expect(reportRange('2024-01-01', '2024-12-31')).toHaveLength(366);
    expect(() => reportRange('2024-01-01', '2025-01-01')).toThrow('366');
    expect(() => reportRange('2026-02-01', '2026-01-01')).toThrow();
    expect(() => reportRange('invalid', '2026-01-01')).toThrow();
  });
  it.each([
    ['2026-03-28T23:30:00Z', '2026-03-29'],
    ['2026-03-29T01:30:00Z', '2026-03-29'],
    ['2026-10-25T00:30:00Z', '2026-10-25'],
    ['2026-10-25T01:30:00Z', '2026-10-25'],
    ['2026-12-31T23:30:00Z', '2027-01-01'],
  ])('uses Europe/Tirane local day for %s', (instant, expected) => {
    expect(propertyDay(instant, 'Europe/Tirane')).toBe(expected);
  });
  it('counts calendar nights through 23-hour and 25-hour days', () => {
    expect(dayDistance('2026-03-28', '2026-03-30')).toBe(2);
    expect(dayDistance('2026-10-24', '2026-10-26')).toBe(2);
    expect(dayDistance('2026-10-19', '2026-10-18')).toBe(-1);
    expect(() => propertyDay('bad', 'Europe/Tirane')).toThrow();
    expect(() => propertyDay(new Date(), 'Invalid/Zone')).toThrow();
  });
  it('groups calendar days by Monday weeks and calendar months', () => {
    expect(groupDay('2027-01-01', 'week')).toBe('2026-12-28');
    expect(groupDay('2026-10-19', 'week')).toBe('2026-10-19');
    expect(groupDay('2026-10-18', 'month')).toBe('2026-10-01');
    expect(groupDay('2026-10-18', 'day')).toBe('2026-10-18');
  });
  it('compares equal previous lengths and clamps prior-year leap day', () => {
    expect(comparisonRange('2026-01-01', '2026-01-03', 'previous')).toEqual({
      from: '2025-12-29',
      to: '2025-12-31',
    });
    expect(comparisonRange('2024-02-29', '2024-03-01', 'year')).toEqual({
      from: '2023-02-28',
      to: '2023-03-01',
    });
  });
});

describe('shared ratio, accrual and cash formulas', () => {
  it('calculates occupancy, ALOS and cohort cancellation rates without clamping overbooking', () => {
    expect(percent(3, 4)).toBe(75);
    expect(percent(5, 4)).toBe(125);
    expect(ratio(7, 2)).toBe(3.5);
    expect(percent(1, 4)).toBe(25);
    expect(percent(0, 4)).toBe(0);
    for (const denominator of [0, null]) {
      expect(percent(1, denominator)).toBeNull();
      expect(ratio(0, denominator)).toBeNull();
    }
    expect(percent(null, 4)).toBeNull();
  });
  it('computes ADR, RevPAR and TRevPAR in cents with half-away rounding', () => {
    expect(moneyPerNight('99999999999999.99', 3)).toBe('33333333333333.33');
    expect(moneyPerNight('100.01', 2)).toBe('50.01');
    expect(moneyPerNight('-100.01', 2)).toBe('-50.01');
    expect(moneyPerNight('100.00', 3)).toBe('33.33');
    expect(moneyPerNight('100.00', 4)).toBe('25.00');
    expect(moneyPerNight('120.00', 4)).toBe('30.00');
    expect(moneyPerNight('100.00', 1)).toBe('100.00');
    expect(moneyPerNight(null, 4)).toBeNull();
    expect(moneyPerNight('100.00', 0)).toBeNull();
    expect(moneyPerNight('100.00', null)).toBeNull();
  });
  it('preserves exact decimal sums and independent currencies including negative net', () => {
    expect(
      cashMetrics([
        { kind: 'CHARGE', status: 'PAID', amount: '0.10', currency: 'EUR' },
        { kind: 'CHARGE', status: 'succeeded', amount: '0.20', currency: 'EUR' },
        { kind: 'REFUND', status: 'REFUNDED', amount: '0.40', currency: 'EUR' },
        { kind: 'CHARGE', status: 'PAID', amount: '100.00', currency: 'USD' },
        { kind: 'REFUND', status: 'pending', amount: '20.00', currency: 'USD' },
        { kind: 'REFUND', status: 'FAILED', amount: '20.00', currency: 'USD' },
        { kind: 'CHARGE', status: 'FAILED', amount: '20.00', currency: 'EUR' },
      ]),
    ).toEqual([
      { currency: 'EUR', collected: '0.30', refunded: '0.40', netCollected: '-0.10' },
      { currency: 'USD', collected: '100.00', refunded: '0.00', netCollected: '100.00' },
    ]);
    expect(cashMetrics([])).toEqual([]);
  });
  it('handles every supported successful refund status and rejects corrupt successful money', () => {
    for (const status of ['PAID', 'succeeded', 'REFUNDED'])
      expect(
        cashMetrics([{ kind: 'REFUND', status, amount: '1.00', currency: 'EUR' }])[0]?.refunded,
      ).toBe('1.00');
    expect(() =>
      cashMetrics([{ kind: 'CHARGE', status: 'PAID', amount: '-1.00', currency: 'EUR' }]),
    ).toThrow();
    expect(() =>
      cashMetrics([{ kind: 'CHARGE', status: 'PAID', amount: '1.00', currency: 'bad' }]),
    ).toThrow();
  });
  it('computes collection rate without floating money and outstanding without negative balances', () => {
    expect(moneyPercent('1.00', '3.00')).toBe('33.33');
    expect(moneyPercent('4.00', '3.00')).toBe('133.33');
    expect(moneyPercent('-1.00', '3.00')).toBe('-33.33');
    expect(moneyPercent('1.00', '0.00')).toBeNull();
    expect(moneyPercent(null, '3.00')).toBeNull();
    expect(outstanding('10.00', '3.01')).toBe('6.99');
    expect(outstanding('10.00', '12.00')).toBe('0.00');
    expect(outstanding('10.00', '-2.00')).toBe('12.00');
  });
  it.each([
    [0, '0-7'],
    [7, '0-7'],
    [8, '8-30'],
    [30, '8-30'],
    [31, '31+'],
    [-1, '0-7'],
  ] as const)('ages receivables by arrival date at %s days', (days, bucket) => {
    expect(ageingBucket('2026-10-18', shiftDay('2026-10-18', days))).toBe(bucket);
  });
  it('requires actual historical evidence for pickup and pace', () => {
    expect(snapshotDelta(4, 7)).toBe(-3);
    expect(snapshotDelta(4, 0)).toBe(4);
    expect(snapshotDelta(4, null)).toBeNull();
    expect(snapshotDelta(null, 4)).toBeNull();
  });
  it('uses frozen cancellation cutoff inclusively and distinguishes missing evidence', () => {
    const cutoff = '2026-10-18T10:00:00Z';
    expect(withinFreeCancellation(cutoff, true, cutoff)).toBe(true);
    expect(withinFreeCancellation('2026-10-18T10:00:01Z', true, cutoff)).toBe(false);
    expect(withinFreeCancellation(cutoff, false, cutoff)).toBe(false);
    expect(withinFreeCancellation(cutoff, true, null)).toBe(true);
    expect(withinFreeCancellation(null, true, null)).toBeNull();
    expect(withinFreeCancellation(cutoff, null, null)).toBeNull();
  });
});

describe('immutable nightly revenue evidence', () => {
  const stay = {
    status: 'CONFIRMED',
    startsOn: '2026-12-31',
    endsOn: '2027-01-02',
    createdAt: '2026-12-30T23:30:00Z',
    currency: 'EUR',
    nightlyRates: [
      { date: '2026-12-31', amount: '100.01' },
      { date: '2027-01-01', amount: '99.99' },
    ],
  };
  it('produces identical metrics with pre-parsed immutable snapshot evidence', () => {
    const rows = [stay, { ...stay, currency: 'USD', nightlyRates: null }];
    const snapshots = new Map(
      rows.map((row) => [row, nightlySnapshot(row.nightlyRates, row.startsOn, row.endsOn)]),
    );
    expect(accrualMetrics(rows, '2026-12-31', '2027-01-01', snapshots)).toEqual(
      accrualMetrics(rows, '2026-12-31', '2027-01-01'),
    );
  });
  it('counts created cohorts in property time zone and scheduled stays without counting checkout night', () => {
    const result = reservationMetrics(
      [stay, { ...stay, status: 'CANCELLED' }, { ...stay, status: 'PAYMENT_PENDING' }],
      '2026-12-31',
      '2027-01-02',
      'Europe/Tirane',
    );
    expect(result.bookings).toBe(3);
    expect(result.averageLengthOfStay).toBe(2);
    expect(result.averageLeadDays).toBe(0);
    expect(result.cancelled).toBe(1);
    expect(result.cancellationRate).toBeCloseTo(100 / 3);
    expect(result.daily).toEqual([
      { date: '2026-12-31', bookingsCreated: 3, arrivals: 1, departures: 0, soldNights: 1 },
      { date: '2027-01-01', bookingsCreated: 0, arrivals: 0, departures: 0, soldNights: 1 },
      { date: '2027-01-02', bookingsCreated: 0, arrivals: 0, departures: 1, soldNights: 0 },
    ]);
    const empty = reservationMetrics([], '2026-12-31', '2026-12-31', 'Europe/Tirane');
    expect(empty.averageLengthOfStay).toBeNull();
    expect(empty.averageLeadDays).toBeNull();
    expect(empty.cancellationRate).toBeNull();
  });
  it('recognizes only the selected stay night, regardless of booking creation date', () => {
    expect(
      accrualMetrics([stay, { ...stay, status: 'CANCELLED' }], '2027-01-01', '2027-01-01'),
    ).toEqual([
      {
        currency: 'EUR',
        roomRevenue: '99.99',
        mandatoryCharges: '0.00',
        soldNights: 1,
        unknownBookings: 0,
        legacyNights: 1,
        adr: '99.99',
      },
    ]);
    expect(accrualMetrics([stay], '2027-01-02', '2027-01-02')).toEqual([]);
  });
  it('keeps currencies independent and unknown snapshots out of monetary totals', () => {
    const result = accrualMetrics(
      [stay, { ...stay, nightlyRates: null }, { ...stay, currency: 'USD' }],
      '2026-12-31',
      '2027-01-01',
    );
    expect(result).toEqual([
      {
        currency: 'EUR',
        roomRevenue: null,
        mandatoryCharges: null,
        soldNights: 4,
        unknownBookings: 1,
        legacyNights: 2,
        adr: null,
      },
      {
        currency: 'USD',
        roomRevenue: '200.00',
        mandatoryCharges: '0.00',
        soldNights: 2,
        unknownBookings: 0,
        legacyNights: 2,
        adr: '100.00',
      },
    ]);
  });
  it('subtracts mandatory charges and preserves legacy amount-only snapshots', () => {
    expect(
      nightlySnapshot(
        [
          {
            date: '2026-12-31',
            amount: '110.10',
            components: [
              { kind: 'base', amount: '100.00' },
              { kind: 'rule', amount: '-9.90' },
              { kind: 'charge', id: 'tax', name: 'Recorded fee', amount: '20.00' },
            ],
          },
          { date: '2027-01-01', amount: '90.00' },
        ],
        '2026-12-31',
        '2027-01-02',
      ),
    ).toEqual([
      {
        date: '2026-12-31',
        roomAmount: '90.10',
        charges: [{ id: 'tax', name: 'Recorded fee', amount: '20.00' }],
        legacy: false,
      },
      { date: '2027-01-01', roomAmount: '90.00', charges: [], legacy: true },
    ]);
  });
  it('handles one night without counting departure and never prorates unknown evidence', () => {
    expect(
      nightlySnapshot([{ date: '2026-10-18', amount: '100.00' }], '2026-10-18', '2026-10-19'),
    ).toHaveLength(1);
    expect(
      nightlySnapshot([{ date: '2026-10-19', amount: '100.00' }], '2026-10-18', '2026-10-19'),
    ).toBeNull();
    expect(nightlySnapshot(null, '2026-10-18', '2026-10-19')).toBeNull();
    expect(nightlySnapshot([], '2026-10-18', '2026-10-19')).toBeNull();
  });
  it('rejects missing dates, duplicates, floating JSON money and mismatched component totals', () => {
    for (const row of [
      { date: '2026-10-18', amount: 100 },
      { date: '2026-10-18', amount: '1.001' },
      { date: '2026-10-18', amount: '100.00', components: [] },
      { date: '2026-10-18', amount: '100.00', components: [{ kind: 'base', amount: '99.00' }] },
      { date: '2026-10-18', amount: '100.00', components: [{ kind: 'mystery', amount: '100.00' }] },
    ])
      expect(nightlySnapshot([row], '2026-10-18', '2026-10-19')).toBeNull();
    expect(
      nightlySnapshot(
        [
          { date: '2026-10-18', amount: '100.00' },
          { date: '2026-10-18', amount: '100.00' },
        ],
        '2026-10-18',
        '2026-10-20',
      ),
    ).toBeNull();
  });
});
