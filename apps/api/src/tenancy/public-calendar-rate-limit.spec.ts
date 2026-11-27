import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { PublicAvailabilityController } from './public-availability.controller';
import { PUBLIC_RATE_LIMIT, type PublicRateLimitOptions } from './public-rate-limit.decorator';

const limitOf = (method: keyof PublicAvailabilityController) =>
  Reflect.getMetadata(
    PUBLIC_RATE_LIMIT,
    PublicAvailabilityController.prototype[method],
  ) as PublicRateLimitOptions;

describe('public calendar rate limit', () => {
  it('counts calendar reads apart from prices and availability, with room for every room type', () => {
    const calendar = limitOf('getCalendar');
    for (const other of ['getAvailability', 'getRateOffers', 'checkAvailability'] as const)
      expect(limitOf(other).name).not.toBe(calendar.name);
    // Two months of a 13-room-type hotel, for at least 20 such views a minute.
    expect(calendar.maximum).toBeGreaterThanOrEqual(13 * 2 * 20);
    expect(calendar.windowSeconds).toBe(60);
  });
});
