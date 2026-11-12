import { describe, expect, it, vi } from 'vitest';

import { HotelCancellationRefundService } from './hotel-cancellation-refund.service';

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };
const confirmation = { bookingId: 'booking-1' };

type Row = {
  policy: string;
  status?: string;
  cutoffAt?: Date | null;
  sameArrival?: boolean | null;
  cancelledAt?: Date;
  cancelledByMust?: boolean;
};

/** Booking cancelled in Clock on 2026-11-12, free window ends 2027-04-20 unless a test says otherwise. */
function setup(row: Row, refundOk = true) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        status: 'CANCELLED',
        cutoffAt: new Date('2027-04-20T13:00:00Z'),
        sameArrival: true,
        cancelledAt: new Date('2026-11-12T10:00:00Z'),
        cancelledByMust: false,
        ...row,
      },
    ]),
  };
  const database = {
    withTenantTransaction: vi.fn(async (_context: unknown, operation: (t: unknown) => unknown) =>
      operation(tx),
    ),
  };
  const refunds = {
    refundRemainingChargeForBooking: vi.fn().mockResolvedValue(
      refundOk
        ? { result: { ok: true, value: { id: 'refund-1' } }, confirmation }
        : {
            result: {
              ok: false,
              error: { code: 'POKPAY_REFUND_FAILED', message: 'PokPay said no.', retryable: false },
            },
            confirmation: null,
          },
    ),
  };
  const notifications = { sendRefundConfirmationEmailSafely: vi.fn() };
  const manualReview = { recordInTransaction: vi.fn() };
  const service = new HotelCancellationRefundService(
    database as never,
    refunds as never,
    notifications as never,
    manualReview as never,
  );
  return { service, refunds, notifications, manualReview };
}

describe('HotelCancellationRefundService', () => {
  it('does nothing when the hotel chose Never', async () => {
    const { service, refunds } = setup({ policy: 'NEVER' });
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(refunds.refundRemainingChargeForBooking).not.toHaveBeenCalled();
  });

  it('refunds what is left, posts the email, inside the free window', async () => {
    const { service, refunds, notifications } = setup({ policy: 'FREE_WINDOW' });
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(refunds.refundRemainingChargeForBooking).toHaveBeenCalledWith(
      expect.anything(),
      context,
      'booking-1',
      'hotel-cancellation-refund:booking-1',
      expect.stringContaining('inside the free-cancellation window'),
    );
    expect(notifications.sendRefundConfirmationEmailSafely).toHaveBeenCalledWith(
      confirmation,
      context,
    );
  });

  it('does not refund a cancellation made after the free window', async () => {
    const { service, refunds } = setup({
      policy: 'FREE_WINDOW',
      cancelledAt: new Date('2027-04-21T10:00:00Z'),
    });
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(refunds.refundRemainingChargeForBooking).not.toHaveBeenCalled();
  });

  it('does not guess a window for a booking without frozen terms or with moved dates', async () => {
    for (const row of [
      { policy: 'FREE_WINDOW', cutoffAt: null, sameArrival: null },
      { policy: 'FREE_WINDOW', sameArrival: false },
    ]) {
      const { service, refunds } = setup(row);
      await service.refundAfterHotelCancellation(context, 'booking-1');
      expect(refunds.refundRemainingChargeForBooking).not.toHaveBeenCalled();
    }
  });

  it('refunds outside the window when the hotel chose Always', async () => {
    const { service, refunds } = setup({
      policy: 'ALWAYS',
      cancelledAt: new Date('2027-05-01T10:00:00Z'),
    });
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(refunds.refundRemainingChargeForBooking).toHaveBeenCalledOnce();
  });

  it('skips a cancellation MUST made itself (Clock echoes it back)', async () => {
    const { service, refunds } = setup({ policy: 'ALWAYS', cancelledByMust: true });
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(refunds.refundRemainingChargeForBooking).not.toHaveBeenCalled();
  });

  it('skips a booking that is not cancelled any more', async () => {
    const { service, refunds } = setup({ policy: 'ALWAYS', status: 'CONFIRMED' });
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(refunds.refundRemainingChargeForBooking).not.toHaveBeenCalled();
  });

  it('leaves a review item and sends no email when the refund fails', async () => {
    const { service, notifications, manualReview } = setup({ policy: 'ALWAYS' }, false);
    await service.refundAfterHotelCancellation(context, 'booking-1');
    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        referenceId: 'booking-1',
        message: expect.stringContaining('PokPay said no.'),
      }),
    );
    expect(notifications.sendRefundConfirmationEmailSafely).not.toHaveBeenCalled();
  });

  it('never throws into the Clock event processing', async () => {
    const { service, refunds } = setup({ policy: 'ALWAYS' });
    refunds.refundRemainingChargeForBooking.mockRejectedValueOnce(new Error('database gone'));
    await expect(service.refundAfterHotelCancellation(context, 'booking-1')).resolves.toBe(
      undefined,
    );
  });
});
