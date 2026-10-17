import type { CreateBookingCommand, PmsProviderContext } from '@must/domain-contracts';
import { describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';

const context: PmsProviderContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};

function createService(catalogRows: unknown[], roomRows: unknown[] = []) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([{ requestHash: 'inserted' }])
    .mockResolvedValueOnce(catalogRows)
    .mockResolvedValueOnce(roomRows);
  const executeRaw = vi.fn().mockResolvedValue(1);
  const database = {
    withTenantTransaction: vi.fn((_context, callback) =>
      callback({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
    ),
  };
  const connections = {
    activePmsConnectionCredentials: vi.fn().mockResolvedValue({
      connectionId: 'clock-connection',
      provider: 'CLOCK_PMS',
      credentials: {
        host: 'https://clock.example.test',
        accountId: 'account',
        subscriptionId: 'subscription',
        apiUser: 'user',
        apiKey: 'test-key',
      },
    }),
  };
  const service = new ClockBookingService(
    database as never,
    connections as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, queryRaw };
}

function command(overrides: Partial<CreateBookingCommand> = {}): CreateBookingCommand {
  return {
    idempotencyKey: 'booking-key',
    roomTypeId: '33333333-3333-4333-8333-333333333333',
    roomId: '44444444-4444-4444-8444-444444444444',
    ratePlanId: '55555555-5555-4555-8555-555555555555',
    startsOn: '2035-09-10',
    endsOn: '2035-09-12',
    guest: { email: 'guest@example.test', firstName: 'Guest', lastName: 'Example' },
    total: { amount: '180.00', currency: 'EUR' },
    paymentMethod: 'pay_at_hotel',
    ...overrides,
  } as CreateBookingCommand;
}

describe('Clock booking publication and room activity gates', () => {
  it('rejects a draft room type before creating a Clock booking', async () => {
    const { service, queryRaw } = createService([]);

    await expect(service.createBooking(context, command())).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROOM_TYPE_NOT_AVAILABLE' },
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects an inactive physical room before creating a Clock booking', async () => {
    const { service, queryRaw } = createService([{ id: 'room-type-id' }], []);

    await expect(service.createBooking(context, command())).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_AVAILABLE' },
    });
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });
});
