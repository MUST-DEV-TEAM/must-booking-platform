import { Inject, Injectable } from '@nestjs/common';

import { reportOperationalFailure } from '../../observability/error-tracking';
import { AuditLogService } from '../../tenancy/audit-log.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import { parseClockCredentials } from './clock-credentials';
import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
  classifyConfigurationError,
} from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

type LocalBookingStatus = 'CONFIRMED' | 'CANCELLED';
type ClockBookingStatus = 'expected' | 'checked_in' | 'checked_out' | 'no_show' | 'canceled';

type LocalBookingRow = {
  id: string;
  externalReference: string | null;
  externalBookingId: string | null;
  status: LocalBookingStatus;
};

type ClockBookingResource = {
  id: string | number;
  status: ClockBookingStatus;
  reference_number?: string | null;
};

export type ClockBookingConsistencyFinding =
  | {
      type: 'LOCAL_BOOKING_MISSING_FROM_CLOCK';
      localBookingId: string;
      localStatus: LocalBookingStatus;
    }
  | {
      type: 'BOOKING_STATUS_MISMATCH';
      localBookingId: string;
      clockBookingId: string;
      localStatus: LocalBookingStatus;
      clockStatus: ClockBookingStatus;
    }
  | {
      type: 'CLOCK_BOOKING_MISSING_LOCALLY';
      clockBookingId: string;
      clockStatus: ClockBookingStatus;
    };

export type ClockBookingConsistencyResult = {
  startsOn: string;
  endsOn: string;
  localBookingCount: number;
  clockBookingCount: number;
  findings: ClockBookingConsistencyFinding[];
};

/**
 * Read-only reconciliation for a single property and date range. It never
 * changes booking state: mismatches are audit-recorded and sent through the
 * operational alert channel for a human to investigate.
 *
 * A Clock-only reservation is a MUST finding only when its reference is
 * corroborated by a local integration operation. Clock also holds bookings
 * from other channels, which MUST deliberately does not import in this phase.
 */
@Injectable()
export class ClockBookingConsistencyService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
  ) {}

  async check(
    tenantId: string,
    propertyId: string,
    range: { startsOn: string; endsOn: string },
  ): Promise<ClockBookingConsistencyResult> {
    try {
      return await this.checkInternal(tenantId, propertyId, range);
    } catch (error) {
      reportOperationalFailure(error, {
        component: 'clock',
        operation: 'booking-consistency-check',
        tenantId,
        propertyId,
      });
      throw error;
    }
  }

  private async checkInternal(
    tenantId: string,
    propertyId: string,
    range: { startsOn: string; endsOn: string },
  ): Promise<ClockBookingConsistencyResult> {
    this.assertDateRange(range);

    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new Error(
        classifyConfigurationError('This property has no active Clock PMS connection.').message,
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new Error(classifyConfigurationError(parsed.message).message);

    const [local, clockBookings] = await Promise.all([
      this.localBookings(tenantId, propertyId, range),
      this.fetchBookings(parsed.value, range),
    ]);

    const result = this.compare(range, local.bookings, local.mustReferences, clockBookings);
    await this.audit.record({
      tenantId,
      propertyId,
      actorUserId: null,
      action: 'clock_booking_consistency.checked',
      targetType: 'property',
      targetId: propertyId,
      details: {
        startsOn: range.startsOn,
        endsOn: range.endsOn,
        localBookingCount: result.localBookingCount,
        clockBookingCount: result.clockBookingCount,
        findingCounts: countFindings(result.findings),
      },
    });
    if (result.findings.length > 0)
      reportOperationalFailure(
        new Error(`Clock booking consistency check found ${result.findings.length} mismatch(es).`),
        {
          component: 'clock',
          operation: 'booking-consistency-check',
          tenantId,
          propertyId,
        },
      );
    return result;
  }

  private async localBookings(
    tenantId: string,
    propertyId: string,
    range: { startsOn: string; endsOn: string },
  ): Promise<{ bookings: LocalBookingRow[]; mustReferences: Set<string> }> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const [bookings, operations] = await Promise.all([
        tx.$queryRaw<LocalBookingRow[]>`
          SELECT id, external_reference AS "externalReference", external_booking_id AS "externalBookingId", status
          FROM bookings
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND status IN ('CONFIRMED'::"BookingStatus", 'CANCELLED'::"BookingStatus")
            AND starts_on < ${range.endsOn}::date AND ends_on > ${range.startsOn}::date
        `,
        tx.$queryRaw<Array<{ externalReference: string }>>`
          SELECT external_reference AS "externalReference"
          FROM integration_operations
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND external_reference IS NOT NULL
        `,
      ]);
      return { bookings, mustReferences: new Set(operations.map((row) => row.externalReference)) };
    });
  }

  private compare(
    range: { startsOn: string; endsOn: string },
    localBookings: LocalBookingRow[],
    mustReferences: Set<string>,
    clockBookings: ClockBookingResource[],
  ): ClockBookingConsistencyResult {
    const byClockId = new Map(clockBookings.map((booking) => [String(booking.id), booking]));
    const byReference = new Map(
      clockBookings
        .filter((booking): booking is ClockBookingResource & { reference_number: string } =>
          Boolean(booking.reference_number),
        )
        .map((booking) => [booking.reference_number, booking]),
    );
    const findings: ClockBookingConsistencyFinding[] = [];

    for (const local of localBookings) {
      const clock =
        (local.externalBookingId ? byClockId.get(local.externalBookingId) : undefined) ??
        (local.externalReference ? byReference.get(local.externalReference) : undefined);
      if (!clock) {
        if (local.status === 'CONFIRMED')
          findings.push({
            type: 'LOCAL_BOOKING_MISSING_FROM_CLOCK',
            localBookingId: local.id,
            localStatus: local.status,
          });
        continue; // A cancelled local booking correctly matches a missing Clock reservation.
      }
      if (!statusesMatch(local.status, clock.status))
        findings.push({
          type: 'BOOKING_STATUS_MISMATCH',
          localBookingId: local.id,
          clockBookingId: String(clock.id),
          localStatus: local.status,
          clockStatus: clock.status,
        });
    }

    const localReferences = new Set(
      localBookings.flatMap((booking) =>
        booking.externalReference ? [booking.externalReference] : [],
      ),
    );
    for (const clock of clockBookings) {
      const reference = clock.reference_number;
      if (
        reference &&
        hasMustOperationReference(mustReferences, reference) &&
        !localReferences.has(reference)
      )
        findings.push({
          type: 'CLOCK_BOOKING_MISSING_LOCALLY',
          clockBookingId: String(clock.id),
          clockStatus: clock.status,
        });
    }

    return {
      startsOn: range.startsOn,
      endsOn: range.endsOn,
      localBookingCount: localBookings.length,
      clockBookingCount: clockBookings.length,
      findings,
    };
  }

  private async fetchBookings(
    credentials: ClockConnectionCredentials,
    range: { startsOn: string; endsOn: string },
  ): Promise<ClockBookingResource[]> {
    const listed = await this.fetchClock<unknown>(credentials, '/bookings/', {
      // Clock documents comparison filters for booking date fields. These
      // two filters return reservations that overlap [startsOn, endsOn).
      'arrival.lt': range.endsOn,
      'departure.gt': range.startsOn,
    });
    // Confirmed against Empire Beach Resort production on 2026-08-17: the
    // list endpoint returns only numeric IDs, not booking resources. Detail
    // reads are therefore mandatory before comparing Clock status/reference.
    if (!Array.isArray(listed) || !listed.every(isClockBookingId))
      throw new Error('Clock returned an unexpected booking-list response.');

    const bookings: ClockBookingResource[] = [];
    for (const id of listed) {
      const booking = await this.fetchClock<unknown>(credentials, `/bookings/${id}`);
      if (!isClockBookingResource(booking))
        throw new Error(`Clock returned an unexpected booking detail for ${id}.`);
      bookings.push(booking);
    }
    return bookings;
  }

  /**
   * Every Clock request, including each read after a list response, shares
   * the same circuit breaker and 4/s operational limit. A rate-limited GET
   * waits and retries safely; it never retries a write because this checker
   * has no write path.
   */
  private async fetchClock<T>(
    credentials: ClockConnectionCredentials,
    path: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError)
        throw new Error(`Clock booking consistency check unavailable: ${error.message}`);
      throw error;
    }
    for (;;) {
      const rateLimit = await this.rateLimiter.consume(breakerKey);
      if (rateLimit.allowed) break;
      await wait(rateLimit.retryAfterSeconds * 1_000);
    }

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
        throw new Error(classifyClockHttpResponse(response.status, response.body).message);
      }
      this.circuitBreaker.recordSuccess(breakerKey);
      return response.body;
    } catch (error) {
      if (error instanceof ClockHttpError) {
        this.circuitBreaker.recordFailure(breakerKey);
        throw new Error(classifyClockClientFailure('network', error.message).message);
      }
      throw error;
    }
  }

  private assertDateRange(range: { startsOn: string; endsOn: string }): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(range.endsOn))
      throw new Error('startsOn and endsOn must be ISO dates (YYYY-MM-DD).');
    const startsOn = new Date(`${range.startsOn}T00:00:00Z`);
    const endsOn = new Date(`${range.endsOn}T00:00:00Z`);
    if (startsOn.toISOString().slice(0, 10) !== range.startsOn)
      throw new Error('startsOn must be a real calendar date.');
    if (endsOn.toISOString().slice(0, 10) !== range.endsOn)
      throw new Error('endsOn must be a real calendar date.');
    const days = (endsOn.getTime() - startsOn.getTime()) / 86_400_000;
    if (days <= 0) throw new Error('startsOn must be before endsOn.');
    if (days > 31)
      throw new Error('Clock booking consistency checks are limited to a 31-day range.');
  }
}

function isClockBookingId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isClockBookingResource(value: unknown): value is ClockBookingResource {
  if (!value || typeof value !== 'object') return false;
  const booking = value as Record<string, unknown>;
  return (
    (typeof booking.id === 'string' || typeof booking.id === 'number') &&
    typeof booking.status === 'string' &&
    ['expected', 'checked_in', 'checked_out', 'no_show', 'canceled'].includes(booking.status) &&
    (booking.reference_number === undefined ||
      booking.reference_number === null ||
      typeof booking.reference_number === 'string')
  );
}

function statusesMatch(local: LocalBookingStatus, clock: ClockBookingStatus): boolean {
  if (local === 'CONFIRMED')
    return ['expected', 'checked_in', 'checked_out', 'no_show'].includes(clock);
  return clock === 'canceled';
}

function countFindings(findings: ClockBookingConsistencyFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1;
    return counts;
  }, {});
}

function hasMustOperationReference(references: Set<string>, clockReference: string): boolean {
  if (references.has(clockReference)) return true;
  // MultiRoomBookingService stores one operation for an order and appends
  // `-roomN` on each individual Clock reservation reference.
  return [...references].some((reference) =>
    new RegExp(`^${escapeRegExp(reference)}-room[1-9]\\d*$`).test(clockReference),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
