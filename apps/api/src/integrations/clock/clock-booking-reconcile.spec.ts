import { describe, expect, it, vi } from 'vitest';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { ClockBookingService } from './clock-booking.service';
import type { ClockConnectionCredentials } from './clock-http-client';

const credentials: ClockConnectionCredentials = {
  host: 'clock.example.test',
  accountId: 'account-1',
  subscriptionId: 'subscription-1',
  apiUser: 'api-user',
  apiKey: 'api-key',
};
const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

type FetchInput = { method: string; path: string; query?: Record<string, string> };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  roomTypeId: 'local-room-type',
  roomId: 'local-room',
  guestId: 'guest-1',
  startsOn: '2027-01-20',
  endsOn: '2027-01-22',
  status: BookingStatus.PMS_CREATION_PENDING,
  paymentMethod: BookingPaymentMethod.POKPAY,
  externalReference: 'MH-1',
  externalBookingId: null,
  adults: 2,
  children: 0,
  childrenAges: null,
  clockRateId: '803405',
  roomGuestFirstName: null,
  roomGuestLastName: null,
  ...overrides,
});

/** A transaction whose guest query answers and whose "who holds this Clock id" query answers `holders`. */
function transaction(holders: Array<{ id: string; externalReference: string }> = []) {
  const executed: string[] = [];
  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('').includes('external_booking_id =')
          ? holders
          : [{ email: 'guest@example.test', firstName: 'Test', lastName: 'Guest' }],
      ),
    ),
    $executeRaw: vi.fn((strings: TemplateStringsArray) => {
      executed.push(strings.join('?').replace(/\s+/g, ' ').trim());
      return Promise.resolve(1);
    }),
  };
  return { tx, executed };
}

function service(fetchImpl: (input: FetchInput) => unknown, bookingRow = row()) {
  const instance = Object.create(ClockBookingService.prototype) as ClockBookingService;
  const internals = instance as unknown as Record<string, unknown>;
  const fetch = vi.fn((_credentials: unknown, input: FetchInput) =>
    Promise.resolve(fetchImpl(input)),
  );
  Object.assign(internals, {
    fetch,
    credentials: vi.fn().mockResolvedValue({ ok: true, value: credentials }),
    bookingById: vi.fn().mockResolvedValue(bookingRow),
    mappedExternalId: vi.fn().mockResolvedValue('101'),
    rateIdForRoomType: vi.fn().mockResolvedValue({ ok: true, value: '803405' }),
    mappedClockGuest: vi.fn().mockResolvedValue(null),
    clockGuestForBooking: vi.fn().mockResolvedValue({ ok: true, value: null }),
    rememberClockGuest: vi.fn().mockResolvedValue(undefined),
    applyRateGuaranteePolicy: vi.fn().mockResolvedValue(undefined),
    transition: vi.fn().mockResolvedValue(BookingStatus.CONFIRMED),
    toBooking: vi.fn().mockReturnValue({ id: 'booking-1' }),
    manualReview: { recordInTransaction: vi.fn().mockResolvedValue(undefined) },
    audit: { recordInTransaction: vi.fn().mockResolvedValue(undefined) },
  });
  return { instance, internals, fetch };
}

const isLookup = (input: FetchInput) =>
  input.method === 'GET' && input.path === '/bookings/' && Boolean(input.query?.reference_number);
const ours = { id: 39177444, status: 'expected', reference_number: 'MH-1' };

describe('ClockBookingService reconciling with Clock by our own reference', () => {
  it('links a reservation Clock already holds for the booking instead of creating a second one', async () => {
    const { instance, internals, fetch } = service((input) =>
      isLookup(input) ? { ok: true, value: [ours] } : { ok: false },
    );
    const { tx, executed } = transaction();

    await expect(
      instance.attachRealReservation(tx as never, context, 'booking-1'),
    ).resolves.toEqual({ ok: true, value: { id: 'booking-1' } });

    expect(fetch.mock.calls.some(([, input]) => input.method === 'POST')).toBe(false);
    expect(executed.some((sql) => sql.includes('SET external_booking_id'))).toBe(true);
    expect(internals.transition).toHaveBeenCalledWith(
      tx,
      context,
      'booking-1',
      BookingStatus.PMS_CONFIRMATION_PENDING,
      BookingStatus.CONFIRMED,
    );
  });

  it.each(['clock_validation', 'clock_conflict', 'clock_unknown'])(
    'searches Clock by reference after a %s refusal and links our reservation instead of failing a paid booking',
    async (code) => {
      let lookups = 0;
      const { instance, internals, fetch } = service((input) => {
        if (isLookup(input)) return { ok: true, value: ++lookups === 1 ? [] : [ours] };
        return {
          ok: false,
          error: {
            category: 'validation',
            code,
            message: 'The room is occupied by another booking.',
            retryable: false,
          },
        };
      });
      const { tx } = transaction();

      await expect(
        instance.attachRealReservation(tx as never, context, 'booking-1'),
      ).resolves.toEqual({ ok: true, value: { id: 'booking-1' } });

      expect(fetch.mock.calls.filter(([, input]) => input.method === 'POST')).toHaveLength(1);
      expect(lookups).toBe(2);
      expect(
        (internals.manualReview as { recordInTransaction: ReturnType<typeof vi.fn> })
          .recordInTransaction,
      ).not.toHaveBeenCalled();
      expect(internals.transition).not.toHaveBeenCalledWith(
        tx,
        context,
        'booking-1',
        BookingStatus.PMS_CREATION_PENDING,
        BookingStatus.PMS_UNKNOWN_RESULT,
      );
    },
  );

  it('still hands a paid booking to staff when Clock really has no reservation of ours', async () => {
    const { instance, internals } = service((input) =>
      isLookup(input)
        ? { ok: true, value: [] }
        : {
            ok: false,
            error: {
              category: 'validation',
              code: 'clock_validation',
              message: 'The room is occupied by another booking.',
              retryable: false,
            },
          },
    );
    const { tx } = transaction();

    const result = await instance.attachRealReservation(tx as never, context, 'booking-1');

    expect(result.ok).toBe(false);
    expect(internals.transition).toHaveBeenCalledWith(
      tx,
      context,
      'booking-1',
      BookingStatus.PMS_CREATION_PENDING,
      BookingStatus.PMS_UNKNOWN_RESULT,
    );
    expect(
      (internals.manualReview as { recordInTransaction: ReturnType<typeof vi.fn> })
        .recordInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ category: 'UNKNOWN_RESULT', referenceId: 'booking-1' }),
    );
  });

  it('finishes a booking the Clock sync already linked while its payment step was still running', async () => {
    const { instance, internals, fetch } = service(
      () => ({ ok: false }),
      row({ externalBookingId: '39177444' }),
    );
    const { tx } = transaction();

    await expect(
      instance.attachRealReservation(tx as never, context, 'booking-1'),
    ).resolves.toEqual({ ok: true, value: { id: 'booking-1' } });

    expect(fetch).not.toHaveBeenCalled();
    expect(internals.transition).toHaveBeenCalledWith(
      tx,
      context,
      'booking-1',
      BookingStatus.PMS_CONFIRMATION_PENDING,
      BookingStatus.CONFIRMED,
    );
  });

  it('ignores a reservation that is not exactly ours or is cancelled', async () => {
    const { instance, internals } = service(() => ({
      ok: true,
      value: [
        { id: 1, status: 'expected', reference_number: 'MH-10' },
        { id: 2, status: 'canceled', reference_number: 'MH-1' },
        { id: 3, status: 'expected', reference_number: null },
      ],
    }));
    const { tx, executed } = transaction();
    const link = (
      internals as unknown as {
        linkIfClockHasIt: (...args: unknown[]) => Promise<unknown>;
      }
    ).linkIfClockHasIt.bind(instance);

    await expect(link(tx, context, credentials, 'booking-1', 'MH-1')).resolves.toBeNull();
    expect(executed).toEqual([]);
  });
});

describe('ClockBookingService merging a booking the sync imported on its own', () => {
  it('moves what hangs off the imported copy onto the real booking and removes the copy', async () => {
    const { instance, internals } = service(() => ({ ok: true, value: [ours] }));
    const { tx, executed } = transaction([{ id: 'imported-1', externalReference: 'CLOCK-1234' }]);

    await expect(
      (
        internals as unknown as {
          linkIfClockHasIt: (...args: unknown[]) => Promise<unknown>;
        }
      ).linkIfClockHasIt.call(instance, tx, context, credentials, 'booking-1', 'MH-1'),
    ).resolves.toEqual({ id: 'booking-1' });

    const order = ['UPDATE clock_folios', 'UPDATE booking_requests', 'UPDATE guest_reviews'].map(
      (prefix) => executed.findIndex((sql) => sql.startsWith(prefix)),
    );
    const remove = executed.findIndex((sql) => sql.startsWith('DELETE FROM bookings'));
    const link = executed.findIndex((sql) => sql.includes('SET external_booking_id'));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(remove).toBeGreaterThan(Math.max(...order));
    expect(link).toBeGreaterThan(remove);
  });

  it('never touches a booking that MUST made itself', async () => {
    const { instance, internals } = service(() => ({ ok: true, value: [ours] }));
    const { tx, executed } = transaction([{ id: 'other', externalReference: 'MH-OTHER' }]);

    await expect(
      (
        internals as unknown as {
          linkIfClockHasIt: (...args: unknown[]) => Promise<unknown>;
        }
      ).linkIfClockHasIt.call(instance, tx, context, credentials, 'booking-1', 'MH-1'),
    ).resolves.toBeNull();
    expect(executed).toEqual([]);
  });
});
