import { describe, expect, it, vi } from 'vitest';

import { PublicCatalogService } from './public-catalog.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';

function catalogFor(connectedPaymentConnections: Array<{ provider: 'STRIPE' | 'POKPAY' }>) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([
      {
        stripeEnabled: true,
        pokpayEnabled: true,
        payAtHotelEnabled: true,
        bookingMode: 'ROOM_TYPE_ONLY',
      },
    ])
    .mockResolvedValueOnce(connectedPaymentConnections)
    .mockResolvedValueOnce([]);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  return new PublicCatalogService(database as never).getCatalog(tenantId, propertyId, {});
}

describe('PublicCatalogService payment methods', () => {
  it('omits enabled online providers without a connected property integration', async () => {
    await expect(catalogFor([])).resolves.toMatchObject({
      paymentMethods: ['pay_at_hotel'],
    });
  });

  it('advertises only enabled providers with a connected property integration', async () => {
    await expect(catalogFor([{ provider: 'POKPAY' }])).resolves.toMatchObject({
      paymentMethods: ['pokpay', 'pay_at_hotel'],
    });
  });
});
