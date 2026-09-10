import { describe, expect, it, vi } from 'vitest';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { ClockBookingService } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

type RateIdForRoomType = (
  credentials: ClockConnectionCredentials,
  context: { tenantId: string; propertyId: string },
  roomTypeId: string,
  externalRoomTypeId: string,
  startsOn: string,
  endsOn: string,
  adultCount: number,
  childrenCount: number,
) => Promise<
  | { ok: true; value: string }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }
>;

const rateIdForRoomType = (
  ClockBookingService.prototype as unknown as { rateIdForRoomType: RateIdForRoomType }
).rateIdForRoomType;

const recordPostCommitFailure = (
  ClockBookingService.prototype as unknown as {
    recordPostCommitFailure: (
      tx: unknown,
      context: { tenantId: string; propertyId: string },
      bookingId: string,
      details: {
        category: 'UNKNOWN_RESULT';
        message: string;
        context?: unknown;
        notify?: boolean;
      },
    ) => Promise<void>;
  }
).recordPostCommitFailure;

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

describe('ClockBookingService Task 14 rate delegation', () => {
  it('delegates booking rate selection to the shared availability selector with the real stay data', async () => {
    const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
    const selectRateForStay = vi.fn().mockResolvedValue({
      ok: true,
      value: { rateId: '803405', total: { amount: '325.00', currency: 'EUR' } },
    });
    (service as unknown as { availability: unknown }).availability = { selectRateForStay };

    await expect(
      rateIdForRoomType.call(
        service,
        credentials,
        context,
        'local-room-type',
        '42023',
        '2027-07-10',
        '2027-07-12',
        2,
        1,
      ),
    ).resolves.toEqual({ ok: true, value: '803405' });
    expect(selectRateForStay).toHaveBeenCalledWith(credentials, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      roomTypeId: 'local-room-type',
      externalRoomTypeId: '42023',
      startsOn: '2027-07-10',
      endsOn: '2027-07-12',
      adultCount: 2,
      childrenCount: 1,
    });
  });

  it('records the manual-review item and staff notification for a post-commit failure', async () => {
    const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
    const manualReview = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    const notifications = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    (service as unknown as { manualReview: unknown }).manualReview = manualReview;
    (service as unknown as { notifications: unknown }).notifications = notifications;

    await recordPostCommitFailure.call(service, {}, context, 'booking-1', {
      category: 'UNKNOWN_RESULT',
      message: 'Clock rate selection failed.',
      context: { errorCode: 'clock_configuration' },
    });

    expect(manualReview.recordInTransaction).toHaveBeenCalledWith(
      {},
      {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        category: 'UNKNOWN_RESULT',
        referenceType: 'booking',
        referenceId: 'booking-1',
        message: 'Clock rate selection failed.',
        context: { errorCode: 'clock_configuration' },
      },
    );
    expect(notifications.recordInTransaction).toHaveBeenCalledWith(
      {},
      {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        type: 'BOOKING_NEEDS_ATTENTION',
        payload: { bookingId: 'booking-1', reason: 'clock_booking_creation_failed' },
      },
    );
  });
});

describe('ClockBookingService.attachRealReservation Task 14 failure handling', () => {
  it('does not hard-fail a paid multi-rate booking before the shared selector is called', async () => {
    const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
    const internals = service as unknown as Record<string, unknown>;
    internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
    internals.bookingById = vi.fn().mockResolvedValue({
      id: 'booking-1',
      roomTypeId: 'local-room-type',
      roomId: null,
      guestId: 'guest-1',
      startsOn: '2027-07-10',
      endsOn: '2027-07-12',
      status: BookingStatus.PMS_CREATION_PENDING,
      paymentMethod: BookingPaymentMethod.POKPAY,
      externalReference: 'MUST-BOOKING-1',
      externalBookingId: null,
      adults: 2,
      children: 1,
    });
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValue([{ email: 'guest@example.test', firstName: 'Guest', lastName: 'Test' }]),
    };
    internals.mappedExternalId = vi.fn().mockResolvedValue('42023');
    internals.rateIdForRoomType = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'clock_rate_limited', message: 'Rate limited', retryable: true },
    });
    internals.transition = vi.fn().mockResolvedValue(BookingStatus.PMS_UNKNOWN_RESULT);
    internals.recordPostCommitFailure = vi.fn().mockResolvedValue(undefined);

    const result = await service.attachRealReservation(tx as never, context, 'booking-1');

    expect(result).toEqual({
      ok: false,
      error: { code: 'clock_rate_limited', message: 'Rate limited', retryable: true },
    });
    expect(internals.rateIdForRoomType).toHaveBeenCalledWith(
      credentials,
      context,
      'local-room-type',
      '42023',
      '2027-07-10',
      '2027-07-12',
      2,
      1,
    );
    expect(internals.recordPostCommitFailure).toHaveBeenCalledWith(
      tx,
      context,
      'booking-1',
      expect.objectContaining({ category: 'UNKNOWN_RESULT', notify: false }),
    );
  });
});
