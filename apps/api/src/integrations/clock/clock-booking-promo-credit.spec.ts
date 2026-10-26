import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';

const credentials = { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' };
const context = { tenantId: 't1', propertyId: 'p1' };
const discount = { amount: '30.00', currency: 'EUR' };

function setup(folio: unknown, credit: unknown) {
  const manualReview = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const notifications = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const service = Object.assign(Object.create(ClockBookingService.prototype), {
    manualReview,
    notifications,
    audit,
    fetch: vi.fn().mockResolvedValue(folio),
    postCreditItem: vi.fn().mockResolvedValue(credit),
    withRetry: (work: () => unknown) => work(),
  });
  const post = () =>
    (
      service as unknown as {
        postPromoDiscount: (...args: unknown[]) => Promise<void>;
      }
    ).postPromoDiscount({}, context, credentials, 'b1', '39048664', discount, 'WELCOME10');
  return { service, post, manualReview, notifications, audit };
}

describe('posting a MUST promo discount on the Clock bill', () => {
  it('posts a labelled credit on the default bill, with a reference that makes it safe to repeat', async () => {
    const { service, post, audit, manualReview } = setup(
      { ok: true, value: { id: 78304476 } },
      { ok: true, value: { id: 1 } },
    );

    await post();

    expect(service.postCreditItem).toHaveBeenCalledWith(
      credentials,
      78304476,
      discount,
      'MUST promo discount',
      'promo:b1',
      'payment',
      'cash',
      'Promo code WELCOME10 (MUST)',
    );
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'booking.clock_promo_discount_posted' }),
    );
    expect(manualReview.recordInTransaction).not.toHaveBeenCalled();
  });

  it('asks a person to post it by hand when Clock refuses, without undoing the reservation', async () => {
    const { post, manualReview, notifications } = setup(
      { ok: true, value: { id: 78304476 } },
      {
        ok: false,
        error: {
          category: 'authorization',
          code: 'clock_authorization',
          message: 'no right',
          retryable: false,
        },
      },
    );

    await expect(post()).resolves.toBeUndefined();

    expect(manualReview.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(notifications.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        payload: { bookingId: 'b1', reason: 'clock_promo_discount_failed' },
      }),
    );
  });

  it('reports a reservation with no default bill instead of posting somewhere else', async () => {
    const { service, post, manualReview } = setup({ ok: true, value: {} }, { ok: true, value: {} });

    await post();

    expect(service.postCreditItem).not.toHaveBeenCalled();
    expect(manualReview.recordInTransaction).toHaveBeenCalledTimes(1);
  });
});
