import { describe, expect, it } from 'vitest';

import { guestStatsById, guestsCsv } from './guest-stats';
import type { Reservation } from './reservations';

const booking = (over: Partial<Reservation>): Reservation =>
  ({
    id: 'b',
    guestId: 'g1',
    status: 'CONFIRMED',
    paymentMethod: 'POKPAY',
    total: { amount: '100.00', currency: 'EUR' },
    paidAmount: '100.00',
    refundedAmount: '0.00',
    startsOn: '2026-10-01',
    endsOn: '2026-10-03',
    createdAt: '2026-09-01T10:00:00Z',
    ...over,
  }) as Reservation;

const today = '2026-10-16';

describe('guestStatsById', () => {
  it('does not count an uncertain booking as a stay or confirmed debt, while retaining received money', () => {
    const stats = guestStatsById(
      [booking({ status: 'PMS_UNKNOWN_RESULT', paidAmount: '20.00' })],
      today,
    ).get('g1')!;
    expect(stats.stays).toBe(0);
    expect(stats.hasBalance).toBe(false);
    expect(stats.net[0].amount).toBe('20.00');
  });
  it('calls a guest returning from two real stays, ignoring cancelled and expired ones', () => {
    const stats = guestStatsById(
      [
        booking({ id: 'a' }),
        booking({ id: 'b' }),
        booking({ id: 'c', status: 'CANCELLED' }),
        booking({ id: 'd', status: 'EXPIRED', paidAmount: '0.00' }),
      ],
      today,
    ).get('g1')!;
    expect(stats.bookings).toBe(4);
    expect(stats.stays).toBe(2);
    expect(stats.kind).toBe('returning');
    expect(stats.cancelled).toBe(1);
  });

  it('is first-time with one real stay', () => {
    expect(
      guestStatsById([booking({}), booking({ id: 'x', status: 'CANCELLED' })], today).get('g1')!
        .kind,
    ).toBe('first-time');
  });

  it('finds the current, next and last stay', () => {
    const stats = guestStatsById(
      [
        booking({ id: 'past', startsOn: '2026-09-01', endsOn: '2026-09-03' }),
        booking({ id: 'now', startsOn: '2026-10-15', endsOn: '2026-10-18' }),
        booking({ id: 'soon', startsOn: '2026-11-01', endsOn: '2026-11-03' }),
        booking({ id: 'later', startsOn: '2026-12-01', endsOn: '2026-12-03' }),
      ],
      today,
    ).get('g1')!;
    expect(stats.current).toEqual({ startsOn: '2026-10-15', endsOn: '2026-10-18' });
    expect(stats.next).toEqual({ startsOn: '2026-11-01', endsOn: '2026-11-03' });
    expect(stats.last).toEqual({ startsOn: '2026-09-01', endsOn: '2026-09-03' });
  });

  it('counts money net of refunds and never counts an expired hold as owed', () => {
    const stats = guestStatsById(
      [
        booking({ id: 'paid' }),
        booking({ id: 'part', paidAmount: '40.00', refundedAmount: '10.00' }),
        booking({ id: 'owes', paidAmount: '0.00', paymentMethod: 'PAY_AT_HOTEL' }),
        booking({ id: 'expired', status: 'EXPIRED', paidAmount: '0.00' }),
      ],
      today,
    ).get('g1')!;
    expect(stats.net).toEqual([{ currency: 'EUR', amount: '130.00' }]);
    expect(stats.outstanding).toEqual([{ currency: 'EUR', amount: '160.00' }]);
    expect(stats.hasBalance).toBe(true);
  });

  it('skips bookings with no guest', () => {
    expect(guestStatsById([booking({ guestId: undefined as unknown as string })], today).size).toBe(
      0,
    );
  });
});

describe('guestsCsv', () => {
  it('writes one row per guest and defuses spreadsheet formulas', () => {
    const stats = guestStatsById([booking({})], today);
    const csv = guestsCsv(
      [
        {
          id: 'g1',
          email: 'ada@test',
          firstName: '=HYPERLINK("x")',
          lastName: 'Lovelace',
          phone: null,
        },
      ],
      stats,
    );
    const [header, row] = csv.split('\r\n');
    expect(header).toBe(
      'Name,Email,Phone,Stays,Cancelled,Type,Last stay,Next stay,Net paid,Still owed',
    );
    expect(row).toContain('"\'=HYPERLINK(""x"") Lovelace"');
    expect(row).toContain('First-time');
  });
});
