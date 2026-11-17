import { describe, expect, it, vi } from 'vitest';
import { BookingReviewService } from './booking-review.service';

function serviceWith(rows: unknown[]) {
  const service = Object.create(BookingReviewService.prototype) as BookingReviewService;
  (service as unknown as { db: unknown }).db = {
    withTenantTransaction: vi.fn((_scope: unknown, work: (tx: unknown) => unknown) =>
      work({ $queryRaw: vi.fn().mockResolvedValue(rows) }),
    ),
  };
  return service;
}

const scope = { tenantId: 't', propertyId: 'p' };

describe('BookingReviewService.openBillsCsv', () => {
  it('lists each open note with the bill, the date and the action', async () => {
    const csv = await serviceWith([
      {
        reference: 'CLOCK-367',
        startsOn: '2026-12-01',
        endsOn: '2026-12-03',
        status: 'CANCELLED',
        balance: { amount: '120.00', currency: 'EUR' },
        raisedAt: new Date('2026-11-17T10:00:00Z'),
        action: 'In Clock, open the bill and issue the Deposit Adjustment.',
        message: 'fallback',
      },
    ]).openBillsCsv(scope);
    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines[0]).toBe(
      '"Booking","Arrival","Departure","Booking status","Clock bill shows","Note raised","What to do"',
    );
    expect(lines[1]).toBe(
      '"CLOCK-367","2026-12-01","2026-12-03","CANCELLED","120.00 EUR","2026-11-17","In Clock, open the bill and issue the Deposit Adjustment."',
    );
  });

  it('falls back to the note message, and gives only the header when nothing is open', async () => {
    const withFallback = await serviceWith([
      {
        reference: null,
        startsOn: '2026-12-01',
        endsOn: '2026-12-02',
        status: 'EXPIRED',
        balance: null,
        raisedAt: new Date('2026-11-17T10:00:00Z'),
        action: '  ',
        message: 'Clock still shows money.',
      },
    ]).openBillsCsv(scope);
    expect(withFallback).toContain('"Clock still shows money."');
    expect((await serviceWith([]).openBillsCsv(scope)).split('\r\n')).toHaveLength(1);
  });

  it('neutralises a spreadsheet formula in the action text', async () => {
    const csv = await serviceWith([
      {
        reference: 'X',
        startsOn: '2026-12-01',
        endsOn: '2026-12-02',
        status: 'CANCELLED',
        balance: null,
        raisedAt: new Date('2026-11-17T10:00:00Z'),
        action: '=HYPERLINK("http://evil")',
        message: 'm',
      },
    ]).openBillsCsv(scope);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
