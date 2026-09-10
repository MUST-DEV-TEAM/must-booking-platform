import { describe, expect, it, vi } from 'vitest';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { PokPayPaymentService } from './pokpay-payment.service';

describe('PokPayPaymentService duplicate recovery', () => {
  it('retries an unfinished Clock continuation for a paid booking still in PMS_CREATION_PENDING', async () => {
    const booking = {
      id: 'booking-1',
      totalAmount: '110.00',
      currency: 'EUR',
      status: BookingStatus.PMS_CREATION_PENDING,
      paymentMethod: BookingPaymentMethod.POKPAY,
    };
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([booking])
        .mockResolvedValueOnce([{ id: 'payment-1' }]),
    };
    const continueAfterPayment = vi.fn().mockResolvedValue({
      ok: true,
      value: { id: 'booking-1' },
    });
    const service = new PokPayPaymentService(
      {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([
            { bookingId: 'booking-1', tenantId: 'tenant-1', propertyId: 'property-1' },
          ]),
        withTenantTransaction: vi.fn(async (_context, callback) => callback(transaction)),
      } as never,
      { continueAfterPayment } as never,
      {
        pokpay: {
          getPayment: vi.fn().mockResolvedValue({
            id: 'order-1',
            status: 'PAID',
            amount: { amount: '110.00', currency: 'EUR' },
          }),
        },
      } as never,
      { sendAfterConfirmation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.processAuthoritativeOrder('order-1');

    expect(result).toEqual({ ok: true, value: { duplicate: true } });
    expect(continueAfterPayment).toHaveBeenCalledWith(
      transaction,
      { tenantId: 'tenant-1', propertyId: 'property-1' },
      'booking-1',
    );
  });
});
