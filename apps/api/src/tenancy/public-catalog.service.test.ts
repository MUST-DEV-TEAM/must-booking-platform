import { describe, expect, it, vi } from 'vitest';

import { PublicCatalogService } from './public-catalog.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';

function catalogFor(
  connectedPaymentConnections: Array<{ provider: 'STRIPE' | 'POKPAY' }>,
  roomTypes: unknown[] = [],
) {
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
    .mockResolvedValueOnce(roomTypes);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  return new PublicCatalogService(database as never).getCatalog(tenantId, propertyId, {});
}

function individualCatalogFor(rooms: unknown[]) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce([
      {
        stripeEnabled: false,
        pokpayEnabled: false,
        payAtHotelEnabled: true,
        bookingMode: 'INDIVIDUAL_ROOM_ONLY',
      },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        id: 'room-type-id',
        name: 'Deluxe',
        description: null,
        mainImageUrl: null,
        galleryImageUrls: [],
        maxOccupancy: 2,
        amenities: [],
        ratePlans: [],
        requiresRatePlanSelection: true,
      },
    ])
    .mockResolvedValueOnce(rooms);
  const database = {
    withTenantTransaction: async (
      _context: unknown,
      callback: (tx: { $queryRaw: typeof queryRaw }) => Promise<unknown>,
    ) => callback({ $queryRaw: queryRaw }),
  };
  return new PublicCatalogService(database as never).getCatalog(tenantId, propertyId, {
    startsOn: '2026-08-12',
    endsOn: '2026-08-13',
  });
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

  it('preserves room-type presentation fields in the public catalog contract', async () => {
    await expect(
      catalogFor(
        [],
        [
          {
            id: 'room-type-id',
            name: 'Deluxe',
            description: 'Sea-facing suite',
            amenitiesIntro: 'Everything needed for a comfortable stay.',
            mainImageUrl: 'https://images.example.test/deluxe.jpg',
            galleryImageUrls: ['https://images.example.test/deluxe-1.jpg'],
            maxOccupancy: 2,
            amenities: [{ id: 'amenity-id', name: 'Beach access', icon: 'BEACH' }],
            ratePlans: [],
            requiresRatePlanSelection: true,
          },
        ],
      ),
    ).resolves.toMatchObject({
      roomTypes: [
        {
          mainImageUrl: 'https://images.example.test/deluxe.jpg',
          amenitiesIntro: 'Everything needed for a comfortable stay.',
          galleryImageUrls: ['https://images.example.test/deluxe-1.jpg'],
          amenities: [{ icon: 'BEACH' }],
        },
      ],
    });
  });

  it('exposes physical-room presentation and server-resolved rules and descriptions in individual-room catalogues', async () => {
    await expect(
      individualCatalogFor([
        {
          id: 'room-id',
          name: '101',
          title: 'Panoramic Sea Suite',
          roomSize: '70m²',
          rules: 'No smoking. Adults only.',
          description: 'A private sea-facing suite.',
          amenities: [{ id: 'balcony', name: 'Private balcony', icon: 'BEACH' }],
          floor: 1,
          viewType: 'Sea view',
          roomTypeId: 'room-type-id',
          isAvailable: true,
        },
      ]),
    ).resolves.toMatchObject({
      roomTypes: [
        {
          rooms: [
            {
              title: 'Panoramic Sea Suite',
              roomSize: '70m²',
              rules: 'No smoking. Adults only.',
              description: 'A private sea-facing suite.',
              amenities: [{ name: 'Private balcony', icon: 'BEACH' }],
            },
          ],
        },
      ],
    });
  });
});
