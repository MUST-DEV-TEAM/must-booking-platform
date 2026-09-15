import { describe, expect, it, vi } from 'vitest';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { LocalPmsProvider } from './local-pms.provider';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const command = {
  idempotencyKey: 'clock-availability-test',
  roomTypeId: '33333333-3333-4333-8333-333333333333',
  roomId: '44444444-4444-4444-8444-444444444444',
  ratePlanId: '55555555-5555-4555-8555-555555555555',
  startsOn: '2026-12-05',
  endsOn: '2026-12-07',
  total: { amount: '200.00', currency: 'EUR' },
  adults: 2,
  children: 0,
  guestCount: 2,
  staffActorId: '66666666-6666-4666-8666-666666666666',
  skipQuoteValidation: true,
  guest: {
    email: 'guest@example.test',
    firstName: 'Clock',
    lastName: 'Test',
    phone: '+355690000000',
  },
};

function makeProvider(options: { clockConnected: boolean; clockAvailable: boolean }) {
  let rolledBack = false;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: '77777777-7777-4777-8777-777777777777' }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const database = {
    withTenantTransaction: vi.fn(async (_context, callback) => {
      try {
        return await callback(tx);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }),
  };
  const availability = {
    lockRoom: vi.fn(),
    lockBookedUnits: vi.fn(),
    reserveRoom: vi.fn().mockResolvedValue(true),
    reserveBookedUnits: vi.fn().mockResolvedValue(true),
  };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue(
        options.clockConnected ? { provider: 'CLOCK_PMS' } : { provider: 'LOCAL' },
      ),
  };
  const clockAvailability = {
    isAvailableForBooking: vi.fn().mockResolvedValue({ ok: true, value: options.clockAvailable }),
  };
  const checkout = { id: 'checkout-1', url: 'https://payments.example.test/checkout-1' };
  const paymentProviders = {
    forBookingMethod: vi.fn().mockReturnValue({
      createCheckoutSession: vi.fn().mockResolvedValue({ ok: true, value: checkout }),
    }),
  };
  const provider = new LocalPmsProvider(
    database as never,
    availability as never,
    { recordInTransaction: vi.fn() } as never,
    {} as never,
    {} as never,
    paymentProviders as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { recordInTransaction: vi.fn() } as never,
    connections as never,
    {} as never,
    {} as never,
    clockAvailability as never,
  );

  // Isolate the guard's transactional position: all preceding validations have
  // their own unit coverage, and these replacements let this test assert the
  // reservation rollback rather than emulate unrelated SQL internals.
  Object.assign(provider as object, {
    withIdempotency: async (
      _tx: unknown,
      _context: unknown,
      _key: unknown,
      _request: unknown,
      _aggregate: unknown,
      _reference: unknown,
      execute: () => unknown,
    ) => execute(),
    validateCatalog: async () => null,
    validateRoomSelection: async () => ({ autoAssign: false }),
    paymentMethod: async () => ({ ok: true, value: BookingPaymentMethod.STRIPE_CHECKOUT }),
    resolveGuest: async () => ({ ok: true, value: '88888888-8888-4888-8888-888888888888' }),
    generatedExternalReference: async () => 'MUST-test',
    validatedGuestReturnUrl: async () => null,
    transition: async (
      _tx: unknown,
      _context: unknown,
      _bookingId: unknown,
      _from: unknown,
      to: unknown,
    ) => to,
    bookingById: async () => ({
      id: '77777777-7777-4777-8777-777777777777',
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      roomTypeId: command.roomTypeId,
      roomId: command.roomId,
      guestId: '88888888-8888-4888-8888-888888888888',
      guestSessionId: null,
      ratePlanId: command.ratePlanId,
      startsOn: command.startsOn,
      endsOn: command.endsOn,
      status: BookingStatus.PAYMENT_PENDING,
      paymentMethod: BookingPaymentMethod.STRIPE_CHECKOUT,
      totalAmount: '200.00',
      adults: 2,
      children: 0,
      currency: 'EUR',
      nightlyRates: [],
      externalReference: 'MUST-test',
      orderReference: null,
      externalBookingId: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  });
  return {
    provider,
    availability,
    clockAvailability,
    paymentProviders,
    get rolledBack() {
      return rolledBack;
    },
  };
}

describe('LocalPmsProvider pre-payment Clock availability', () => {
  it('rejects a Clock room conflict and rolls back the already-taken local reservation', async () => {
    const fixture = makeProvider({ clockConnected: true, clockAvailable: false });

    await expect(fixture.provider.createBooking(context, command)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AVAILABILITY_FAILED' },
    });
    expect(fixture.availability.reserveRoom).toHaveBeenCalledOnce();
    expect(fixture.clockAvailability.isAvailableForBooking).toHaveBeenCalledOnce();
    expect(fixture.paymentProviders.forBookingMethod).not.toHaveBeenCalled();
    expect(fixture.rolledBack).toBe(true);
  });

  it('creates checkout normally when the selected Clock room is available', async () => {
    const fixture = makeProvider({ clockConnected: true, clockAvailable: true });

    await expect(fixture.provider.createBooking(context, command)).resolves.toMatchObject({
      ok: true,
      value: { checkoutUrl: 'https://payments.example.test/checkout-1' },
    });
    expect(fixture.clockAvailability.isAvailableForBooking).toHaveBeenCalledOnce();
    expect(fixture.paymentProviders.forBookingMethod).toHaveBeenCalledWith(
      BookingPaymentMethod.STRIPE_CHECKOUT,
    );
    expect(fixture.rolledBack).toBe(false);
  });

  it('does not call Clock for a non-Clock-connected property', async () => {
    const fixture = makeProvider({ clockConnected: false, clockAvailable: false });

    await expect(fixture.provider.createBooking(context, command)).resolves.toMatchObject({
      ok: true,
    });
    expect(fixture.clockAvailability.isAvailableForBooking).not.toHaveBeenCalled();
    expect(fixture.paymentProviders.forBookingMethod).toHaveBeenCalledOnce();
  });
});
