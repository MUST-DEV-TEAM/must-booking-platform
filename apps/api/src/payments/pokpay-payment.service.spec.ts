import { describe, expect, it, vi } from 'vitest';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { PokPayPaymentService } from './pokpay-payment.service';

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

function setup(
  status: BookingStatus,
  txResults: unknown[][],
  latePayments?: { start: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> },
) {
  const booking = {
    id: 'booking-1',
    totalAmount: '110.00',
    currency: 'EUR',
    status,
    paymentMethod: BookingPaymentMethod.POKPAY,
  };
  const queue = [[booking], ...txResults];
  const transaction = {
    $queryRaw: vi.fn(async () => queue.shift() ?? []),
  };
  const continueAfterPayment = vi.fn().mockResolvedValue({ ok: true, value: { id: 'booking-1' } });
  const sendAfterConfirmation = vi.fn().mockResolvedValue(undefined);
  const recordInTransaction = vi.fn().mockResolvedValue(undefined);
  const service = new PokPayPaymentService(
    {
      $queryRaw: vi.fn().mockResolvedValue([{ bookingId: 'booking-1', ...context }]),
      withTenantTransaction: vi.fn(async (_context, callback) => callback(transaction)),
    } as never,
    {
      continueAfterPayment,
      expireRequestPaymentIfDue: vi.fn().mockResolvedValue(undefined),
    } as never,
    {
      pokpay: {
        getPayment: vi.fn().mockResolvedValue({
          id: 'order-1',
          status: 'PAID',
          amount: { amount: '110.00', currency: 'EUR' },
        }),
      },
    } as never,
    { sendAfterConfirmation } as never,
    { process: vi.fn().mockResolvedValue(null) } as never,
    { recordInTransaction } as never,
    undefined,
    latePayments as never,
  );
  return { service, transaction, continueAfterPayment, sendAfterConfirmation, recordInTransaction };
}

describe('PokPayPaymentService duplicate recovery', () => {
  it('retries an unfinished Clock continuation for a paid booking still in PMS_CREATION_PENDING', async () => {
    const { service, transaction, continueAfterPayment, recordInTransaction } = setup(
      BookingStatus.PMS_CREATION_PENDING,
      [[{ id: 'payment-1' }]],
    );

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: true } });
    expect(continueAfterPayment).toHaveBeenCalledWith(transaction, context, 'booking-1');
    expect(recordInTransaction).not.toHaveBeenCalled();
  });
});

describe('PokPayPaymentService payment after the hold ended', () => {
  it('records the payment and raises one review item for an expired booking, without confirming', async () => {
    const {
      service,
      transaction,
      continueAfterPayment,
      sendAfterConfirmation,
      recordInTransaction,
    } = setup(BookingStatus.EXPIRED, [[], [{ id: 'late-payment' }]]);

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: false } });
    const insert = transaction.$queryRaw.mock.calls[2] as unknown as [TemplateStringsArray];
    expect(insert[0].join('?')).toContain('INSERT INTO payments');
    // The database allows a note only on refund rows (payments_note_refund_only).
    expect(insert[0].join('?')).not.toContain('note');
    expect(recordInTransaction).toHaveBeenCalledTimes(1);
    expect(recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        ...context,
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceType: 'booking',
        referenceId: 'booking-1',
        context: {
          kind: 'LATE_PAYMENT_AFTER_EXPIRY',
          orderId: 'order-1',
          bookingStatus: BookingStatus.EXPIRED,
          amount: '110.00',
          currency: 'EUR',
        },
      }),
    );
    expect(continueAfterPayment).not.toHaveBeenCalled();
    expect(sendAfterConfirmation).not.toHaveBeenCalled();
  });

  it('starts the saved refund flow in the same transaction and runs it after the commit (ADR-0043)', async () => {
    const latePayments = {
      start: vi.fn().mockResolvedValue('flow-1'),
      run: vi.fn().mockResolvedValue('REFUNDED'),
    };
    const { service, transaction, recordInTransaction, continueAfterPayment } = setup(
      BookingStatus.EXPIRED,
      [[], [{ id: 'late-payment' }]],
      latePayments,
    );

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: false } });
    expect(latePayments.start).toHaveBeenCalledWith(transaction, context, {
      bookingId: 'booking-1',
      orderId: 'order-1',
      amount: '110.00',
      currency: 'EUR',
      bookingStatusAtPayment: BookingStatus.EXPIRED,
    });
    expect(latePayments.run).toHaveBeenCalledWith(context, 'flow-1');
    expect(recordInTransaction).not.toHaveBeenCalled();
    expect(continueAfterPayment).not.toHaveBeenCalled();
  });

  it('still answers the webhook when running the flow throws; the worker finishes it', async () => {
    const latePayments = {
      start: vi.fn().mockResolvedValue('flow-1'),
      run: vi.fn().mockRejectedValue(new Error('PokPay timed out')),
    };
    const { service } = setup(
      BookingStatus.CANCELLED,
      [[], [{ id: 'late-payment' }]],
      latePayments,
    );

    await expect(service.processAuthoritativeOrder('order-1')).resolves.toEqual({
      ok: true,
      value: { duplicate: false },
    });
  });

  it('records nothing new and raises no second item when the same order is delivered again', async () => {
    const { service, continueAfterPayment, sendAfterConfirmation, recordInTransaction } = setup(
      BookingStatus.EXPIRED,
      [[], []],
    );

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: true } });
    expect(recordInTransaction).not.toHaveBeenCalled();
    expect(continueAfterPayment).not.toHaveBeenCalled();
    expect(sendAfterConfirmation).not.toHaveBeenCalled();
  });

  it('records a second order paid on a confirmed booking and raises one review item', async () => {
    const { service, continueAfterPayment, sendAfterConfirmation, recordInTransaction } = setup(
      BookingStatus.CONFIRMED,
      [[], [{ id: 'second-payment' }]],
    );

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: false } });
    expect(recordInTransaction).toHaveBeenCalledTimes(1);
    expect(continueAfterPayment).not.toHaveBeenCalled();
    expect(sendAfterConfirmation).not.toHaveBeenCalled();
  });

  it('still confirms a PAYMENT_PENDING booking the normal way with no review item', async () => {
    const { service, continueAfterPayment, sendAfterConfirmation, recordInTransaction } = setup(
      BookingStatus.PAYMENT_PENDING,
      [[{ id: 'payment-1' }]],
    );

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: false } });
    expect(continueAfterPayment).toHaveBeenCalledTimes(1);
    expect(sendAfterConfirmation).toHaveBeenCalledTimes(1);
    expect(recordInTransaction).not.toHaveBeenCalled();
  });
});
