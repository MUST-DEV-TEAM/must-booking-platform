import { describe, expect, it, vi } from 'vitest';
import type { CreateBookingCommand } from '@must/domain-contracts';

import { ClockBookingService } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

type ClockOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

type ClockGuestMatcher = (
  credentials: ClockConnectionCredentials,
  email: string,
) => Promise<ClockOutcome<string | null>>;

type ClockFetch = (
  credentials: ClockConnectionCredentials,
  options: {
    method: 'GET' | 'POST';
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  },
) => Promise<ClockOutcome<unknown>>;

const clockGuestForBooking = (
  ClockBookingService.prototype as unknown as { clockGuestForBooking: ClockGuestMatcher }
).clockGuestForBooking;

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};

function serviceWithClockResponses(...responses: ClockOutcome<unknown>[]) {
  const service = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const fetch = vi.fn<ClockFetch>();
  fetch.mockImplementation(async () => responses.shift()!);
  (service as unknown as { fetch: ClockFetch }).fetch = fetch;
  return { service, fetch };
}

describe('ClockBookingService Clock guest search', () => {
  it('filters fuzzy responses and normalizes the exact email match', async () => {
    const { service, fetch } = serviceWithClockResponses({
      ok: true,
      value: [
        { family_id: 7, e_mail: 'someone-else@example.test' },
        { family_id: 42, e_mail: ' Returning@Example.Test ' },
      ],
    });

    await expect(
      clockGuestForBooking.call(service, credentials, ' Returning@Example.Test '),
    ).resolves.toEqual({ ok: true, value: '42' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toEqual({
      method: 'GET',
      path: '/guests/search',
      query: { free_text_search: 'Returning@Example.Test' },
    });
  });

  it('uses the email match without a phone lookup', async () => {
    const { service, fetch } = serviceWithClockResponses({
      ok: true,
      value: [{ family_id: 42, e_mail: 'guest@example.test' }],
    });

    await expect(
      clockGuestForBooking.call(service, credentials, 'guest@example.test'),
    ).resolves.toEqual({ ok: true, value: '42' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses main_booking_guest on attach for an email-only match', async () => {
    const { service, fetch } = serviceWithClockResponses(
      { ok: true, value: [{ family_id: 42, e_mail: 'guest@example.test' }] },
      { ok: true, value: { id: 1234, lock_version: 0, status: 'expected' } },
    );
    const bookingId = 'booking-1';
    const row = {
      id: bookingId,
      externalBookingId: null,
      guestId: 'guest-1',
      roomTypeId: 'room-type-1',
      roomId: null,
      startsOn: '2026-10-01',
      endsOn: '2026-10-03',
      externalReference: 'MUST-1',
      adults: 2,
      children: 1,
      roomGuestFirstName: null,
      roomGuestLastName: null,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          email: 'guest@example.test',
          firstName: 'Test',
          lastName: 'Guest',
        },
      ]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const internals = service as unknown as Record<string, unknown>;
    internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
    internals.bookingById = vi.fn().mockResolvedValue(row);
    internals.mappedExternalId = vi.fn().mockResolvedValue('101');
    internals.rateIdForRoomType = vi.fn().mockResolvedValue({ ok: true, value: '202' });
    internals.transition = vi.fn().mockResolvedValue('PMS_CONFIRMATION_PENDING');
    internals.toBooking = vi.fn().mockReturnValue({ id: bookingId });
    internals.audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };

    await expect(
      service.attachRealReservation(
        tx as never,
        { tenantId: 'tenant-1', propertyId: 'property-1' },
        bookingId,
      ),
    ).resolves.toMatchObject({ ok: true, value: { id: bookingId } });

    expect(fetch).toHaveBeenCalledTimes(2);
    const post = fetch.mock.calls[1]?.[1];
    expect(post).toMatchObject({
      method: 'POST',
      path: '/bookings/',
      body: {
        main_booking_guest: '42',
        booking: {
          arrival: '2026-10-01',
          departure: '2026-10-03',
          reference_number: 'MUST-1',
          adults: 2,
          children: 1,
        },
      },
    });
    expect((post?.body as { booking: Record<string, unknown> }).booking).not.toHaveProperty(
      'guest_e_mail',
    );
  });

  it('keeps inline guest fields when Clock has no corroborating match', async () => {
    const { service, fetch } = serviceWithClockResponses(
      { ok: true, value: [] },
      { ok: true, value: { id: 1234, lock_version: 0, status: 'expected' } },
    );
    const bookingId = 'booking-2';
    const row = {
      id: bookingId,
      externalBookingId: null,
      guestId: 'guest-2',
      roomTypeId: 'room-type-2',
      roomId: null,
      startsOn: '2026-10-01',
      endsOn: '2026-10-03',
      externalReference: 'MUST-2',
      adults: 1,
      children: 0,
      roomGuestFirstName: null,
      roomGuestLastName: null,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          email: 'new@example.test',
          firstName: 'New',
          lastName: 'Guest',
        },
      ]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const internals = service as unknown as Record<string, unknown>;
    internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
    internals.bookingById = vi.fn().mockResolvedValue(row);
    internals.mappedExternalId = vi.fn().mockResolvedValue('101');
    internals.rateIdForRoomType = vi.fn().mockResolvedValue({ ok: true, value: '202' });
    internals.transition = vi.fn().mockResolvedValue('PMS_CONFIRMATION_PENDING');
    internals.toBooking = vi.fn().mockReturnValue({ id: bookingId });
    internals.audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };

    await service.attachRealReservation(
      tx as never,
      { tenantId: 'tenant-1', propertyId: 'property-1' },
      bookingId,
    );

    const post = fetch.mock.calls[1]?.[1];
    expect(post?.body).toMatchObject({
      booking: {
        guest_e_mail: 'new@example.test',
        guest_first_name: 'New',
        guest_last_name: 'Guest',
        adults: 1,
        children: 0,
      },
    });
    expect(post?.body).not.toHaveProperty('main_booking_guest');
  });

  it('uses the same email-based attachment in the direct createBooking path', async () => {
    const { service, fetch } = serviceWithClockResponses(
      { ok: true, value: [{ family_id: 42, e_mail: 'guest@example.test' }] },
      { ok: true, value: { id: 1234, lock_version: 0, status: 'expected' } },
    );
    const bookingId = 'booking-3';
    const row = { id: bookingId, externalBookingId: '1234' };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: bookingId }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const internals = service as unknown as Record<string, unknown>;
    internals.credentials = vi.fn().mockResolvedValue({ ok: true, value: credentials });
    internals.database = {
      withTenantTransaction: vi.fn(async (...args: unknown[]) => {
        const callback = args[1] as (transaction: unknown) => Promise<unknown>;
        return callback(tx);
      }),
    };
    internals.withIdempotency = vi.fn(async (...args: unknown[]) => {
      const execute = args[5] as () => Promise<unknown>;
      return execute();
    });
    internals.mappedExternalId = vi.fn().mockResolvedValue('101');
    internals.rateIdForRoomType = vi.fn().mockResolvedValue({ ok: true, value: '202' });
    internals.resolveGuest = vi.fn().mockResolvedValue('guest-1');
    internals.audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
    internals.transition = vi.fn().mockResolvedValue('PMS_CONFIRMATION_PENDING');
    internals.bookingById = vi.fn().mockResolvedValue(row);
    internals.toBooking = vi.fn().mockReturnValue({ id: bookingId });

    const command = {
      idempotencyKey: 'create-key',
      externalReference: 'MUST-3',
      roomTypeId: 'room-type-3',
      ratePlanId: 'rate-plan-3',
      startsOn: '2026-10-01',
      endsOn: '2026-10-03',
      guest: {
        email: 'guest@example.test',
        firstName: 'Test',
        lastName: 'Guest',
        phone: '+355 69 123 4567',
      },
      total: { amount: '100.00', currency: 'EUR' },
      adults: 2,
      children: 1,
      guestCount: 99,
      paymentMethod: 'pay_at_hotel',
    } as CreateBookingCommand;

    await expect(
      service.createBooking({ tenantId: 'tenant-1', propertyId: 'property-1' }, command),
    ).resolves.toMatchObject({ ok: true, value: { id: bookingId } });

    expect(fetch).toHaveBeenCalledTimes(2);
    const post = fetch.mock.calls[1]?.[1];
    expect(post?.body).toMatchObject({
      main_booking_guest: '42',
      booking: {
        arrival: '2026-10-01',
        departure: '2026-10-03',
        reference_number: 'MUST-3',
        adults: 2,
        children: 1,
      },
    });
    expect((post?.body as { booking: Record<string, unknown> }).booking).not.toHaveProperty(
      'guest_e_mail',
    );
  });
});
