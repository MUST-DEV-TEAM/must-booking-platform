import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExchangeRatesService } from './exchange-rates.service';

const stored = (rows: Array<{ code: string; rate: string }>, ageMs = 60_000) =>
  rows.map((row) => ({
    ...row,
    rateDate: new Date('2026-10-25T00:00:00Z'),
    fetchedAt: new Date(Date.now() - ageMs),
  }));

function make(rows: ReturnType<typeof stored>) {
  const db = { $queryRaw: vi.fn().mockResolvedValue(rows), $executeRaw: vi.fn() };
  return { service: new ExchangeRatesService(db as never), db };
}

afterEach(() => vi.unstubAllGlobals());

describe('ExchangeRatesService', () => {
  it('converts through the euro so any hotel currency can be the base', async () => {
    const { service, db } = make(
      stored([
        { code: 'ALL', rate: '100' },
        { code: 'USD', rate: '1.25' },
        { code: 'EUR', rate: '1' },
      ]),
    );

    const result = await service.ratesFor('ALL', ['usd', 'EUR', 'bad!']);

    // 1 lek = 1.25 / 100 USD = 0.0125 USD; 1 lek = 1 / 100 EUR = 0.01 EUR.
    expect(result).toEqual({
      base: 'ALL',
      date: '2026-10-25',
      rates: { USD: 0.0125, EUR: 0.01 },
    });
    // Fresh rates are served from storage without asking the feed.
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps serving stored rates when the feed is down', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const { service } = make(
      stored(
        [
          { code: 'EUR', rate: '1' },
          { code: 'USD', rate: '1.1' },
        ],
        3 * 24 * 60 * 60 * 1000,
      ),
    );

    const result = await service.ratesFor('EUR', ['USD']);

    expect(fetchMock).toHaveBeenCalled();
    expect(result?.rates).toEqual({ USD: 1.1 });
  });

  it('has nothing to show when no rates were ever stored and the feed is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { service } = make([]);

    await expect(service.ratesFor('EUR', ['USD'])).resolves.toBeNull();
  });
});
