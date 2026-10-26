import { describe, expect, it, vi } from 'vitest';

import { PropertyCurrencyService } from './property-currency.service';

function make(setting: string | null, clock: string | null | Error) {
  const db = {
    withTenantTransaction: vi.fn(async (_scope: unknown, work: (tx: unknown) => unknown) =>
      work({ $queryRaw: vi.fn(async () => [{ currency: setting }]) }),
    ),
  };
  const clockService = {
    publishedRateCurrency: vi.fn(async () => {
      if (clock instanceof Error) throw clock;
      return clock;
    }),
  };
  return new PropertyCurrencyService(db as never, clockService as never);
}

describe('PropertyCurrencyService', () => {
  it('uses the owner setting first', async () => {
    await expect(make('gbp', 'EUR').resolve('t', 'p')).resolves.toEqual({
      currency: 'GBP',
      source: 'setting',
      setting: 'GBP',
      clock: 'EUR',
      mismatch: true,
    });
  });

  it('takes the currency of the Clock rates when the owner has not set one', async () => {
    await expect(make(null, 'EUR').resolve('t', 'p')).resolves.toMatchObject({
      currency: 'EUR',
      source: 'clock',
      mismatch: false,
    });
  });

  it('falls back to euro for a hotel with neither, and survives Clock being unreachable', async () => {
    await expect(make(null, null).resolve('t', 'p')).resolves.toMatchObject({
      currency: 'EUR',
      source: 'default',
    });
    await expect(make('ALL', new Error('down')).resolve('t', 'p')).resolves.toMatchObject({
      currency: 'ALL',
      source: 'setting',
      clock: null,
      mismatch: false,
    });
  });
});
