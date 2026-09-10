import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = { tenantId: '11111111-1111-4111-8111-111111111111', propertyId: '22222222-2222-4222-8222-222222222222' };
const bookingId = '33333333-3333-4333-8333-333333333333';

describe('PaymentRefundService manual Clock synchronization', () => {
  it('keeps the manual refund successful when Clock sync returns a manual-review failure', async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ requestHash: 'request-hash' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'charge-row',
            provider: 'stripe',
            externalPaymentId: 'cs_test_charge',
            amount: '100.00',
            currency: 'EUR',
            status: 'PAID',
          },
        ])
        .mockResolvedValueOnce([{ amount: '0' }])
        .mockResolvedValueOnce([{ id: 'refund-row' }])
        .mockResolvedValueOnce([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const database = {
      withTenantTransaction: vi.fn(async (_context, execute) => execute(tx)),
    };
    const paymentProvider = {
      refund: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          id: 're_test_refund',
          bookingId,
          amount: { amount: '25.50', currency: 'EUR' },
          status: 'succeeded',
        },
      }),
    };
    const paymentProviders = { forProvider: vi.fn().mockReturnValue(paymentProvider) };
    const clockBooking = {
      postRefund: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'clock_original_deposit_missing',
          message: 'Original deposit was not found.',
          retryable: false,
        },
      }),
    };
    const service = new PaymentRefundService(
      database as never,
      { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
      paymentProviders as never,
      { sendRefundConfirmationEmailSafely: vi.fn().mockResolvedValue(undefined) } as never,
      { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
      clockBooking as never,
      { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.manualRefund(context, {
        bookingId,
        idempotencyKey: 'manual-refund-1',
        amount: { amount: '25.50', currency: 'EUR' },
        actorUserId: '44444444-4444-4444-8444-444444444444',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: 're_test_refund', amount: { amount: '25.50', currency: 'EUR' } },
    });

    expect(clockBooking.postRefund).toHaveBeenCalledWith(
      tx,
      context,
      bookingId,
      { amount: '25.50', currency: 'EUR' },
      'must-refund:re_test_refund',
    );
  });
});
