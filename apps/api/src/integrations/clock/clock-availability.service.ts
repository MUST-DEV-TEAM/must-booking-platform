import { setTimeout as wait } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { minimumStayForOpenRates } from '../../booking/booking-rules';
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
import {
  ClockBookingConsistencyService,
  ClockBookingReadError,
} from './clock-booking-consistency.service';

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
        // Confirmed against a real sandbox incident (2026-09-28): Clock can
        // report `free: true` with real `room_type_free_rooms` on a night a
        // staff member has explicitly stopped from sale — `errors` carries a
        // "rate_restriction_stop_from_sale?" key, but `rate_restriction.
        // stop_from_sale` is the reliable structured field. /products (the
        // real quote endpoint) always refuses such a night; summarizeAvailability
        // must therefore also refuse it, not just check `free`.
        rate_restriction?: {
          stop_from_sale?: boolean;
          close_for_arrival?: boolean;
          close_for_departure?: boolean;
          min_stay?: number | null;
          min_stay_on_arrival?: number | null;
        };
      }
    >
  >;
}>;

/**
 * Why a calendar day is (not) bookable. `closed` means rooms exist but sales
 * were switched off in Clock (stop-sale, e.g. a staff vacation block), which
 * is different from `sold_out` (no rooms left, or none that fit the party).
 * `unavailable` is for sources that cannot tell the two apart.
 */
export type CalendarDayStatus = 'available' | 'sold_out' | 'closed' | 'unavailable';

export interface CalendarDay {
  referencePrice?: Money;
  /** Clock-reported physical free rooms, independent of stop-sale restrictions. */
  availableUnits?: number;
  date: string;
  isAvailable: boolean;
  status: CalendarDayStatus;
  /** Only present on an available day, and only when Clock restricts it. */
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  minStay?: number;
}

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

/** Said when a property is not connected to Clock; callers that only apply to Clock hotels match it. */
export const NO_CLOCK_CONNECTION_MESSAGE = 'This property has no active Clock PMS connection.';

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
  childrenAges?: number[];
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
type RoomTypeRates = {
  ids: string[];
  excludedForWbe: number;
  /** Display facts per published rate id (name and meals), from the same `/rates/` call. */
  info: Record<string, ClockRateInfo>;
};

/** What a guest needs to tell two published rates of one room type apart. */
export type ClockRateInfo = {
  rateId: string;
  /** Clock's own rate name, for example "BB" or "FB". */
  name: string;
  /** Plain-language label derived from the rate's meals, for example "Bed & breakfast". */
  label: string;
  mealNames: string[];
  currency: string | null;
};

/** One bookable offer for a stay: a published rate with its real total from `/products`. */
export type ClockStayOffer = {
  rateId: string;
  name: string;
  label: string;
  mealNames: string[];
  total: Money;
};

/**
 * A plain label for a rate from its meals. Clock names rates by code ("BB", "FB"), which means
 * nothing to a guest. Unrecognised meal combinations fall back to Clock's own rate name.
 */
export function rateOfferLabel(mealNames: string[], fallbackName: string): string {
  const meals = new Set(mealNames.map((meal) => meal.trim().toLowerCase()).filter(Boolean));
  const has = (meal: string) => meals.has(meal);
  if (meals.size === 0) return 'Room only';
  if (has('breakfast') && has('lunch') && has('dinner')) return 'Full board';
  if (has('breakfast') && meals.size === 1) return 'Bed & breakfast';
  if (has('breakfast') && meals.size === 2 && (has('lunch') || has('dinner'))) return 'Half board';
  return fallbackName.trim() || mealNames.join(', ');
}

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
// Display prices are informational only (the quote before payment is re-priced and
// authoritative), so they are kept for a few hours: a hotel is not a fast-moving market
// and a cold page load costs many Clock requests. If a refresh fails, the last known
// price is still shown for up to a day rather than "Price unavailable".
const DISPLAY_PRICE_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
// The whole rate catalogue changes rarely; a few minutes is plenty and a wrong rate id cannot be booked
// because the quote and the booking re-read prices from Clock.
const RATE_CATALOGUE_CACHE_TTL_MS = 10 * 60 * 1000;
const DISPLAY_PRICE_STALE_MS = 24 * 60 * 60 * 1000;
// Search-time checks are advisory, so a short cache prevents repeated date
// changes and parallel tabs from hammering Clock. The pre-payment guard keeps
// the default uncached and remains the authoritative final check.
const BOOKING_AVAILABILITY_CACHE_TTL_MS = 45_000;

/** Cache keys must name the whole Clock connection: two hotels can share an API user name. */
function connectionIdentity(credentials: ClockConnectionCredentials): string {
  return [
    credentials.host,
    credentials.accountId,
    credentials.subscriptionId,
    credentials.apiUser,
  ].join('|');
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

type ClockRateRow = {
  id: number | string;
  bookable_id: number | string;
  bookable_type: string;
  wbe: boolean;
  name?: string;
  currency?: string;
  meals?: Array<{ name?: string }>;
};

@Injectable()
export class ClockAvailabilityService {
  private readonly logger = new Logger(ClockAvailabilityService.name);
  private readonly calendarCache = new Map<string, CacheEntry<CalendarDay[]>>();
  private readonly availabilityCache = new Map<string, CacheEntry<AvailabilityResult>>();
  private readonly ratesCache = new Map<string, CacheEntry<RoomTypeRates>>();
  private readonly catalogueCache = new Map<string, CacheEntry<ClockRateRow[]>>();
  private readonly pendingCatalogue = new Map<string, Promise<ClockOutcome<ClockRateRow[]>>>();
  private readonly pendingStayQuotes = new Map<string, Promise<Record<string, Result<Money>>>>();
  private readonly displayPriceCache = new Map<string, CacheEntry<Money>>();
  private readonly bookingAvailabilityCache = new Map<string, CacheEntry<boolean>>();

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
    @Inject(ClockRateRankingService) private readonly rateRankings: ClockRateRankingService,
    @Inject(ClockBookingConsistencyService)
    private readonly bookingConsistency: ClockBookingConsistencyService,
  ) {}

  /**
   * Availability check used by both search-time advisory checks and the
   * uncached pre-payment guard. Room-type selections use
   * `/rates_availability`, while physical-room selections use the verified
   * booking-overlap/detail pattern in ClockBookingConsistencyService.
   * Search-time callers may opt into a short-lived cache; the default remains
   * uncached so a cached answer can never gate booking creation.
   */
  async isAvailableForBooking(
    tenantId: string,
    propertyId: string,
    query: {
      roomTypeId: string;
      roomId?: string;
      startsOn: string;
      endsOn: string;
      adultCount?: number;
      childrenCount?: number;
      childrenAges?: number[];
    },
    options: { cache?: boolean } = {},
  ): Promise<Result<boolean>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const cacheKey = JSON.stringify([
      'clock-booking-availability-v1',
      tenantId,
      propertyId,
      connection.connectionId,
      query.roomTypeId,
      query.roomId ?? '',
      query.startsOn,
      query.endsOn,
      query.adultCount ?? 1,
      query.childrenCount ?? 0,
      query.childrenAges ?? [],
    ]);
    if (options.cache) {
      const cached = this.bookingAvailabilityCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return { ok: true, value: cached.value };
    }

    if (query.roomId) {
      const externalRoomId = await this.mappedExternalRoomId(tenantId, propertyId, query.roomId);
      if (!externalRoomId)
        return failure(
          classifyConfigurationError(
            'This room has no confirmed Clock catalog mapping — sync and confirm it first.',
          ),
        );
      try {
        const hasConflict = await this.bookingConsistency.hasActiveRoomConflict(
          parsed.value,
          { startsOn: query.startsOn, endsOn: query.endsOn },
          externalRoomId,
        );
        const value = !hasConflict;
        if (options.cache)
          this.bookingAvailabilityCache.set(cacheKey, {
            value,
            expiresAt: Date.now() + BOOKING_AVAILABILITY_CACHE_TTL_MS,
          });
        return { ok: true, value };
      } catch (error) {
        if (error instanceof ClockBookingReadError) return failure(error.classified);
        throw error;
      }
    }

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
    const nights = nightsBetween(query.startsOn, query.endsOn);
    if (nights.length === 0)
      return failure(classifyConfigurationError('startsOn must be before endsOn.'));

    const response = await this.fetch<ClockRateAvailabilityResponse>(parsed.value, {
      from: query.startsOn,
      to: nights[nights.length - 1]!,
      rates: rateIds.value.ids,
      room_types: externalRoomTypeId,
      adults: String(query.adultCount ?? 1),
      children: String(query.childrenCount ?? 0),
      ...(query.childrenAges?.length ? { children_ages: query.childrenAges.map(String) } : {}),
    });
    if (!response.ok) return failure(response.error);
    const value = summarizeAvailability(
      query,
      nights,
      response.value,
      externalRoomTypeId,
    ).isAvailable;
    if (options.cache)
      this.bookingAvailabilityCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + BOOKING_AVAILABILITY_CACHE_TTL_MS,
      });
    return {
      ok: true,
      value,
    };
  }

  /**
   * Uncached check of several physical rooms for one stay, sharing a single read of
   * Clock's overlapping reservations. Returns the local room ids Clock shows as taken.
   */
  async unavailableRoomsForBooking(
    tenantId: string,
    propertyId: string,
    query: {
      roomIds: string[];
      startsOn: string;
      endsOn: string;
      excludeExternalBookingId?: string;
    },
  ): Promise<Result<string[]>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const externalIds = new Map<string, string>();
    for (const roomId of query.roomIds) {
      const externalRoomId = await this.mappedExternalRoomId(tenantId, propertyId, roomId);
      if (!externalRoomId)
        return failure(
          classifyConfigurationError(
            'This room has no confirmed Clock catalog mapping — sync and confirm it first.',
          ),
        );
      externalIds.set(roomId, externalRoomId);
    }
    try {
      const taken = await this.bookingConsistency.activeRoomConflicts(
        parsed.value,
        { startsOn: query.startsOn, endsOn: query.endsOn },
        [...externalIds.values()],
        query.excludeExternalBookingId,
      );
      return {
        ok: true,
        value: query.roomIds.filter((roomId) => taken.has(externalIds.get(roomId)!)),
      };
    } catch (error) {
      if (error instanceof ClockBookingReadError) return failure(error.classified);
      throw error;
    }
  }

  /**
   * `skipCache` exists for Task 10's final pre-booking availability check
   * (source brief section 16: a cached answer must never gate booking
   * creation), not used yet since booking creation isn't implemented here.
   */
  async getAvailability(
    tenantId: string,
    propertyId: string,
    query: AvailabilityQuery & { childrenAges?: number[] },
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

    const adultCount = query.adultCount ?? 1;
    const childrenCount = query.childrenCount ?? 0;
    const cacheKey = `${tenantId}:${propertyId}:${connection.connectionId}:${externalRoomTypeId}:${query.startsOn}:${query.endsOn}:${adultCount}:${childrenCount}:${JSON.stringify(query.childrenAges ?? [])}`;
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

    // Always send occupancy to Clock, matching isAvailableForBooking, so a
    // rate's occupancy restrictions apply consistently everywhere this room
    // type's availability is asked about (search listing, calendar, and the
    // final pre-booking check) — see docs/archive .../ADR-0005.
    const response = await this.fetch<ClockRateAvailabilityResponse>(parsed.value, {
      from: query.startsOn,
      to: nights[nights.length - 1],
      rates: rateIds.value.ids,
      room_types: externalRoomTypeId,
      adults: String(adultCount),
      children: String(childrenCount),
      ...(query.childrenAges?.length ? { children_ages: query.childrenAges.map(String) } : {}),
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
      childrenAges?: number[];
      clockRateId?: string;
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
      childrenAges: query.childrenAges,
      chosenRateId: query.clockRateId,
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
    const key = JSON.stringify([
      tenantId,
      propertyId,
      queries
        .map((query) => ({ ...query }))
        .sort((a, b) => a.roomTypeId.localeCompare(b.roomTypeId)),
    ]);
    const pending = this.pendingStayQuotes.get(key);
    if (pending) return pending;
    const request = this.loadQuotesForStay(tenantId, propertyId, queries);
    this.pendingStayQuotes.set(key, request);
    try {
      return await request;
    } finally {
      if (this.pendingStayQuotes.get(key) === request) this.pendingStayQuotes.delete(key);
    }
  }

  private async loadQuotesForStay(
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
      uniqueQueries.forEach((query) => {
        results[query.roomTypeId] = failure(error);
      });
      return results;
    }
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) {
      uniqueQueries.forEach((query) => {
        results[query.roomTypeId] = failure(classifyConfigurationError(parsed.message));
      });
      return results;
    }

    // /rates/ returns the entire catalogue. Share one cold-cache fetch within
    // this tenant/property request, leaving allowance for the products query.
    let batchRates: Promise<ClockOutcome<ClockRateRow[]>> | undefined;
    const loadBatchRates = () =>
      (batchRates ??= this.fetch<ClockRateRow[]>(parsed.value, undefined, '/rates/'));
    const resolved = await Promise.all(
      uniqueQueries.map(async (query) => {
        const externalRoomTypeId =
          query.externalRoomTypeId ??
          (await this.mappedExternalRoomTypeId(tenantId, propertyId, query.roomTypeId));
        if (!externalRoomTypeId) {
          return {
            query,
            externalRoomTypeId: null,
            rates: failure(
              classifyConfigurationError(
                'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
              ),
            ),
          };
        }
        return {
          query,
          externalRoomTypeId,
          rates: await this.ratesForRoomType(parsed.value, externalRoomTypeId, loadBatchRates),
        };
      }),
    );

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
    // Expired but recent prices, used only if Clock cannot be reached for the refresh.
    const lastKnown: Record<string, Money> = {};
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
        if (cached.expiresAt + DISPLAY_PRICE_STALE_MS > Date.now())
          lastKnown[entry.query.roomTypeId] = cached.value;
        else this.displayPriceCache.delete(cacheKey);
        return true;
      }
      results[entry.query.roomTypeId] = { ok: true, value: cached.value };
      return false;
    });
    if (misses.length === 0) return results;

    const first = misses[0]!.entry.query;
    const rateIds = Array.from(
      new Set(misses.flatMap(({ entry }) => (entry.rates.ok ? entry.rates.value.ids : []))),
    );
    const response = await this.fetch<ClockProductsResponse>(
      parsed.value,
      {
        'product_search[arrival]': first.startsOn,
        'product_search[departure]': first.endsOn,
        'product_search[adult_count]': String(first.adultCount ?? 1),
        'product_search[children_count]': String(first.childrenCount ?? 0),
        ...(first.childrenAges?.length
          ? { 'product_search[children_ages]': first.childrenAges.map(String) }
          : {}),
        rates: rateIds,
      },
      '/products',
    );
    if (!response.ok) {
      misses.forEach(({ entry }) => {
        const known = lastKnown[entry.query.roomTypeId];
        results[entry.query.roomTypeId] = known
          ? { ok: true, value: known }
          : failure(response.error);
      });
      return results;
    }

    misses.forEach(({ entry, rankOrder }) => {
      const roomType = response.value.find((item) => String(item.id) === entry.externalRoomTypeId);
      const winner = roomType ? selectBestOffer(roomType.rates, rankOrder) : undefined;
      if (!winner) {
        this.logger.warn(
          `No available Clock offer for room type ${entry.query.roomTypeId} (${entry.query.startsOn} to ${entry.query.endsOn}): ${JSON.stringify(rejectionReasons(roomType?.rates))}`,
          rejectionReasons(roomType?.rates),
        );
        results[entry.query.roomTypeId] = failure({
          category: 'validation',
          code: 'clock_rate_unavailable',
          message: 'Clock has no available price for the requested stay.',
          retryable: false,
        });
        return;
      }
      const value = {
        amount: (winner.offer.price.cents / 100).toFixed(2),
        currency: winner.offer.price.currency,
      };
      const cacheKey = this.displayPriceCacheKey(
        tenantId,
        propertyId,
        connection.connectionId,
        entry.query,
        String(entry.externalRoomTypeId),
        entry.rates.ok ? entry.rates.value.ids : [],
        rankOrder,
      );
      this.displayPriceCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + DISPLAY_PRICE_CACHE_TTL_MS,
      });
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
      query.childrenAges ?? [],
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
      childrenAges?: number[];
      requiredRateId?: string;
      /** The rate the guest chose from the offers; only that rate may win. */
      chosenRateId?: string;
    },
  ): Promise<Result<ClockRateSelection>> {
    const rateIds = await this.ratesForRoomType(credentials, query.externalRoomTypeId);
    if (!rateIds.ok) return failure(rateIds.error);
    if (rateIds.value.ids.length === 0) return failure(noRatesError(rateIds.value));
    if (query.requiredRateId && !rateIds.value.ids.includes(query.requiredRateId))
      return failure(
        classifyConfigurationError(
          'The original Clock rate is private or unavailable. Review this amendment in Clock.',
        ),
      );
    if (query.chosenRateId && !rateIds.value.ids.includes(query.chosenRateId))
      return failure({
        category: 'validation',
        code: 'clock_rate_unavailable',
        message: 'The selected rate is not available for this room type.',
        retryable: false,
      });
    const selectedIds = query.requiredRateId
      ? [query.requiredRateId]
      : query.chosenRateId
        ? [query.chosenRateId]
        : rateIds.value.ids;

    // adult_count/children_count are always sent, never left to the caller
    // to remember. Clock only enforces max_adults/max_children on a rate
    // when these are present, so defaulting here means enforcement cannot be
    // silently skipped.
    const productSearch: Record<string, string | string[]> = {
      'product_search[arrival]': query.startsOn,
      'product_search[departure]': query.endsOn,
      'product_search[adult_count]': String(query.adultCount ?? 1),
      'product_search[children_count]': String(query.childrenCount ?? 0),
      ...(query.childrenAges?.length
        ? { 'product_search[children_ages]': query.childrenAges.map(String) }
        : {}),
    };

    const response = await this.fetch<ClockProductsResponse>(
      credentials,
      { ...productSearch, rates: selectedIds },
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
    if (!winner) {
      // The real rejection reason (Clock's per-offer `errors`, e.g. a
      // staff-set stop-from-sale or a min-stay restriction) was previously
      // discarded here, leaving only a generic message — undiagnosable
      // without reproducing the exact /products call by hand. Logging it
      // costs nothing (this only runs on the failure path already being
      // returned) and turns a one-off investigation into a log lookup.
      this.logger.warn(
        `No available Clock offer for room type ${query.roomTypeId} (${query.startsOn} to ${query.endsOn}): ${JSON.stringify(rejectionReasons(roomType?.rates))}`,
        rejectionReasons(roomType?.rates),
      );
      return failure({
        category: 'validation',
        code: 'clock_rate_unavailable',
        message: 'Clock has no available price for the requested stay.',
        retryable: false,
      });
    }

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
   * Every published rate that can be booked for the stay, with its real total, so a guest can
   * choose between for example "Bed & breakfast" and "Full board". Uses the same `/products`
   * search and the same validity rules as `selectRateForStay` (available, no errors, published
   * to the booking engine). Ordered by the staff's rate ranking first, then price. An empty list
   * means nothing is bookable for those dates; the caller decides how to say so.
   */
  /**
   * The currency the hotel sells in at Clock: the most common currency among the rates it publishes for
   * online booking. Null when the hotel is not on Clock or Clock cannot be read.
   */
  async publishedRateCurrency(tenantId: string, propertyId: string): Promise<string | null> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS') return null;
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return null;
    const catalogue = await this.rateCatalogue(parsed.value, false);
    if (!catalogue.ok) return null;
    const counts = new Map<string, number>();
    for (const rate of catalogue.value) {
      const currency = typeof rate.currency === 'string' ? rate.currency.toUpperCase() : '';
      if (rate.wbe && /^[A-Z]{3}$/.test(currency))
        counts.set(currency, (counts.get(currency) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  async listOffersForStay(
    tenantId: string,
    propertyId: string,
    query: {
      roomTypeId: string;
      startsOn: string;
      endsOn: string;
      adultCount?: number;
      childrenCount?: number;
      childrenAges?: number[];
    },
  ): Promise<Result<ClockStayOffer[]>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(classifyConfigurationError(NO_CLOCK_CONNECTION_MESSAGE));
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
    const rates = await this.ratesForRoomType(parsed.value, externalRoomTypeId);
    if (!rates.ok) return failure(rates.error);
    if (rates.value.ids.length === 0) return failure(noRatesError(rates.value));

    const response = await this.fetch<ClockProductsResponse>(
      parsed.value,
      {
        'product_search[arrival]': query.startsOn,
        'product_search[departure]': query.endsOn,
        'product_search[adult_count]': String(query.adultCount ?? 1),
        'product_search[children_count]': String(query.childrenCount ?? 0),
        ...(query.childrenAges?.length
          ? { 'product_search[children_ages]': query.childrenAges.map(String) }
          : {}),
        rates: rates.value.ids,
      },
      '/products',
    );
    if (!response.ok) return failure(response.error);

    const rankOrder = await this.rateRankings.rankOrder(tenantId, propertyId, query.roomTypeId);
    const roomType = response.value.find((item) => String(item.id) === externalRoomTypeId);
    const offers = roomType ? collectValidOffers(roomType.rates) : [];
    return {
      ok: true,
      value: orderOffers(offers, rankOrder).map(({ rateId, offer }) => {
        const info = rates.value.info[rateId];
        return {
          rateId,
          name: info?.name ?? '',
          label: info?.label ?? rateOfferLabel([], info?.name ?? ''),
          mealNames: info?.mealNames ?? [],
          total: {
            amount: (offer.price.cents / 100).toFixed(2),
            currency: offer.price.currency,
          },
        };
      }),
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
      childrenAges?: number[];
      clockRateId?: string;
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
    // A guest-chosen rate prices every night; otherwise every published rate competes.
    const pricedRateIds = query.clockRateId ? [query.clockRateId] : rateIds.value.ids;

    const nights = nightsBetween(query.startsOn, query.endsOn);
    const shape = await this.nightlyShapeFromAvailability(
      parsed.value,
      externalRoomTypeId,
      pricedRateIds,
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
        ...(query.childrenAges?.length
          ? { 'product_search[children_ages]': query.childrenAges.map(String) }
          : {}),
        rates: pricedRateIds,
      };
      const response = await this.fetch<ClockProductsResponse>(
        parsed.value,
        productSearch,
        '/products',
      );
      if (!response.ok) return failure(response.error);
      const roomType = response.value.find((item) => String(item.id) === externalRoomTypeId);
      const winner = roomType ? selectBestOffer(roomType.rates, rankOrder) : undefined;
      if (!winner) {
        this.logger.warn(
          `No available Clock offer for room type ${query.roomTypeId} on ${date}: ${JSON.stringify(rejectionReasons(roomType?.rates))}`,
          rejectionReasons(roomType?.rates),
        );
        return failure(classifyConfigurationError(`Clock has no available price for ${date}.`));
      }
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
    query: { adultCount?: number; childrenCount?: number; childrenAges?: number[] },
  ): Promise<Record<string, number> | null> {
    if (rateIds.length === 0 || nights.length === 0) return null;

    const availabilityQuery: Record<string, string | string[]> = {
      from: nights[0]!,
      to: nights[nights.length - 1]!,
      rates: rateIds,
      room_types: externalRoomTypeId,
      adults: String(query.adultCount ?? 1),
      children: String(query.childrenCount ?? 0),
      ...(query.childrenAges?.length ? { children_ages: query.childrenAges.map(String) } : {}),
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
        if (cheapestCents === null || entry.price.cents < cheapestCents)
          cheapestCents = entry.price.cents;
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
    query: {
      roomTypeId: string;
      fresh?: boolean;
      month: string;
      adultCount?: number;
      childrenCount?: number;
      childrenAges?: number[];
      roomCount?: number;
    },
  ): Promise<Result<CalendarDay[]>> {
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

    const calendarKey = JSON.stringify([
      tenantId,
      propertyId,
      connection.connectionId,
      externalRoomTypeId,
      query.month,
      query.adultCount ?? 1,
      query.childrenCount ?? 0,
      query.childrenAges ?? [],
      query.roomCount ?? 1,
    ]);
    const cachedCalendar = this.calendarCache.get(calendarKey);
    if (!query.fresh && cachedCalendar && cachedCalendar.expiresAt > Date.now())
      return { ok: true, value: cachedCalendar.value };
    const rateIds = await this.ratesForRoomType(
      parsed.value,
      externalRoomTypeId,
      undefined,
      query.fresh,
    );
    if (!rateIds.ok) return failure(rateIds.error);
    if (rateIds.value.ids.length === 0) return failure(noRatesError(rateIds.value));

    if (!/^\d{4}-\d{2}$/.test(query.month))
      return failure(classifyConfigurationError('month must be YYYY-MM.'));
    const [year, monthNumber] = query.month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year!, monthNumber! - 1, 1)).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);
    const nights = nightsBetween(monthStart, monthEnd);

    // Same occupancy Clock uses for getAvailability/isAvailableForBooking, so
    // a day this calendar shows as open never disagrees with the listing or
    // the final Select-step check for the same guest count.
    const response = await this.fetch<ClockRateAvailabilityResponse>(parsed.value, {
      from: monthStart,
      to: nights[nights.length - 1]!,
      rates: rateIds.value.ids,
      room_types: externalRoomTypeId,
      adults: String(query.adultCount ?? 1),
      children: String(query.childrenCount ?? 0),
      ...(query.childrenAges?.length ? { children_ages: query.childrenAges.map(String) } : {}),
    });
    if (!response.ok) return failure(response.error);

    const roomType = response.value.find((item) => String(item.id) === externalRoomTypeId);
    const rateEntries = roomType ? Object.values(roomType.rates) : [];
    const roomsNeeded = Math.max(1, query.roomCount ?? 1);
    const days = nights.map((date): CalendarDay => {
      const cells = rateEntries.flatMap((entry) => (entry[date] ? [entry[date]] : []));
      // Open means at least one rate can be sold for that night to a party of
      // this size in this many rooms; stop-sale always wins over free rooms.
      const counts = cells
        .map((cell) => cell.room_type_free_rooms)
        .filter((n) => Number.isSafeInteger(n) && n >= 0);
      const availableUnits =
        counts.length === cells.length && counts.length > 0 ? Math.max(...counts) : undefined;
      const openCells = cells.filter(
        (cell) =>
          cell.free &&
          !cell.rate_restriction?.stop_from_sale &&
          cell.room_type_free_rooms >= roomsNeeded,
      );
      if (openCells.length > 0) {
        const day: CalendarDay = {
          date,
          isAvailable: true,
          status: 'available',
          ...(() => {
            const prices = openCells
              .map((c) => c.price)
              .filter(
                (p): p is { cents: number; currency: string } =>
                  !!p &&
                  Number.isSafeInteger(p.cents) &&
                  p.cents >= 0 &&
                  typeof p.currency === 'string',
              );
            if (
              prices.length !== openCells.length ||
              new Set(prices.map((p) => p.currency)).size !== 1
            )
              return {};
            return {
              referencePrice: {
                amount: (Math.min(...prices.map((p) => p.cents)) / 100).toFixed(2),
                currency: prices[0].currency,
              },
            };
          })(),
          ...(availableUnits === undefined ? {} : { availableUnits }),
        };
        // Restrictions only count when every open rate carries them, since a
        // guest can pick whichever rate is unrestricted.
        if (openCells.every((cell) => cell.rate_restriction?.close_for_arrival))
          day.closedToArrival = true;
        if (openCells.every((cell) => cell.rate_restriction?.close_for_departure))
          day.closedToDeparture = true;
        const minStays = openCells.map(
          (cell) =>
            cell.rate_restriction?.min_stay_on_arrival ?? cell.rate_restriction?.min_stay ?? 0,
        );
        const minStay = minimumStayForOpenRates(minStays) ?? 0;
        if (minStay > 1) day.minStay = minStay;
        return day;
      }
      const stoppedWithRooms = cells.some(
        (cell) =>
          cell.free &&
          cell.rate_restriction?.stop_from_sale &&
          cell.room_type_free_rooms >= roomsNeeded,
      );
      return {
        date,
        isAvailable: false,
        status: cells.length === 0 ? 'unavailable' : stoppedWithRooms ? 'closed' : 'sold_out',
        ...(availableUnits === undefined ? {} : { availableUnits }),
      };
    });
    if (this.calendarCache.size >= 1000)
      this.calendarCache.delete(this.calendarCache.keys().next().value!);
    this.calendarCache.set(calendarKey, { value: days, expiresAt: Date.now() + CACHE_TTL_MS });
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
           AND local_entity_id = $3::uuid AND sync_status = 'CONFIRMED' AND connection_id=(SELECT connection_id FROM property_integration_connections WHERE tenant_id=$1::uuid AND property_id=$2::uuid AND kind='PMS' AND enabled)`,
        tenantId,
        propertyId,
        localRoomTypeId,
      ),
    );
    return rows[0]?.externalEntityId ?? null;
  }

  private async mappedExternalRoomId(
    tenantId: string,
    propertyId: string,
    localRoomId: string,
  ): Promise<string | null> {
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ externalEntityId: string }>>(
        `SELECT external_entity_id AS "externalEntityId" FROM clock_catalog_mappings
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND entity_type = 'ROOM'
           AND local_entity_id = $3::uuid AND sync_status = 'CONFIRMED' AND connection_id=(SELECT connection_id FROM property_integration_connections WHERE tenant_id=$1::uuid AND property_id=$2::uuid AND kind='PMS' AND enabled)`,
        tenantId,
        propertyId,
        localRoomId,
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
  /**
   * Clock's /rates/ returns the whole catalogue (every room type), so one read serves all room types.
   * It is kept for a few minutes and shared by concurrent callers; without this, a cold page for a
   * hotel with 13 room types read the same catalogue 13 times.
   */
  private rateCatalogue(
    credentials: ClockConnectionCredentials,
    fresh: boolean,
  ): Promise<ClockOutcome<ClockRateRow[]>> {
    const key = connectionIdentity(credentials);
    const cached = this.catalogueCache.get(key);
    if (!fresh && cached && cached.expiresAt > Date.now())
      return Promise.resolve({ ok: true, value: cached.value });
    const pending = this.pendingCatalogue.get(key);
    if (!fresh && pending) return pending;
    const request = this.fetch<ClockRateRow[]>(credentials, undefined, '/rates/').then((result) => {
      if (result.ok)
        this.catalogueCache.set(key, {
          value: result.value,
          expiresAt: Date.now() + RATE_CATALOGUE_CACHE_TTL_MS,
        });
      return result;
    });
    this.pendingCatalogue.set(key, request);
    const clear = () => {
      if (this.pendingCatalogue.get(key) === request) this.pendingCatalogue.delete(key);
    };
    request.then(clear, clear);
    return request;
  }

  private async ratesForRoomType(
    credentials: ClockConnectionCredentials,
    externalRoomTypeId: string,
    loadRates?: () => Promise<ClockOutcome<ClockRateRow[]>>,
    fresh = false,
  ): Promise<ClockOutcome<RoomTypeRates>> {
    const cacheKey = `${connectionIdentity(credentials)}:${externalRoomTypeId}`;
    const cached = this.ratesCache.get(cacheKey);
    if (!fresh && cached && cached.expiresAt > Date.now()) return { ok: true, value: cached.value };

    const response = await (loadRates ? loadRates() : this.rateCatalogue(credentials, fresh));
    if (!response.ok) return response;
    const forRoomType = response.value.filter(
      (rate) =>
        rate.bookable_type === 'Pms::RoomType' && String(rate.bookable_id) === externalRoomTypeId,
    );
    const published = forRoomType.filter((rate) => rate.wbe);
    const info: Record<string, ClockRateInfo> = {};
    for (const rate of published) {
      const mealNames = (rate.meals ?? []).map((meal) => String(meal.name ?? '')).filter(Boolean);
      info[String(rate.id)] = {
        rateId: String(rate.id),
        name: rate.name ?? '',
        label: rateOfferLabel(mealNames, rate.name ?? ''),
        mealNames,
        currency: rate.currency ?? null,
      };
    }
    const value: RoomTypeRates = {
      ids: published.map((rate) => String(rate.id)),
      excludedForWbe: forRoomType.length - published.length,
      info,
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

    const externalRoomTypeId = await this.mappedExternalRoomTypeId(
      tenantId,
      propertyId,
      roomTypeId,
    );
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

  /**
   * Same data as ratesForRoomTypeDetailed, for every confirmed room type on
   * the property at once. Clock's /rates/ already returns every rate for
   * the whole property regardless of which room type is asked about — the
   * per-room-type method was calling it once per room type and discarding
   * everything except that type's few rows each time, which is what was
   * tripping the shared 4 req/s rate limiter on a page showing many room
   * types (the rate-priority UI, Task 13). This fetches it exactly once and
   * groups the same filtered/mapped rows by room type locally.
   */
  async ratesForAllRoomTypesDetailed(
    tenantId: string,
    propertyId: string,
  ): Promise<Result<Map<string, ClockRateSummary[]>>> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return failure(
        classifyConfigurationError('This property has no active Clock PMS connection.'),
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return failure(classifyConfigurationError(parsed.message));

    const mappings = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ localRoomTypeId: string; externalRoomTypeId: string }>>(
        `SELECT local_entity_id AS "localRoomTypeId", external_entity_id AS "externalRoomTypeId"
           FROM clock_catalog_mappings
           WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND entity_type = 'ROOM_TYPE'
             AND sync_status = 'CONFIRMED'`,
        tenantId,
        propertyId,
      ),
    );
    if (mappings.length === 0) return { ok: true, value: new Map() };

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

    const byExternalRoomTypeId = new Map<string, ClockRateSummary[]>();
    for (const rate of response.value) {
      if (rate.bookable_type !== 'Pms::RoomType' || !rate.wbe) continue;
      const externalRoomTypeId = String(rate.bookable_id);
      const summary: ClockRateSummary = {
        externalRateId: String(rate.id),
        name: rate.name?.trim() || `Rate ${rate.id}`,
        maxAdults: rate.rate_restriction?.max_adults ?? null,
        maxChildren: rate.rate_restriction?.max_children ?? null,
      };
      const existing = byExternalRoomTypeId.get(externalRoomTypeId);
      if (existing) existing.push(summary);
      else byExternalRoomTypeId.set(externalRoomTypeId, [summary]);
    }

    const byLocalRoomTypeId = new Map<string, ClockRateSummary[]>();
    for (const mapping of mappings) {
      byLocalRoomTypeId.set(
        mapping.localRoomTypeId,
        byExternalRoomTypeId.get(mapping.externalRoomTypeId) ?? [],
      );
    }
    return { ok: true, value: byLocalRoomTypeId };
  }

  private async fetch<T>(
    credentials: ClockConnectionCredentials,
    query?: Record<string, string | string[]>,
    path = '/rates_availability',
  ): Promise<ClockOutcome<T>> {
    for (let retry = 0; ; retry++) {
      const result = await this.fetchOnce<T>(credentials, query, path);
      if (
        result.ok ||
        result.error.category !== 'rate_limited' ||
        result.error.code === 'clock_request_busy' ||
        retry >= 2
      )
        return result;
      await wait(500 * 2 ** retry);
    }
  }

  private async fetchOnce<T>(
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

    let permitted = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const limit = await this.rateLimiter.consume(credentials.apiUser);
      if (limit.allowed) {
        permitted = true;
        break;
      }
      if (attempt < 7) await wait(Math.min(1000, Math.max(100, limit.retryAfterSeconds * 1000)));
    }
    if (!permitted)
      return failure({
        category: 'rate_limited',
        code: 'clock_request_busy',
        message: 'Availability is taking longer to update. Please try again shortly.',
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
        if (response.status !== 429) this.circuitBreaker.recordFailure(breakerKey);
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
      if (offer.available && Object.keys(offer.errors ?? {}).length === 0)
        valid.push({ rateId, offer });
    }
  }
  if (valid.length === 0) return undefined;

  if (rankOrder) {
    for (const rankedId of rankOrder) {
      const match = valid.find((entry) => entry.rateId === rankedId);
      if (match) return match;
    }
  }

  return valid.reduce((best, entry) =>
    entry.offer.price.cents < best.offer.price.cents ? entry : best,
  );
}

/** The offers a guest could actually book: available and without any restriction error. */
function collectValidOffers(
  rateOffers: Record<string, ClockProductOffer[]>,
): Array<{ rateId: string; offer: ClockProductOffer }> {
  const valid: Array<{ rateId: string; offer: ClockProductOffer }> = [];
  for (const [rateId, offers] of Object.entries(rateOffers)) {
    for (const offer of offers) {
      if (offer.available && Object.keys(offer.errors ?? {}).length === 0)
        valid.push({ rateId, offer });
    }
  }
  return valid;
}

/** Staff-ranked rates first (in rank order), then the rest by price, then by rate id. */
function orderOffers(
  offers: Array<{ rateId: string; offer: ClockProductOffer }>,
  rankOrder?: string[],
): Array<{ rateId: string; offer: ClockProductOffer }> {
  const rankOf = (rateId: string) => {
    const index = rankOrder?.indexOf(rateId) ?? -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...offers].sort(
    (a, b) =>
      rankOf(a.rateId) - rankOf(b.rateId) ||
      a.offer.price.cents - b.offer.price.cents ||
      a.rateId.localeCompare(b.rateId, undefined, { numeric: true }),
  );
}

/** Every non-empty `errors` object Clock returned, keyed by rate id, for the
 * diagnostic log when no offer wins — the same shape `selectBestOffer` reads
 * to reject an offer, surfaced instead of discarded. */
function rejectionReasons(
  rateOffers: Record<string, ClockProductOffer[]> | undefined,
): Record<string, Array<Record<string, unknown>>> {
  const reasons: Record<string, Array<Record<string, unknown>>> = {};
  for (const [rateId, offers] of Object.entries(rateOffers ?? {})) {
    const errors = offers
      .map((offer) => offer.errors)
      .filter(
        (errors): errors is Record<string, unknown> => !!errors && Object.keys(errors).length > 0,
      );
    if (errors.length > 0) reasons[rateId] = errors;
  }
  return reasons;
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
  query: AvailabilityQuery & { childrenAges?: number[] },
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
      if (
        entry?.free &&
        !entry.rate_restriction?.stop_from_sale &&
        entry.room_type_free_rooms > bestForNight
      )
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
