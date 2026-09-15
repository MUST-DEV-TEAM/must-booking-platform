import { describe, expect, it, vi } from 'vitest';

import { LocalPmsProvider } from './local-pms.provider';

type PrePaymentCheck = (
  this: {
    isClockConnected: (context: { tenantId: string; propertyId: string }) => Promise<boolean>;
    clockAvailability: {
      isAvailableForBooking: ReturnType<typeof vi.fn>;
    };
    failure: (code: string, message: string, retryable?: boolean) => unknown;
  },
  context: { tenantId: string; propertyId: string },
  command: {
    roomTypeId: string;
    roomId?: string;
    startsOn: string;
    endsOn: string;
  },
  occupancy: { adults: number; children: number },
) => Promise<unknown>;

const prePaymentClockAvailabilityFailure = (
  LocalPmsProvider.prototype as unknown as {
    prePaymentClockAvailabilityFailure: PrePaymentCheck;
  }
).prePaymentClockAvailabilityFailure;

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };
const command = {
  roomTypeId: 'room-type-1',
  roomId: 'room-1',
  startsOn: '2026-09-25',
  endsOn: '2026-09-27',
};

describe('LocalPmsProvider pre-payment Clock availability', () => {
  it('does not create a checkout session when Clock rejects a specific room', async () => {
    const createCheckoutSession = vi.fn();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'booking-1' }]) };
    let rolledBack = false;
    const provider = new LocalPmsProvider(
      {
        withTenantTransaction: vi.fn(async (_context, callback) => {
          try {
            return await callback(tx);
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        }),
      } as never,
      { lockRoom: vi.fn(), reserveRoom: vi.fn().mockResolvedValue(true) } as never,
      { recordInTransaction: vi.fn() } as never,
      {} as never,
      {} as never,
      { forBookingMethod: vi.fn(() => ({ createCheckoutSession })) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { recordInTransaction: vi.fn() } as never,
      { activePmsConnectionCredentials: vi.fn().mockResolvedValue({ provider: 'CLOCK_PMS' }) } as never,
      {} as never,
      { isAvailableForBooking: vi.fn().mockResolvedValue({ ok: true, value: false }) } as never,
      {} as never,
    );
    const internals = provider as unknown as Record<string, unknown>;
    internals.withIdempotency = async (
      _tx: unknown,
      _context: unknown,
      _idempotencyKey: unknown,
      _command: unknown,
      _bookingId: unknown,
      _externalReference: unknown,
      execute: () => Promise<unknown>,
    ) => execute();
    internals.validateCatalog = async () => null;
    internals.validateRoomSelection = async () => ({ autoAssign: false });
    internals.paymentMethod = async () => ({ ok: true, value: 'STRIPE_CHECKOUT' });
    internals.resolveGuest = async () => ({ ok: true, value: 'guest-1' });
    internals.generatedExternalReference = async () => 'must-test-1';
    internals.validatedGuestReturnUrl = async () => null;
    internals.transition = async (
      _tx: unknown,
      _context: unknown,
      _bookingId: unknown,
      _current: unknown,
      next: unknown,
    ) => next;

    await expect(
      provider.createBooking(context, {
        idempotencyKey: 'idem-1',
        roomTypeId: 'room-type-1',
        roomId: 'room-1',
        ratePlanId: 'rate-plan-1',
        startsOn: '2026-09-25',
        endsOn: '2026-09-27',
        total: { amount: '100.00', currency: 'EUR' },
        guest: {
          email: 'guest@example.test',
          firstName: 'Test',
          lastName: 'Guest',
          phone: null,
        },
        guestCount: 2,
        staffActorId: 'staff-1',
        skipQuoteValidation: true,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });

  it('turns a Clock conflict into the existing AVAILABILITY_FAILED result before checkout', async () => {
    const isAvailableForBooking = vi.fn().mockResolvedValue({ ok: true, value: false });
    const failure = vi.fn((code, message, retryable = false) => ({
      ok: false,
      error: { code, message, retryable },
    }));

    await expect(
      prePaymentClockAvailabilityFailure.call(
        {
          isClockConnected: vi.fn().mockResolvedValue(true),
          clockAvailability: { isAvailableForBooking },
          failure,
        },
        context,
        command,
        { adults: 2, children: 0 },
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'AVAILABILITY_FAILED',
        message: 'The selected room is no longer available for the requested stay.',
        retryable: false,
      },
    });
    expect(isAvailableForBooking).toHaveBeenCalledWith('tenant-1', 'property-1', {
      roomTypeId: 'room-type-1',
      roomId: 'room-1',
      startsOn: '2026-09-25',
      endsOn: '2026-09-27',
      adultCount: 2,
      childrenCount: 0,
    });
  });

  it('allows checkout to continue when Clock confirms the stay is available', async () => {
    const isAvailableForBooking = vi.fn().mockResolvedValue({ ok: true, value: true });

    await expect(
      prePaymentClockAvailabilityFailure.call(
        {
          isClockConnected: vi.fn().mockResolvedValue(true),
          clockAvailability: { isAvailableForBooking },
          failure: vi.fn(),
        },
        context,
        { ...command, roomId: undefined },
        { adults: 1, children: 1 },
      ),
    ).resolves.toBeNull();
    expect(isAvailableForBooking).toHaveBeenCalledOnce();
  });

  it('does not make a Clock call for a property without a Clock connection', async () => {
    const isAvailableForBooking = vi.fn();

    await expect(
      prePaymentClockAvailabilityFailure.call(
        {
          isClockConnected: vi.fn().mockResolvedValue(false),
          clockAvailability: { isAvailableForBooking },
          failure: vi.fn(),
        },
        context,
        command,
        { adults: 2, children: 0 },
      ),
    ).resolves.toBeNull();
    expect(isAvailableForBooking).not.toHaveBeenCalled();
  });
});
