import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';
import { describe, expect, it, vi } from 'vitest';

import { BookingProjectionService, type BookingProjection } from './booking-projection.service';

describe('BookingProjectionService', () => {
  it('preserves a booking with no linked guest in the property projection', async () => {
    const row: Omit<BookingProjection, 'total'> & { totalAmount: string; currency: string } = {
      id: 'booking-1',
      guestId: null,
      guestFirstName: null,
      guestLastName: null,
      guestEmail: null,
      guestPhone: null,
      guestStreetAddress: null,
      guestAddressLine2: null,
      guestCity: null,
      guestCounty: null,
      guestPostcode: null,
      specialRequests: null,
      roomTypeId: 'room-type-1',
      roomTypeName: 'Standard Room',
      roomId: null,
      ratePlanId: 'rate-plan-1',
      ratePlanName: 'Clock shadow rate',
      startsOn: '2026-09-03',
      endsOn: '2026-09-04',
      status: BookingStatus.CONFIRMED,
      paymentMethod: BookingPaymentMethod.PAY_AT_HOTEL,
      totalAmount: '450.00',
      currency: 'EUR',
      paidAmount: '0',
      refundedAmount: '0',
      externalReference: 'CLOCK-364',
      clockFolios: [],
      version: 1,
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
    };
    const transaction = { $queryRaw: vi.fn().mockResolvedValue([row]) };
    const database = {
      withTenantTransaction: vi.fn((_context, operation) => operation(transaction)),
    };
    const service = new BookingProjectionService(database as never);
    const { totalAmount, currency, ...projection } = row;

    await expect(service.list('tenant-1', 'property-1')).resolves.toEqual([
      {
        ...projection,
        total: { amount: totalAmount, currency },
      },
    ]);
    expect(database.withTenantTransaction).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', propertyId: 'property-1' },
      expect.any(Function),
    );
  });
});
