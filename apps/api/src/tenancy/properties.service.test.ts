import { describe, expect, it, vi } from 'vitest';

import { PropertiesService } from './properties.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const actorUserId = 'c3333333-3333-4333-8333-333333333333';

function service() {
  const property = {
    id: propertyId,
    name: 'Grand Hotel',
    address: '1 Main Street',
    timezone: 'Europe/Tirane',
    bookingMode: 'INDIVIDUAL_ROOM_ONLY' as const,
    publicWebsiteOrigin: null,
    minStayNights: null,
    maxStayNights: null,
    checkInTime: null,
    checkOutTime: null,
    rules: null,
    advanceBookingDays: null,
    freeCancellationDaysBeforeArrival: 21,
    paymentGateways: { stripe: false, pokpay: false, payAtHotel: true },
    wordpressConnectedAt: null,
  };
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([property])
    .mockResolvedValueOnce([{ ...property, rules: 'No smoking.\nAdults only.' }]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  return new PropertiesService(database as never, audit as never, {} as never, {} as never);
}

describe('PropertiesService room rules', () => {
  it('persists trimmed property room rules', async () => {
    await expect(
      service().update(tenantId, propertyId, actorUserId, { rules: ' No smoking.\nAdults only. ' }),
    ).resolves.toMatchObject({ rules: 'No smoking.\nAdults only.' });
  });

  it('rejects a non-text rules value', async () => {
    await expect(service().update(tenantId, propertyId, actorUserId, { rules: 1 })).rejects.toThrow(
      'rules must be a string or null.',
    );
  });
});
