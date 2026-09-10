import { describe, expect, it, vi } from 'vitest';

import { QuoteController } from './quote.controller';
import type { QuoteService } from './quote.service';

describe('display price card batches', () => {
  it.each([78, 300])('prices %i cards subject to the 250-card bound', async (count) => {
    const displayPrices = vi.fn(async (_tenant, _property, _input, items) =>
      items.map((item: { key: string; roomTypeId: string }) => ({
        ...item,
        available: true,
        total: { amount: '1200.00', currency: 'EUR' },
      })),
    );
    const controller = new QuoteController({ displayPrices } as unknown as QuoteService);
    const result = await controller.displayPrices(
      {
        startsOn: '2026-09-20',
        endsOn: '2026-09-28',
        adults: 2,
        children: 0,
        items: Array.from({ length: count }, (_, index) => ({
          key: String(index),
          roomTypeId: 'room-type',
          roomId: `room-${index}`,
        })),
      },
      { tenantContext: { tenantId: 'tenant', propertyId: 'property' }, guestSessionId: 'session' },
    );
    expect(displayPrices).toHaveBeenCalledTimes(1);
    expect(displayPrices.mock.calls[0]?.slice(0, 2)).toEqual(['tenant', 'property']);
    expect(result.prices).toHaveLength(Math.min(count, 250));
    expect(result.prices[77]?.total.amount).toBe('1200.00');
  });
});
