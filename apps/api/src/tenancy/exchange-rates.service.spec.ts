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

describe('hotel exchange rates', () => {
  it('prefers the hotel rate per currency and uses the feed for the rest', async () => {
    const { db } = make(
      stored([
        { code: 'ALL', rate: '110' },
        { code: 'USD', rate: '1.25' },
        { code: 'EUR', rate: '1' },
      ]),
    );
    const hotel = {
      snapshot: vi.fn().mockResolvedValue({
        base: 'ALL',
        version: '7',
        displayCurrencies: null,
        rates: [{ currency: 'EUR', rate: '100.00000000' }],
      }),
    };
    const service = new ExchangeRatesService(db as never, hotel as never);
    const result = await service.ratesFor('ALL', ['EUR', 'USD'], {
      tenantId: 't',
      propertyId: 'p',
    });
    expect(result).toMatchObject({
      base: 'ALL',
      rates: { EUR: 0.01, USD: 0.011364 },
      sources: { EUR: 'hotel', USD: 'feed' },
      version: '7',
    });
    expect(hotel.snapshot).toHaveBeenCalledWith('t', 'p');
    hotel.snapshot.mockResolvedValueOnce({
      base: 'ALL',
      version: '8',
      displayCurrencies: null,
      rates: [],
    });
    expect(
      await service.ratesFor('ALL', ['EUR'], { tenantId: 't', propertyId: 'p' }),
    ).toMatchObject({ rates: { EUR: 0.009091 }, sources: { EUR: 'feed' } });
  });
  it('serves hotel rates without a feed and includes the hotel-selected display currencies', async () => {
    const { db } = make([]);
    const hotel = {
      snapshot: vi.fn().mockResolvedValue({
        base: 'ALL',
        version: '1',
        displayCurrencies: ['EUR'],
        rates: [{ currency: 'EUR', rate: '100.00000000' }],
      }),
    };
    const service = new ExchangeRatesService(db as never, hotel as never);
    expect(
      await service.ratesFor('ALL', ['ALL'], { tenantId: 't', propertyId: 'p' }),
    ).toMatchObject({
      rates: { ALL: 1, EUR: 0.01 },
      sources: { EUR: 'hotel' },
      displayCurrencies: ['EUR'],
    });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
