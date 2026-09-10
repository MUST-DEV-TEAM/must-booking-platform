import { describe, expect, it, vi } from 'vitest';

import { BookingPaymentMethod } from '@must/domain-contracts';

import { ClockBookingService } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

type PostRefund = (
  tx: unknown,
  context: { tenantId: string; propertyId: string },
  bookingId: string,
  amount: { amount: string; currency: string },
  refundReference: string,
) => Promise<unknown>;

type PostCreditItem = (
  credentials: ClockConnectionCredentials,
  folioId: number,
  amount: { amount: string; currency: string },
  paymentSubType: string,
  reference: string,
  kind?: 'payment' | 'refund',
) => Promise<unknown>;

type DepositFolioWithPaymentReference = (
  credentials: ClockConnectionCredentials,
  externalBookingId: string,
  paymentReference: string,
) => Promise<unknown>;

type CreditItemByReference = (
  credentials: ClockConnectionCredentials,
  folioId: number,
  reference: string,
) => Promise<unknown>;

const postRefund = (ClockBookingService.prototype as unknown as { postRefund: PostRefund }).postRefund;
const postCreditItem = (ClockBookingService.prototype as unknown as {
  postCreditItem: PostCreditItem;
}).postCreditItem;
const depositFolioWithPaymentReference = (ClockBookingService.prototype as unknown as {
  depositFolioWithPaymentReference: DepositFolioWithPaymentReference;
}).depositFolioWithPaymentReference;
const creditItemByReference = (ClockBookingService.prototype as unknown as {
  creditItemByReference: CreditItemByReference;
}).creditItemByReference;

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

function serviceForRefund() {
  const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const internals = service as unknown as Record<string, unknown>;
  internals.bookingById = vi.fn().mockResolvedValue({
    externalBookingId: '1234',
    externalReference: 'MUST-ORIGINAL-1',
    paymentMethod: BookingPaymentMethod.POKPAY,
  });
  internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
  internals.depositFolioWithPaymentReference = vi.fn().mockResolvedValue({
    ok: true,
    value: { folio: { id: 77, deposit: true, closed_at: '2026-09-10T00:00:00Z' }, creditItem: { id: 11, payment_sub_type: 'PokPay' } },
  });
  internals.creditItemByReference = vi.fn().mockResolvedValue({ ok: true, value: null });
  internals.postCreditItem = vi.fn().mockResolvedValue({ ok: true, value: { id: 88 } });
  internals.withRetry = vi.fn(async (attempt: () => Promise<unknown>) => attempt());
  internals.manualReview = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  internals.notifications = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  internals.audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return {
    service,
    depositFolioWithPaymentReference: internals.depositFolioWithPaymentReference as ReturnType<typeof vi.fn>,
    creditItemByReference: internals.creditItemByReference as ReturnType<typeof vi.fn>,
    postCreditItem: internals.postCreditItem as ReturnType<typeof vi.fn>,
    manualReview: internals.manualReview as { recordInTransaction: ReturnType<typeof vi.fn> },
    notifications: internals.notifications as { recordInTransaction: ReturnType<typeof vi.fn> },
    audit: internals.audit as { recordInTransaction: ReturnType<typeof vi.fn> },
  };
}

describe('ClockBookingService.postRefund', () => {
  it('posts the documented negative payment on the original deposit folio and flags the Deposit Adjustment', async () => {
    const { service, depositFolioWithPaymentReference, postCreditItem, manualReview, notifications, audit } =
      serviceForRefund();

    await expect(
      postRefund.call(service, {}, context, 'booking-1', { amount: '25.50', currency: 'EUR' }, 'must-refund:re_1'),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(depositFolioWithPaymentReference).toHaveBeenCalledWith(
      credentials,
      '1234',
      'MUST-ORIGINAL-1',
    );
    expect(postCreditItem).toHaveBeenCalledWith(
      credentials,
      77,
      { amount: '-25.50', currency: 'EUR' },
      'PokPay',
      'must-refund:re_1',
      'refund',
    );
    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceId: 'booking-1',
        message:
          'Clock refund payment was posted. In Clock, issue the Deposit Adjustment to create the required correction document.',
      }),
    );
    expect(notifications.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        payload: { bookingId: 'booking-1', reason: 'clock_refund_deposit_adjustment_required' },
      }),
    );
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'payment.clock_refund_posted' }),
    );
  });

  it('does not create a second Clock payment when the refund reference already exists', async () => {
    const { service, creditItemByReference, postCreditItem, manualReview, audit } = serviceForRefund();
    creditItemByReference.mockResolvedValue({ ok: true, value: { id: 99 } });

    await expect(
      postRefund.call(service, {}, context, 'booking-1', { amount: '25.50', currency: 'EUR' }, 'must-refund:re_1'),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(postCreditItem).not.toHaveBeenCalled();
    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ context: expect.objectContaining({ idempotentReplay: true }) }),
    );
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ details: expect.objectContaining({ idempotentReplay: true }) }),
    );
  });

  it('flags a missing original deposit folio without claiming the gateway refund failed', async () => {
    const { service, depositFolioWithPaymentReference, manualReview, notifications } = serviceForRefund();
    depositFolioWithPaymentReference.mockResolvedValue({
      ok: false,
      error: {
        code: 'clock_original_deposit_missing',
        message: 'Clock has no deposit folio containing MUST\'s original payment reference.',
        retryable: false,
      },
    });

    await expect(
      postRefund.call(service, {}, context, 'booking-1', { amount: '25.50', currency: 'EUR' }, 'must-refund:re_1'),
    ).resolves.toMatchObject({ ok: false, error: { code: 'clock_original_deposit_missing' } });

    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        message: expect.stringContaining("MUST refunded the guest, but Clock's original deposit folio could not be found"),
      }),
    );
    expect(notifications.recordInTransaction).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        payload: {
          bookingId: 'booking-1',
          reason: 'clock_refund_sync_failed',
          errorCode: 'clock_original_deposit_missing',
        },
      }),
    );
  });
});

describe('ClockBookingService credit-item refund payload', () => {
  it('sends the negative amount and refund description to Clock', async () => {
    const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
    const internals = service as unknown as Record<string, unknown>;
    const fetch = vi.fn().mockResolvedValue({ ok: true, value: { id: 88 } });
    internals.creditItemByReference = vi.fn().mockResolvedValue({ ok: true, value: null });
    internals.fetch = fetch;

    await expect(
      postCreditItem.call(
        service,
        credentials,
        77,
        { amount: '-25.50', currency: 'EUR' },
        'PokPay',
        'must-refund:re_1',
        'refund',
      ),
    ).resolves.toEqual({ ok: true, value: { id: 88 } });

    expect(fetch).toHaveBeenCalledWith(
      credentials,
      {
        method: 'POST',
        path: '/folios/77/credit_items',
        api: 'base_api',
        body: {
          credit_item: {
            payment_type: 'on-line',
            payment_sub_type: 'PokPay',
            text: 'Website booking refund via PokPay',
            value: '-25.50',
            currency: 'EUR',
            reference: 'must-refund:re_1',
          },
        },
      },
    );
  });
});

describe('ClockBookingService original deposit-folio lookup', () => {
  it('skips non-deposit folios and finds the original payment by its MUST reference', async () => {
    const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
    const internals = service as unknown as Record<string, unknown>;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [44, 77] })
      .mockResolvedValueOnce({ ok: true, value: { id: 44, deposit: false } })
      .mockResolvedValueOnce({
        ok: true,
        value: { id: 77, deposit: true, closed_at: '2026-09-10T00:00:00Z' },
      });
    const creditItemByReference = vi.fn().mockResolvedValue({
      ok: true,
      value: { id: 11, reference: 'MUST-ORIGINAL-1', payment_sub_type: 'PokPay' },
    });
    internals.fetch = fetch;
    internals.creditItemByReference = creditItemByReference;

    await expect(
      depositFolioWithPaymentReference.call(service, credentials, '1234', 'MUST-ORIGINAL-1'),
    ).resolves.toEqual({
      ok: true,
      value: {
        folio: { id: 77, deposit: true, closed_at: '2026-09-10T00:00:00Z' },
        creditItem: { id: 11, reference: 'MUST-ORIGINAL-1', payment_sub_type: 'PokPay' },
      },
    });

    expect(fetch.mock.calls.map(([, options]) => options)).toEqual([
      { method: 'GET', path: '/bookings/1234/folios/', api: 'pms_api' },
      { method: 'GET', path: '/folios/44', api: 'base_api' },
      { method: 'GET', path: '/folios/77', api: 'base_api' },
    ]);
    expect(creditItemByReference).toHaveBeenCalledWith(credentials, 77, 'MUST-ORIGINAL-1');
  });
});

describe('ClockBookingService credit-item reference lookup', () => {
  it('lists the folio credit items and exact-matches the reference client-side', async () => {
    const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
    const internals = service as unknown as Record<string, unknown>;
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: 11, reference: 'MUST-ORIGINAL-1' },
        { id: 12, reference: 'must-refund:re_1' },
      ],
    });
    internals.fetch = fetch;

    await expect(
      creditItemByReference.call(service, credentials, 77, 'must-refund:re_1'),
    ).resolves.toEqual({ ok: true, value: { id: 12, reference: 'must-refund:re_1' } });
    expect(fetch).toHaveBeenCalledWith(credentials, {
      method: 'GET',
      path: '/folios/77/credit_items',
      api: 'base_api',
    });
  });
});
