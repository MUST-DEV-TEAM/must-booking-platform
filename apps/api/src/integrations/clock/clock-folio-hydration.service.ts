import { Inject, Injectable, Logger } from '@nestjs/common';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import { parseClockCredentials } from './clock-credentials';
import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
} from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

// CONFIRMED_IN_SANDBOX 2026-09-03 against a real GET /folios/{id} response
// (Empire Beach Resort, base_api family — confirmed against
// clock-booking.service.ts's existing depositFolio call, not guessed). Only
// the fields this service actually reads; the real response carries many
// more (billing info, tax fields, etc.) that are out of scope for
// visibility-only sync.
export interface ClockFolioDetail {
  id: number;
  payer_type: string;
  payer_id: number | null;
  balance?: { cents: number; currency: string } | null;
  closed_at?: string | null;
}

export function isClockFolioDetail(value: unknown): value is ClockFolioDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  return typeof detail.id === 'number' && typeof detail.payer_type === 'string';
}

export type FolioHydrationOutcome =
  | { outcome: 'applied'; bookingId: string }
  | { outcome: 'not_a_booking_folio' }
  | { outcome: 'booking_not_found' }
  | { outcome: 'no_active_connection' };

/**
 * Visibility-only Clock folio sync (Clock certification gap Task C,
 * docs/CLOCK_CERTIFICATION_GAPS_PLAN.md) — deliberately narrow. Fetches the
 * real folio state and mirrors id/balance/closed-at onto whichever local
 * booking it belongs to (the folio's own payer_id, when payer_type is
 * "Booking" — no separate lookup needed). Never touches `payments` or
 * `payment_provider_sessions`, never writes anything back to Clock. Real
 * payment/charge reconciliation is a separate, bigger, higher-stakes design
 * question intentionally left for later — see the plan doc.
 */
@Injectable()
export class ClockFolioHydrationService {
  private readonly logger = new Logger(ClockFolioHydrationService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
  ) {}

  async hydrateFolio(
    tenantId: string,
    propertyId: string,
    folioId: string,
  ): Promise<FolioHydrationOutcome> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS') {
      this.logger.warn(
        `Clock folio hydration skipped for property ${propertyId}: no active Clock connection.`,
      );
      return { outcome: 'no_active_connection' };
    }
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) {
      this.logger.warn(`Clock folio hydration skipped: ${parsed.message}`);
      return { outcome: 'no_active_connection' };
    }

    const detail = await this.fetchClock<ClockFolioDetail>(parsed.value, `/folios/${folioId}`);
    if (detail.payer_type !== 'Booking' || detail.payer_id == null) {
      this.logger.debug(
        `Folio ${folioId} payer_type is "${detail.payer_type}", not a single booking — skipped (visibility-only scope).`,
      );
      return { outcome: 'not_a_booking_folio' };
    }

    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const balance =
        detail.balance !== undefined && detail.balance !== null
          ? (detail.balance.cents / 100).toFixed(2)
          : null;
      const closedAt = detail.closed_at ?? null;

      const updated = await tx.$executeRawUnsafe(
        `UPDATE bookings SET clock_folio_id = $3, clock_folio_balance = $4::decimal, clock_folio_closed_at = $5,
           updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND external_booking_id = $6`,
        tenantId,
        propertyId,
        String(detail.id),
        balance,
        closedAt,
        String(detail.payer_id),
      );
      if (updated === 0) {
        this.logger.warn(
          `Folio ${folioId} belongs to Clock booking ${detail.payer_id}, which has no local shadow booking yet.`,
        );
        return { outcome: 'booking_not_found' };
      }

      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM bookings WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND external_booking_id = $3`,
        tenantId,
        propertyId,
        String(detail.payer_id),
      );
      return { outcome: 'applied', bookingId: rows[0]!.id };
    });
  }

  /** Same rate-limit/circuit-breaker-wrapped GET pattern as
   * ClockBookingHydrationService.fetchClock, reused verbatim. */
  private async fetchClock<T>(credentials: ClockConnectionCredentials, path: string): Promise<T> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError)
        throw new Error(`Clock folio hydration unavailable: ${error.message}`);
      throw error;
    }
    for (;;) {
      const rateLimit = await this.rateLimiter.consume(breakerKey);
      if (rateLimit.allowed) break;
      await wait(rateLimit.retryAfterSeconds * 1_000);
    }

    try {
      const response = await this.client.request<T>(credentials, {
        api: 'base_api',
        method: 'GET',
        path,
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
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
