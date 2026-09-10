import { Inject, Injectable } from '@nestjs/common';
import type {
  AvailabilityQuery,
  AvailabilityResult,
  Money,
  NightlyRate,
  Result,
} from '@must/domain-contracts';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import { parseClockCredentials } from './clock-credentials';
import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
  classifyConfigurationError,
  type ClockClassifiedError,
} from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';
import { ClockRateRankingService } from './clock-rate-ranking.service';

// Confirmed against the real sandbox (2026-08-04) and Clock's own public
// Postman docs: GET /rates_availability requires `from`, `to`, `rates`
// (one or more rate plan ids), and one of `room_types`/`rooms`. Response is
// an array of { id, rates: { [rateId]: { [date]: { free, room_type_free_rooms, price, errors } } } }.
// The endpoint matrix's documented, CONFIRMED_IN_SANDBOX shape also carries a
// per-date `price` (Task 10) — narrower callers (e.g. summarizeAvailability)
// just don't read it. See docs/CLOCK_ENDPOINT_MATRIX.md.
type ClockRateAvailabilityResponse = Array<{
  id: number | string;
  rates: Record<
    string,
    Record<
      string,
      {
        free: boolean;
        room_type_free_rooms: number;
        price?: { cents: number; currency: string };
        errors?: Record<string, unknown>;
      }
    >
  >;
}>;

// Confirmed against Clock's own public Postman docs ("products - VIEW"):
// GET /products with product_search[arrival]/[departure] and rates[] returns,
// per room type, the price AND availability together for that exact stay —
// this is the real "quote" endpoint (it's what Clock's own booking engine's
// second page uses). /rates_availability also carries a price per date (see
// above), but only /products is treated as authoritative for what a guest
// is actually charged — getQuoteWithNightlyRates uses /rates_availability
// only for the nightly *shape*, scaled to match /products' real total.
type ClockProductsResponse = Array<{
  id: number | string;
  rates: Record<
    string,
    Array<{
      available: boolean;
      room_type_free_rooms: number;
      price: { cents: number; currency: string };
      errors: Record<string, unknown>;
    }>
  >;
}>;

type ClockQuote = { total: Money; nightlyRates: NightlyRate[] };

export type ClockRateSelection = {
  rateId: string;
  total: Money;
};

export type ClockStayQuoteQuery = {
  roomTypeId: string;
  externalRoomTypeId?: string;
  startsOn: string;
  endsOn: string;
  adultCount?: number;
  childrenCount?: number;
  roomCount?: number;
  currency?: string;
};

type ClockProductOffer = {
  available: boolean;
  room_type_free_rooms: number;
  price: { cents: number; currency: string };
  errors: Record<string, unknown>;
};

/**
 * The rates a room type resolves to, already narrowed to `wbe: true` (Task
 * 12 — Clock's own `/products`/`/rates_availability` do NOT exclude
 * wbe:false rates on their own, confirmed against the real sandbox
 * 2026-09-10: a rate explicitly marked "don't publish to the booking
 * engine" still comes back available with a real bookable price). Any rate
 * dropped for that reason is counted in `excludedForWbe` so callers can
 * distinguish "this room type has no Clock rate at all" from "it has rates,
 * but none are public" — the two need different, clearly-worded errors.
 */
type RoomTypeRates = { ids: string[]; excludedForWbe: number };

/** For the Task 13 staff rate-ranking UI — Clock's real, live rate data for
 * one room type, narrowed to `wbe: true` (a rate staff can never see never
 * needs a ranking). Never persisted; MUST only stores the rank order. */
export type ClockRateSummary = {
  externalRateId: string;
  name: string;
  maxAdults: number | null;
  maxChildren: number | null;
};

// Clock support confirmed 2026-09-04: /rates_availability should not be
// called more than once every 15 minutes, and recommends caching for longer
// than that. 20 minutes gives a safety margin above their stated minimum —
// the same margin pattern already used for our own rate limiter (4 req/s
// against Clock's documented 5 req/s). The final pre-booking check
// (skipCache) always bypasses this regardless, so a stale cached answer can
// never actually gate a real booking.
const CACHE_TTL_MS = 1_200_000;
// Display prices are informational only, so keep them short-lived while
// avoiding one provider request per accommodation card on every page load.
const DISPLAY_PRICE_CACHE_TTL_MS = 300_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class ClockAvailabilityService {
  private readonly availabilityCache = new Map<string, CacheEntry<AvailabilityResult>>();
  private readonly ratesCache = new Map<string, CacheEntry<RoomTypeRates>>();
  private readonly displayPriceCache = new Map<string, CacheEntry<Money>>();

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
    @Inject(ClockRateRankingService) private readonly rateRankings: ClockRateRankingService,
  ) {}

  /**
   * `skipCache` exists for Task 10's final pre-booking availability check
   * (source brief section 16: a cached answer must never gate booking
   * creation), not used yet since booking creation isn't implemented here.
   */
  async getAvailability(
    tenantId: string,
    propertyId: string,
    query: AvailabilityQuery,
    options: { skipCache?: boolean } = {},
  ): Promise<Result<AvailabilityResult>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const externalRoomTypeId = await this.mappedExternalRoomTypeId(
      tenantId,
      propertyId,
      query.roomTypeId,
    );
    if (!externalRoomTypeId)
      return failure(
        classifyConfigurationError(
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        ),
      );

    const cacheKey = `${connection.connectionId}:${externalRoomTypeId}:${query.startsOn}:${query.endsOn}`;
    if (!options.skipCache) {
      const cached = this.availabilityCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return { ok: true, value: cached.value };
    }

    const rateIds = await this.ratesForRoomType(parsed.value, externalRoomTypeId);
    if (!rateIds.ok) return failure(rateIds.error);
    if (rateIds.value.ids.length === 0) return failure(noRatesError(rateIds.value));

    const nights = nightsBetween(query.startsOn, query.endsOn);
    if (nights.length === 0)
      return failure(classifyConfigurationError('startsOn must be before endsOn.'));

    const response = await this.fetch<ClockRateAvailabilityResponse>(parsed.value, {
      from: query.startsOn,
      to: nights[nights.length - 1],
      rates: rateIds.value.ids,
      room_types: externalRoomTypeId,
    });
    if (!response.ok) return failure(response.error);

    const value = summarizeAvailability(query, nights, response.value, externalRoomTypeId);
    this.availabilityCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ok: true, value };
  }

  /**
   * Real live pricing straight from Clock via `GET /products` — no local
   * mirror, by design (owner's call): Clock is always re-queried at quote
   * time rather than cached into a local rate_plan. Rate is derived from
   * the room type's confirmed Clock mapping, never staff-selected — there
   * is no local ratePlanId involved on this path at all.
   */
  async getQuote(
    tenantId: string,
    propertyId: string,
    query: {
      roomTypeId: string;
      startsOn: string;
      endsOn: string;
      adultCount?: number;
      childrenCount?: number;
    },
  ): Promise<Result<Money>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const externalRoomTypeId = await this.mappedExternalRoomTypeId(
      tenantId,
      propertyId,
      query.roomTypeId,
    );
    if (!externalRoomTypeId)
      return failure(
        classifyConfigurationError(
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        ),
      );

    const selection = await this.selectRateForStay(parsed.value, {
      tenantId,
      propertyId,
      roomTypeId: query.roomTypeId,
      externalRoomTypeId,
      startsOn: query.startsOn,
      endsOn: query.endsOn,
      adultCount: query.adultCount,
      childrenCount: query.childrenCount,
    });
    if (!selection.ok) return selection;
    return { ok: true, value: selection.value.total };
  }

  /**
   * Prices several visible room types for the same stay in one bounded Clock
   * /products request. This is presentation data for the accommodation page;
   * the normal quote path remains the authoritative final-price check.
   */
  async getQuotesForStay(
    tenantId: string,
    propertyId: string,
    queries: ClockStayQuoteQuery[],
  ): Promise<Record<string, Result<Money>>> {
    const results: Record<string, Result<Money>> = {};
    const uniqueQueries = Array.from(
      new Map(queries.map((query) => [query.roomTypeId, query])).values(),
    );
    if (uniqueQueries.length === 0) return results;

    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS') {
      const error = classifyConfigurationError('This property has no active Clock PMS connection.');
      uniqueQueries.forEach((query) => { results[query.roomTypeId] = failure(error); });
      return results;
    }
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) {
      uniqueQueries.forEach((query) => { results[query.roomTypeId] = failure(classifyConfigurationError(parsed.message)); });
      return results;
    }

    const resolved = await Promise.all(uniqueQueries.map(async (query) => {
      const externalRoomTypeId = query.externalRoomTypeId
        ?? await this.mappedExternalRoomTypeId(tenantId, propertyId, query.roomTypeId);
      if (!externalRoomTypeId) {
        return {
          query,
          externalRoomTypeId: null,
          rates: failure(classifyConfigurationError(
            'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
          )),
        };
      }
      return {
        query,
        externalRoomTypeId,
        rates: await this.ratesForRoomType(parsed.value, externalRoomTypeId),
      };
    }));

    const usable = resolved.filter((entry) => {
      if (!entry.rates.ok) {
        results[entry.query.roomTypeId] = failure(entry.rates.error);
        return false;
      }
      if (entry.rates.value.ids.length === 0) {
        results[entry.query.roomTypeId] = failure(noRatesError(entry.rates.value));
        return false;
      }
      return true;
    });
    if (usable.length === 0) return results;

    const ranked = await Promise.all(
      usable.map(async (entry) => ({
        entry,
        rankOrder: await this.rateRankings.rankOrder(tenantId, propertyId, entry.query.roomTypeId),
      })),
    );
    const misses = ranked.filter(({ entry, rankOrder }) => {
      const cacheKey = this.displayPriceCacheKey(
        tenantId,
        propertyId,
        connection.connectionId,
        entry.query,
        String(entry.externalRoomTypeId),
        entry.rates.ok ? entry.rates.value.ids : [],
        rankOrder,
      );
      const cached = this.displayPriceCache.get(cacheKey);
      if (!cached) return true;
      if (cached.expiresAt <= Date.now()) {
        this.displayPriceCache.delete(cacheKey);
        return true;
      }
      results[entry.query.roomTypeId] = { ok: true, value: cached.value };
      return false;
    });
    if (misses.length === 0) return results;

    const first = misses[0]!.entry.query;
    const rateIds = Array.from(new Set(misses.flatMap(({ entry }) => (
      entry.rates.ok ? entry.rates.value.ids : []
    ))));
    const response = await this.fetch<ClockProductsResponse>(
      parsed.value,
      {
        'product_search[arrival]': first.startsOn,
        'product_search[departure]': first.endsOn,
        'product_search[adult_count]': String(first.adultCount ?? 1),
        'product_search[children_count]': String(first.childrenCount ?? 0),
        rates: rateIds,
      },
      '/products',
    );
    if (!response.ok) {
      misses.forEach(({ entry }) => { results[entry.query.roomTypeId] = failure(response.error); });
      return results;
    }

    misses.forEach(({ entry, rankOrder }) => {
      const roomType = response.value.find((item) => String(item.id) === entry.externalRoomTypeId);
      const winner = roomType ? selectBestOffer(roomType.rates, rankOrder) : undefined;
      if (!winner) {
        results[entry.query.roomTypeId] = failure(classifyConfigurationError('Clock has no available price for the requested stay.'));
        return;
      }
      const value = { amount: (winner.offer.price.cents / 100).toFixed(2), currency: winner.offer.price.currency };
      const cacheKey = this.displayPriceCacheKey(
        tenantId,
        propertyId,
        connection.connectionId,
        entry.query,
        String(entry.externalRoomTypeId),
        entry.rates.ok ? entry.rates.value.ids : [],
        rankOrder,
      );
      this.displayPriceCache.set(cacheKey, { value, expiresAt: Date.now() + DISPLAY_PRICE_CACHE_TTL_MS });
      results[entry.query.roomTypeId] = { ok: true, value };
    });
    return results;
  }

  private displayPriceCacheKey(
    tenantId: string,
    propertyId: string,
    connectionId: string,
    query: ClockStayQuoteQuery,
    externalRoomTypeId: string,
    rateIds: string[],
    rankOrder: string[],
  ): string {
    return JSON.stringify([
      'clock-display-price-v1',
      tenantId,
      propertyId,
      connectionId,
      externalRoomTypeId,
      query.roomTypeId,
      query.startsOn,
      query.endsOn,
      query.adultCount ?? 1,
      query.childrenCount ?? 0,
      query.roomCount ?? 1,
      query.currency ?? '',
      rateIds,
      rankOrder,
    ]);
  }

  /**
   * Selects the exact Clock rate and total used by a quote. Booking creation
   * calls this same method immediately before POST /bookings/ so a room type
   * with multiple published rates follows the same wbe, occupancy, cheapest,
   * and staff-ranking rules as the guest-facing quote.
   *
   * The caller supplies the already-resolved Clock credentials and room-type
   * mapping because booking creation has both in hand inside its transaction.
   */
  async selectRateForStay(
    credentials: ClockConnectionCredentials,
    query: {
      tenantId: string;
      propertyId: string;
      roomTypeId: string;
      externalRoomTypeId: string;
      startsOn: string;
      endsOn: string;
      adultCount?: number;
      childrenCount?: number;
    },
  ): Promise<Result<ClockRateSelection>> {
    const rateIds = await this.ratesForRoomType(credentials, query.externalRoomTypeId);
    if (!rateIds.ok) return failure(rateIds.error);
    if (rateIds.value.ids.length === 0) return failure(noRatesError(rateIds.value));

    // adult_count/children_count are always sent, never left to the caller
    // to remember. Clock only enforces max_adults/max_children on a rate
    // when these are present, so defaulting here means enforcement cannot be
    // silently skipped.
    const productSearch: Record<string, string> = {
      'product_search[arrival]': query.startsOn,
      'product_search[departure]': query.endsOn,
      'product_search[adult_count]': String(query.adultCount ?? 1),
      'product_search[children_count]': String(query.childrenCount ?? 0),
    };

    const response = await this.fetch<ClockProductsResponse>(
      credentials,
      { ...productSearch, rates: rateIds.value.ids },
      '/products',
    );
    if (!response.ok) return failure(response.error);

    const rankOrder = await this.rateRankings.rankOrder(
      query.tenantId,
      query.propertyId,
      query.roomTypeId,
    );
    const roomType = response.value.find((item) => String(item.id) === query.externalRoomTypeId);
    const winner = roomType ? selectBestOffer(roomType.rates, rankOrder) : undefined;
    if (!winner)
      return failure(
        classifyConfigurationError('Clock has no available price for the requested stay.'),
      );

    return {
      ok: true,
      value: {
        rateId: winner.rateId,
        total: {
          amount: (winner.offer.price.cents / 100).toFixed(2),
          currency: winner.offer.price.currency,
        },
      },
    };
  }

  /**
   * Returns the authoritative stay total (from `getQuote`, unchanged — this
   * is what a guest is actually charged) plus a nightly breakdown for
   * display. The breakdown's *shape* comes from a single `/rates_availability`
   * call spanning the whole stay (Task 10 — that endpoint carries a price per
   * date already, confirmed against Clock's own documented response shape;
   * see docs/CLOCK_ENDPOINT_MATRIX.md), then scaled so the nights always sum
   * to exactly the authoritative total — Clock's per-night `/rates_availability`
   * price isn't treated as itself authoritative (occupancy/restriction rules
   * could differ subtly from `/products`), only as a relative weight.
   *
   * Falls back to the old one-`/products`-call-per-night method only if that
   * single call doesn't cover every night with a valid, error-free, priced
   * offer — e.g. a genuinely mixed-availability stay. Never less correct,
   * just slower in that uncommon case.
   */
  async getQuoteWithNightlyRates(
    tenantId: string,
    propertyId: string,
    query: {
      roomTypeId: string;
      startsOn: string;
      endsOn: string;
      adultCount?: number;
      childrenCount?: number;
    },
  ): Promise<Result<ClockQuote>> {
    const total = await this.getQuote(tenantId, propertyId, query);
    if (!total.ok) return total;

    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));
    const externalRoomTypeId = await this.mappedExternalRoomTypeId(
      tenantId,
      propertyId,
      query.roomTypeId,
    );
    if (!externalRoomTypeId)
      return failure(
        classifyConfigurationError(
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        ),
      );
    const rateIds = await this.ratesForRoomType(parsed.value, externalRoomTypeId);
    if (!rateIds.ok) return failure(rateIds.error);

    const nights = nightsBetween(query.startsOn, query.endsOn);
    const shape = await this.nightlyShapeFromAvailability(
      parsed.value,
      externalRoomTypeId,
      rateIds.value.ids,
      nights,
      query,
    );
    if (shape)
      return {
        ok: true,
        value: { total: total.value, nightlyRates: distributeToNights(nights, shape, total.value) },
      };

    const rankOrder = await this.rateRankings.rankOrder(tenantId, propertyId, query.roomTypeId);
    const nightlyRates: NightlyRate[] = [];
    for (const date of nights) {
      const nextDate = new Date(`${date}T00:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const productSearch: Record<string, string | string[]> = {
        'product_search[arrival]': date,
        'product_search[departure]': nextDate.toISOString().slice(0, 10),
        'product_search[adult_count]': String(query.adultCount ?? 1),
        'product_search[children_count]': String(query.childrenCount ?? 0),
        rates: rateIds.value.ids,
      };
      const response = await this.fetch<ClockProductsResponse>(
        parsed.value,
        productSearch,
        '/products',
      );
      if (!response.ok) return failure(response.error);
      const roomType = response.value.find((item) => String(item.id) === externalRoomTypeId);
      const winner = roomType ? selectBestOffer(roomType.rates, rankOrder) : undefined;
      if (!winner)
        return failure(classifyConfigurationError(`Clock has no available price for ${date}.`));
      if (winner.offer.price.currency !== total.value.currency)
        return failure(classifyConfigurationError('Clock returned inconsistent quote currencies.'));
      nightlyRates.push({ date, amount: (winner.offer.price.cents / 100).toFixed(2) });
    }
    return { ok: true, value: { total: total.value, nightlyRates } };
  }

  /**
   * One `/rates_availability` call spanning the whole stay, returning each
   * night's price in cents — or null if any night lacks a valid, available,
   * error-free priced entry, so the caller can fall back to the guaranteed-
   * correct per-night `/products` loop instead of guessing.
   */
  private async nightlyShapeFromAvailability(
    credentials: ClockConnectionCredentials,
    externalRoomTypeId: string,
    rateIds: string[],
    nights: string[],
    query: { adultCount?: number; childrenCount?: number },
  ): Promise<Record<string, number> | null> {
    if (rateIds.length === 0 || nights.length === 0) return null;

    const availabilityQuery: Record<string, string | string[]> = {
      from: nights[0]!,
      to: nights[nights.length - 1]!,
      rates: rateIds,
      room_types: externalRoomTypeId,
      adults: String(query.adultCount ?? 1),
      children: String(query.childrenCount ?? 0),
    };

    const response = await this.fetch<ClockRateAvailabilityResponse>(
      credentials,
      availabilityQuery,
    );
    if (!response.ok) return null;

    const roomType = response.value.find((item) => String(item.id) === externalRoomTypeId);
    if (!roomType) return null;
    const rateEntries = Object.values(roomType.rates);

    // Deterministic like `selectBestOffer` (Task 12): when more than one
    // rate has a valid, priced, error-free offer for the same night, the
    // cheapest one sets the shape for that night — never whichever happens
    // to be first in `Object.values`' (unreliable) key order.
    const shape: Record<string, number> = {};
    for (const night of nights) {
      let cheapestCents: number | null = null;
      for (const dates of rateEntries) {
        const entry = dates[night];
        if (!entry?.free || entry.price === undefined) continue;
        if (Object.keys(entry.errors ?? {}).length > 0) continue;
        if (cheapestCents === null || entry.price.cents < cheapestCents) cheapestCents = entry.price.cents;
      }
      if (cheapestCents === null) return null;
      shape[night] = cheapestCents;
    }
    return shape;
  }

  /**
   * Per-day availability for a whole calendar month, straight from Clock —
   * one /rates_availability call covering every night in the month (the
   * same endpoint getAvailability uses for a short stay, just with a longer
   * from/to range), for the walk-in booking calendar's disabled-dates
   * display. Mirrors AvailabilityService.getCalendar's local counterpart.
   */
  async getAvailabilityCalendar(
    tenantId: string,
    propertyId: string,
    query: { roomTypeId: string; month: string },
  ): Promise<Result<Array<{ date: string; isAvailable: boolean }>>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const externalRoomTypeId = await this.mappedExternalRoomTypeId(
      tenantId,
      propertyId,
      query.roomTypeId,
    );
    if (!externalRoomTypeId)
      return failure(
        classifyConfigurationError(
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        ),
      );

    const rateIds = await this.ratesForRoomType(parsed.value, externalRoomTypeId);
    if (!rateIds.ok) return failure(rateIds.error);
    if (rateIds.value.ids.length === 0) return failure(noRatesError(rateIds.value));

    if (!/^\d{4}-\d{2}$/.test(query.month))
      return failure(classifyConfigurationError('month must be YYYY-MM.'));
    const [year, monthNumber] = query.month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year!, monthNumber! - 1, 1)).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);
    const nights = nightsBetween(monthStart, monthEnd);

    const response = await this.fetch<ClockRateAvailabilityResponse>(parsed.value, {
      from: monthStart,
      to: nights[nights.length - 1]!,
      rates: rateIds.value.ids,
      room_types: externalRoomTypeId,
    });
    if (!response.ok) return failure(response.error);

    const roomType = response.value.find((item) => String(item.id) === externalRoomTypeId);
    const rateEntries = roomType ? Object.values(roomType.rates) : [];
    const days = nights.map((date) => {
      const isAvailable = rateEntries.some((entry) => {
        const cell = entry[date];
        return cell?.free && cell.room_type_free_rooms > 0;
      });
      return { date, isAvailable };
    });
    return { ok: true, value: days };
  }

  private async mappedExternalRoomTypeId(
    tenantId: string,
    propertyId: string,
    localRoomTypeId: string,
  ): Promise<string | null> {
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ externalEntityId: string }>>(
        `SELECT external_entity_id AS "externalEntityId" FROM clock_catalog_mappings
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND entity_type = 'ROOM_TYPE'
           AND local_entity_id = $3::uuid AND sync_status = 'CONFIRMED'`,
        tenantId,
        propertyId,
        localRoomTypeId,
      ),
    );
    return rows[0]?.externalEntityId ?? null;
  }

  /** A Clock "Rate Plan" (`/rate_plans`, e.g. id 69242) is a parent grouping
   * only — it carries no room-type/price/availability data. `/bookings/`,
   * `/rates_availability` and `/products` all require the child "Rate" id
   * from `/rates/` (e.g. 784160 for room type 41994), which is scoped to
   * exactly one room type (`bookable_type: "Pms::RoomType"`, `bookable_id`).
   * Confirmed against the real sandbox (2026-08-05) via Clock's own public
   * Postman docs' "Data Mapping and Room Type / Rate Structure" note:
   * "1 Rate belongs to 1 Room Type". Using the rate-plan id directly (as
   * this method used to) silently matches nothing and Clock reports it as
   * "not available" rather than "unknown rate id". */
  private async ratesForRoomType(
    credentials: ClockConnectionCredentials,
    externalRoomTypeId: string,
  ): Promise<ClockOutcome<RoomTypeRates>> {
    const cacheKey = `${credentials.apiUser}:${externalRoomTypeId}`;
    const cached = this.ratesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ok: true, value: cached.value };

    const response = await this.fetch<
      Array<{ id: number | string; bookable_id: number | string; bookable_type: string; wbe: boolean }>
    >(credentials, undefined, '/rates/');
    if (!response.ok) return response;
    const forRoomType = response.value.filter(
      (rate) => rate.bookable_type === 'Pms::RoomType' && String(rate.bookable_id) === externalRoomTypeId,
    );
    const published = forRoomType.filter((rate) => rate.wbe);
    const value: RoomTypeRates = {
      ids: published.map((rate) => String(rate.id)),
      excludedForWbe: forRoomType.length - published.length,
    };
    this.ratesCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ok: true, value };
  }

  /** For the Task 13 staff rate-ranking page — the room type's real, live
   * `wbe: true` Clock rates with enough detail to display and rank (name,
   * occupancy caps). Not cached (low-traffic staff config page, not the hot
   * quote path) and never persisted beyond what `ClockRateRankingService`
   * stores (rate ids and rank only). */
  async ratesForRoomTypeDetailed(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<Result<ClockRateSummary[]>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const externalRoomTypeId = await this.mappedExternalRoomTypeId(tenantId, propertyId, roomTypeId);
    if (!externalRoomTypeId)
      return failure(
        classifyConfigurationError(
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        ),
      );

    const response = await this.fetch<
      Array<{
        id: number | string;
        bookable_id: number | string;
        bookable_type: string;
        wbe: boolean;
        name?: string;
        rate_restriction?: { max_adults?: number | null; max_children?: number | null };
      }>
    >(parsed.value, undefined, '/rates/');
    if (!response.ok) return failure(response.error);

    const rates: ClockRateSummary[] = response.value
      .filter(
        (rate) =>
          rate.bookable_type === 'Pms::RoomType' &&
          String(rate.bookable_id) === externalRoomTypeId &&
          rate.wbe,
      )
      .map((rate) => ({
        externalRateId: String(rate.id),
        name: rate.name?.trim() || `Rate ${rate.id}`,
        maxAdults: rate.rate_restriction?.max_adults ?? null,
        maxChildren: rate.rate_restriction?.max_children ?? null,
      }));
    return { ok: true, value: rates };
  }

  private async fetch<T>(
    credentials: ClockConnectionCredentials,
    query?: Record<string, string | string[]>,
    path = '/rates_availability',
  ): Promise<ClockOutcome<T>> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError)
        return failure({
          category: 'provider_unavailable',
          code: 'clock_provider_unavailable',
          message: error.message,
          retryable: true,
        });
      throw error;
    }

    const rateLimit = await this.rateLimiter.consume(credentials.apiUser);
    if (!rateLimit.allowed)
      return failure({
        category: 'rate_limited',
        code: 'clock_rate_limited',
        message: `Too many Clock requests right now — try again in ${rateLimit.retryAfterSeconds}s.`,
        retryable: true,
      });

    try {
      const response = await this.client.request<T>(credentials, {
        api: 'pms_api',
        method: 'GET',
        path,
        query,
        timeoutMs: 15_000,
      });
      if (response.status < 200 || response.status >= 300) {
        this.circuitBreaker.recordFailure(breakerKey);
        return failure(classifyClockHttpResponse(response.status, response.body));
      }
      this.circuitBreaker.recordSuccess(breakerKey);
      return { ok: true, value: response.body };
    } catch (error) {
      this.circuitBreaker.recordFailure(breakerKey);
      if (error instanceof ClockHttpError)
        return failure(
          classifyClockClientFailure(error.isTimeout ? 'timeout' : 'network', error.message),
        );
      throw error;
    }
  }
}

type ClockOutcome<T> = { ok: true; value: T } | { ok: false; error: ClockClassifiedError };

function failure(error: ClockClassifiedError): { ok: false; error: ClockClassifiedError } {
  return { ok: false, error };
}

/** Distinguishes "no Clock rate at all" from "has rates, none published to
 * the booking engine" — the two need different, actionable error text. */
function noRatesError(rates: RoomTypeRates): ClockClassifiedError {
  return classifyConfigurationError(
    rates.excludedForWbe > 0
      ? "This room type has Clock rates configured, but none are published to the booking engine (wbe) — check Clock's rate configuration."
      : 'This room type has no rate configured in Clock yet.',
  );
}

/**
 * Deterministic offer selection among a room type's `/products` offers
 * (Task 12). Replaces relying on `Object.values(...).find(...)`, which
 * silently picks whichever rate id sorts numerically lowest — a real bug
 * confirmed against the real sandbox 2026-09-10, not Clock's response
 * order, not price, not any considered business rule. Only ever considers
 * `available && no-errors` offers.
 *
 * `rankOrder` (Task 13 — a staff-defined per-room-type rate priority list)
 * takes precedence when given: the highest-ranked rate id with a valid
 * offer wins even if a lower-ranked one is cheaper. Without it, falls back
 * to the lowest price, so quoting still works before any ranking exists.
 */
function selectBestOffer(
  rateOffers: Record<string, ClockProductOffer[]>,
  rankOrder?: string[],
): { rateId: string; offer: ClockProductOffer } | undefined {
  const valid: Array<{ rateId: string; offer: ClockProductOffer }> = [];
  for (const [rateId, offers] of Object.entries(rateOffers)) {
    for (const offer of offers) {
      if (offer.available && Object.keys(offer.errors ?? {}).length === 0) valid.push({ rateId, offer });
    }
  }
  if (valid.length === 0) return undefined;

  if (rankOrder) {
    for (const rankedId of rankOrder) {
      const match = valid.find((entry) => entry.rateId === rankedId);
      if (match) return match;
    }
  }

  return valid.reduce((best, entry) => (entry.offer.price.cents < best.offer.price.cents ? entry : best));
}

/** Every calendar date the guest actually occupies the room: [startsOn, endsOn). */
function nightsBetween(startsOn: string, endsOn: string): string[] {
  const nights: string[] = [];
  const cursor = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  while (cursor < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

/**
 * Splits `total` across `nights` in proportion to each night's relative
 * weight in `shapeCents`, using the largest-remainder method so the parts
 * always sum to exactly `total` in cents — never off by a rounding cent,
 * regardless of what Clock's per-night shape looked like. Falls back to an
 * even split if every night's weight is zero (a degenerate shape).
 */
function distributeToNights(
  nights: string[],
  shapeCents: Record<string, number>,
  total: Money,
): NightlyRate[] {
  const totalCents = Math.round(Number(total.amount) * 100);
  const shapeSum = nights.reduce((sum, night) => sum + shapeCents[night]!, 0);
  if (shapeSum <= 0) return evenSplitToNights(nights, totalCents);

  const shares = nights.map((night) => {
    const exact = (shapeCents[night]! / shapeSum) * totalCents;
    const floor = Math.floor(exact);
    return { night, floor, remainder: exact - floor };
  });
  let leftover = totalCents - shares.reduce((sum, share) => sum + share.floor, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break;
    share.floor += 1;
    leftover -= 1;
  }

  const cents = new Map(shares.map((share) => [share.night, share.floor]));
  return nights.map((night) => ({ date: night, amount: (cents.get(night)! / 100).toFixed(2) }));
}

function evenSplitToNights(nights: string[], totalCents: number): NightlyRate[] {
  const base = Math.floor(totalCents / nights.length);
  let leftover = totalCents - base * nights.length;
  return nights.map((night) => {
    const amount = base + (leftover > 0 ? 1 : 0);
    leftover = Math.max(0, leftover - 1);
    return { date: night, amount: (amount / 100).toFixed(2) };
  });
}

function summarizeAvailability(
  query: AvailabilityQuery,
  nights: string[],
  response: ClockRateAvailabilityResponse,
  externalRoomTypeId: string,
): AvailabilityResult {
  const roomType = response.find((item) => String(item.id) === externalRoomTypeId);
  const rateEntries = roomType ? Object.values(roomType.rates) : [];

  let isAvailable = true;
  let availableUnits = Number.POSITIVE_INFINITY;
  for (const night of nights) {
    let bestForNight = 0;
    for (const dates of rateEntries) {
      const entry = dates[night];
      if (entry?.free && entry.room_type_free_rooms > bestForNight)
        bestForNight = entry.room_type_free_rooms;
    }
    if (bestForNight <= 0) {
      isAvailable = false;
      availableUnits = 0;
      break;
    }
    availableUnits = Math.min(availableUnits, bestForNight);
  }

  return {
    roomTypeId: query.roomTypeId,
    startsOn: query.startsOn,
    endsOn: query.endsOn,
    isAvailable,
    availableUnits: Number.isFinite(availableUnits) ? availableUnits : 0,
  };
}
