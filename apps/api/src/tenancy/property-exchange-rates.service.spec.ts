import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  displayCurrency,
  displayRate,
  PropertyExchangeRatesService,
} from './property-exchange-rates.service';

describe('hotel exchange-rate validation', () => {
  it.each(['0', '-1', 'NaN', 'Infinity', '1000000001', '0.000000001', '1e3', null, {}])(
    'rejects invalid rate %s',
    (value) => {
      expect(() => displayRate(value)).toThrow(BadRequestException);
    },
  );
  it('keeps eight decimal places and accepts a positive bounded rate', () => {
    expect(displayRate('100')).toBe('100.00000000');
    expect(displayRate('0.00000001')).toBe('0.00000001');
    expect(displayCurrency('eur')).toBe('EUR');
  });
  it.each(['EU', 'EURO', 'E1R', ' EUR', 'ZZZ', 'XXX', null])(
    'rejects malformed currency %s',
    (value) => expect(() => displayCurrency(value)).toThrow(BadRequestException),
  );
  it('rejects the hotel currency and missing default currency before writing', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ currency: 'ALL' }]),
      $executeRaw: vi.fn(),
    };
    const db = { withTenantTransaction: vi.fn(async (_scope, callback) => callback(tx)) };
    const service = new PropertyExchangeRatesService(db as never);
    await expect(service.set('t', 'p', 'u', 'ALL', '1')).rejects.toThrow(/default currency/);
    tx.$queryRaw.mockResolvedValueOnce([{ currency: null }]);
    await expect(service.set('t', 'p', 'u', 'EUR', '100')).rejects.toThrow(
      /Choose the hotel default/,
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(db.withTenantTransaction).toHaveBeenCalledWith(
      { tenantId: 't', propertyId: 'p' },
      expect.any(Function),
    );
    await expect(service.select('t', 'p', ['EUR', 'bad!'])).rejects.toThrow(BadRequestException);
  });
});
