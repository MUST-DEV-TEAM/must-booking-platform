import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';
import { Prisma } from '@prisma/client';
import { PropertyExchangeRatesService } from './property-exchange-rates.service';

/**
 * Approximate display rates: hotel overrides win, with a daily euro-based feed as fallback.
 * Payment-ledger annotations may snapshot these rates; they never determine a charging amount.
 */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const BASE = 'EUR';

type Fetched = { date: string; source: string; rates: Record<string, number> };

/** Feeds tried in order. Both are free, need no key and include the Albanian lek. */
const FEEDS: Array<{ source: string; load: () => Promise<Fetched> }> = [
  {
    source: 'open.er-api.com',
    load: async () => {
      const body = (await getJson('https://open.er-api.com/v6/latest/EUR')) as {
        result?: string;
        time_last_update_unix?: number;
        rates?: Record<string, number>;
      };
      if (body.result !== 'success' || !body.rates) throw new Error('Unexpected feed response.');
      const date = new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000)
        .toISOString()
        .slice(0, 10);
      return { date, source: 'open.er-api.com', rates: body.rates };
    },
  },
  {
    source: 'currency-api',
    load: async () => {
      const body = (await getJson(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json',
      )) as { date?: string; eur?: Record<string, number> };
      if (!body.eur || !body.date) throw new Error('Unexpected feed response.');
      const rates: Record<string, number> = {};
      for (const [code, value] of Object.entries(body.eur)) rates[code.toUpperCase()] = value;
      return { date: body.date, source: 'currency-api', rates };
    },
  },
];

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Feed answered ${response.status}.`);
  return response.json();
}

export type ExchangeRates = {
  base: string;
  date: string;
  /** How many units of each currency one unit of `base` buys. */
  rates: Record<string, number>;
  sources?: Record<string, 'hotel' | 'feed'>;
  version?: string;
  displayCurrencies?: string[] | null;
};

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private refreshing: Promise<void> | null = null;

  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(PropertyExchangeRatesService)
    private readonly hotelRates?: PropertyExchangeRatesService,
  ) {}

  /**
   * Rates for `currencies`, expressed against `base` (the hotel's currency). Refreshes from the
   * feed at most twice a day and keeps serving the stored rates when the feed is down.
   */
  async ratesFor(
    base: string,
    currencies: string[],
    scope?: { tenantId: string; propertyId: string },
  ): Promise<ExchangeRates | null> {
    let wanted = Array.from(
      new Set(
        currencies.map((code) => code.toUpperCase()).filter((code) => /^[A-Z]{3}$/.test(code)),
      ),
    );
    const hotel =
      scope && this.hotelRates
        ? await this.hotelRates.snapshot(scope.tenantId, scope.propertyId)
        : null;
    if (hotel?.displayCurrencies)
      wanted = [...new Set([...wanted, ...hotel.displayCurrencies, base.toUpperCase()])].sort();
    const overrides = new Map(
      (hotel?.base === base.toUpperCase() ? hotel.rates : []).map((row) => [row.currency, row]),
    );
    const missing = wanted.filter((code) => code !== base.toUpperCase() && !overrides.has(code));
    const pivot = Array.from(new Set([base.toUpperCase(), ...missing]));
    let stored = missing.length
      ? await this.stored(pivot)
      : {
          rates: { [base.toUpperCase()]: 1 },
          date:
            [...overrides.values()]
              .map((row) => row.updatedAt?.toISOString().slice(0, 10))
              .filter(Boolean)
              .sort()[0] ?? new Date().toISOString().slice(0, 10),
          stale: false,
        };
    if (stored.stale) {
      await this.refresh();
      stored = await this.stored(pivot);
    }
    const baseRate = stored.rates[base.toUpperCase()];
    const rates: Record<string, number> = {};
    const sources: Record<string, 'hotel' | 'feed'> = {};
    for (const code of wanted) {
      const override = overrides.get(code);
      if (code === base.toUpperCase()) {
        rates[code] = 1;
        sources[code] = 'feed';
      } else if (override) {
        rates[code] = new Prisma.Decimal(1).dividedBy(override.rate).toNumber();
        sources[code] = 'hotel';
      } else if (baseRate && stored.rates[code]) {
        rates[code] = round(stored.rates[code] / baseRate);
        sources[code] = 'feed';
      }
    }
    if (!Object.keys(rates).length && !stored.date) return null;
    return {
      base: base.toUpperCase(),
      date: stored.date || new Date().toISOString().slice(0, 10),
      rates,
      ...(hotel
        ? { sources, version: hotel.version, displayCurrencies: hotel.displayCurrencies }
        : {}),
    };
  }

  /**
   * What the daily feed alone says: hotel-currency units per one unit of each currency. Staff see it as a
   * reference next to the rate they type, and the API uses it to reject a rate that is far off the market.
   */
  async feedReference(
    base: string,
    currencies: string[],
  ): Promise<{ date: string | null; perUnit: Record<string, number> }> {
    const hotel = base.toUpperCase();
    const wanted = Array.from(
      new Set(
        currencies.map((code) => code.toUpperCase()).filter((code) => /^[A-Z]{3}$/.test(code)),
      ),
    ).filter((code) => code !== hotel);
    if (!wanted.length) return { date: null, perUnit: {} };
    const pivot = [hotel, ...wanted];
    let stored = await this.stored(pivot);
    if (stored.stale) {
      await this.refresh();
      stored = await this.stored(pivot);
    }
    const baseRate = stored.rates[hotel];
    const perUnit: Record<string, number> = {};
    if (baseRate)
      for (const code of wanted) {
        const quote = stored.rates[code];
        if (quote) perUnit[code] = round(baseRate / quote);
      }
    return { date: stored.date || null, perUnit };
  }

  private async stored(codes: string[]) {
    const rows = await this.db.$queryRaw<
      Array<{ code: string; rate: string; rateDate: Date; fetchedAt: Date }>
    >`
      SELECT quote_currency AS code, rate::text AS rate, rate_date AS "rateDate", fetched_at AS "fetchedAt"
      FROM exchange_rates
      WHERE base_currency = ${BASE} AND quote_currency = ANY(${[...codes, BASE]}::text[])
    `;
    const rates: Record<string, number> = { [BASE]: 1 };
    let date = '';
    let oldest = Date.now();
    for (const row of rows) {
      rates[row.code] = Number(row.rate);
      date = row.rateDate.toISOString().slice(0, 10);
      oldest = Math.min(oldest, row.fetchedAt.getTime());
    }
    return { rates, date, stale: rows.length === 0 || Date.now() - oldest > REFRESH_AFTER_MS };
  }

  /** One refresh at a time; a failed refresh leaves the stored rates untouched. */
  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async load(): Promise<void> {
    for (const feed of FEEDS) {
      try {
        const fetched = await feed.load();
        const entries = Object.entries(fetched.rates).filter(
          ([code, value]) => /^[A-Z]{3}$/.test(code) && Number.isFinite(value) && value > 0,
        );
        if (entries.length < 20) throw new Error('The feed returned too few currencies.');
        await this.db.$executeRaw`
          INSERT INTO exchange_rates (base_currency, quote_currency, rate, rate_date, source, fetched_at)
          SELECT ${BASE}, c.code, c.rate, ${fetched.date}::date, ${fetched.source}, now()
          FROM unnest(${entries.map(([code]) => code)}::text[], ${entries.map(([, value]) => value)}::numeric[])
            AS c(code, rate)
          ON CONFLICT (base_currency, quote_currency) DO UPDATE
          SET rate = EXCLUDED.rate, rate_date = EXCLUDED.rate_date,
              source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at
        `;
        return;
      } catch (error) {
        this.logger.warn(
          `Exchange rate feed ${feed.source} failed: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }
}

/**
 * Twelve decimals, not six: a hotel whose currency is worth about a hundredth of a euro (the lek) would keep only
 * four significant digits at six decimals, which skews every cross rate the website derives from these numbers.
 */
function round(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}
