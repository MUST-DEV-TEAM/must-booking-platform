import { describe, expect, it, vi } from 'vitest';

import { BookingStayStatusService } from './booking-stay-status.service';

const context = { tenantId: 't1', propertyId: 'p1', userId: 'u1' };

function setup(rule: string) {
  const queries = [
    [
      {
        status: 'CONFIRMED',
        from: 'expected',
        startsOn: '2027-07-12',
        externalBookingId: null,
        today: '2027-07-12',
      },
    ],
    [
      {
        rule,
        currency: 'EUR',
        startsOn: '2027-07-12',
        nightlyRates: [
          { date: '2027-07-12', amount: '90.00' },
          { date: '2027-07-13', amount: '95.00' },
        ],
      },
    ],
  ];
  const tx = {
    $queryRaw: vi.fn(async () => queries.shift() ?? []),
    $executeRaw: vi.fn(async () => 1),
  };
  const manualReview = { recordInTransaction: vi.fn(async () => undefined) };
  const service = new BookingStayStatusService(
    { withTenantTransaction: vi.fn(async (_c, run) => run(tx)) } as never,
    { recordInTransaction: vi.fn(async () => undefined) } as never,
    { guest: vi.fn(async () => undefined) } as never,
    manualReview as never,
  );
  return { service, manualReview };
}

describe('marking a no-show follows the hotel rule (G-54)', () => {
  it('raises a review item naming the first night', async () => {
    const { service, manualReview } = setup('charge_first_night');
    await service.set(context, 'b1', 'no_show');
    expect(manualReview.recordInTransaction).toHaveBeenCalledTimes(1);
    const input = (manualReview.recordInTransaction.mock.calls as unknown[][])[0]![1] as {
      message: string;
      referenceId: string;
    };
    expect(input.referenceId).toBe('b1');
    expect(input.message).toContain('90.00 EUR');
  });

  it('raises nothing when the hotel charges nothing', async () => {
    const { service, manualReview } = setup('charge_nothing');
    await service.set(context, 'b1', 'no_show');
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });

  it('raises nothing for other stay changes', async () => {
    const { service, manualReview } = setup('charge_first_night');
    await service.set(context, 'b1', 'checked_in');
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });
});
