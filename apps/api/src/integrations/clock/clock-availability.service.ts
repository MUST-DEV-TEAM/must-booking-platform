import { Inject, Injectable } from '@nestjs/common';
import type { AvailabilityQuery, AvailabilityResult, Result } from '@must/domain-contracts';

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

// Confirmed against the real sandbox (2026-08-04) and Clock's own public
// Postman docs: GET /rates_availability requires `from`, `to`, `rates`
// (one or more rate plan ids), and one of `room_types`/`rooms`. Response is
// an array of { id, rates: { [rateId]: { [date]: { free, room_type_free_rooms } } } }.
// See docs/CLOCK_ENDPOINT_MATRIX.md.
type ClockRateAvailabilityResponse = Array<{
  id: number | string;
  rates: Record<string, Record<string, { free: boolean; room_type_free_rooms: number }>>;
}>;

const CACHE_TTL_MS = 60_000; // Task 8 acceptance: short-lived cache, no fixed brief-specified TTL.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class ClockAvailabilityService {
  private readonly availabilityCache = new Map<string, CacheEntry<AvailabilityResult>>();
  private readonly ratesCache = new Map<string, CacheEntry<string[]>>();

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
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
    if (rateIds.value.length === 0)
      return failure(
        classifyConfigurationError('This room type has no rate configured in Clock yet.'),
      );

    const nights = nightsBetween(query.startsOn, query.endsOn);
    if (nights.length === 0)
      return failure(classifyConfigurationError('startsOn must be before endsOn.'));

    const response = await this.fetch<ClockRateAvailabilityResponse>(parsed.value, {
      from: query.startsOn,
      to: nights[nights.length - 1],
      rates: rateIds.value,
      room_types: externalRoomTypeId,
    });
    if (!response.ok) return failure(response.error);

    const value = summarizeAvailability(query, nights, response.value, externalRoomTypeId);
    this.availabilityCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ok: true, value };
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
  ): Promise<ClockOutcome<string[]>> {
    const cacheKey = `${credentials.apiUser}:${externalRoomTypeId}`;
    const cached = this.ratesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ok: true, value: cached.value };

    const response = await this.fetch<
      Array<{ id: number | string; bookable_id: number | string; bookable_type: string }>
    >(credentials, undefined, '/rates/');
    if (!response.ok) return response;
    const ids = response.value
      .filter(
        (rate) =>
          rate.bookable_type === 'Pms::RoomType' && String(rate.bookable_id) === externalRoomTypeId,
      )
      .map((rate) => String(rate.id));
    this.ratesCache.set(cacheKey, { value: ids, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ok: true, value: ids };
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
        return failure(classifyClockClientFailure('network', error.message));
      throw error;
    }
  }
}

type ClockOutcome<T> = { ok: true; value: T } | { ok: false; error: ClockClassifiedError };

function failure(error: ClockClassifiedError): { ok: false; error: ClockClassifiedError } {
  return { ok: false, error };
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
