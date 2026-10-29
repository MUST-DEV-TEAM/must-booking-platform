import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  OUTLIER_DEVIATION,
  PropertyExchangeRatesController,
  rateDeviation,
} from './property-exchange-rates.controller';

const request = { tenantContext: { tenantId: 't', propertyId: 'p', userId: 'u' } };

function make(feedPerUnit: Record<string, number> | Error) {
  const rates = {
    snapshot: vi
      .fn()
      .mockResolvedValue({ base: 'ALL', version: '1', displayCurrencies: null, rates: [] }),
    set: vi.fn().mockResolvedValue({}),
  };
  const feed = {
    feedReference: vi.fn(async () => {
      if (feedPerUnit instanceof Error) throw feedPerUnit;
      return { date: '2026-10-29', perUnit: feedPerUnit };
    }),
  };
  return {
    controller: new PropertyExchangeRatesController(rates as never, feed as never),
    rates,
    feed,
  };
}

describe('rate deviation', () => {
  it('is the distance from the reference as a fraction', () => {
    expect(rateDeviation('100', 100)).toBe(0);
    expect(rateDeviation('150', 100)).toBeCloseTo(0.5);
    expect(rateDeviation('200', 100)).toBeCloseTo(1);
    expect(rateDeviation('50', 100)).toBeCloseTo(0.5);
    expect(OUTLIER_DEVIATION).toBe(0.5);
  });
});

describe('saving a hotel rate', () => {
  it('rejects a rate far from the market with a code the screen can act on, and writes nothing', async () => {
    const { controller, rates } = make({ EUR: 100 });
    const error = await controller
      .set('EUR', { rate: '200' }, request)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'RATE_FAR_FROM_MARKET',
      reference: 100,
    });
    expect(rates.set).not.toHaveBeenCalled();
  });

  it('saves a far rate only when the caller confirms it on purpose', async () => {
    const { controller, rates } = make({ EUR: 100 });
    await controller.set('EUR', { rate: '200', confirmOutlier: true }, request);
    expect(rates.set).toHaveBeenCalledWith('t', 'p', 'u', 'EUR', '200');
  });

  it('saves a rate within the band and a rate with no feed to compare against', async () => {
    const near = make({ EUR: 100 });
    await near.controller.set('EUR', { rate: '110' }, request);
    expect(near.rates.set).toHaveBeenCalled();
    const offline = make(new Error('feed down'));
    await offline.controller.set('EUR', { rate: '9999' }, request);
    expect(offline.rates.set).toHaveBeenCalled();
    const unknown = make({});
    await unknown.controller.set('EUR', { rate: '9999' }, request);
    expect(unknown.rates.set).toHaveBeenCalled();
  });

  it('lets the service report invalid input instead of hiding it behind the market check', async () => {
    const { controller, rates, feed } = make({ EUR: 100 });
    await controller.set('EUR', { rate: 'abc' }, request);
    expect(feed.feedReference).not.toHaveBeenCalled();
    expect(rates.set).toHaveBeenCalledWith('t', 'p', 'u', 'EUR', 'abc');
  });
});
