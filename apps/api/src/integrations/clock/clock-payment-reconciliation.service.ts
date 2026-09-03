import { Inject, Injectable } from '@nestjs/common';

import { reportOperationalFailure } from '../../observability/error-tracking';
import { AuditLogService } from '../../tenancy/audit-log.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ManualReviewService } from '../manual-review.service';
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

type PaidBookingRow = {
  id: string;
  externalBookingId: string;
  externalReference: string;
  currency: string;
  paidAmount: string;
};

// CONFIRMED_IN_SANDBOX 2026-09-03 (Task 0, docs/CLOCK_FINANCIAL_RECONCILIATION_PLAN.md).
// A folio's own `currency` defaults to the property's base currency
// regardless of what actually got posted — not usable here. Each
// credit_item's own `currency`/`value_cents` are the real, correct fields.
type ClockFolioListItem = number;

interface ClockFolioDetailResource {
  id: number;
  deposit?: boolean;
}

function isClockFolioDetailResource(value: unknown): value is ClockFolioDetailResource {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ClockFolioDetailResource).id === 'number'
  );
}

interface ClockCreditItemResource {
  id: number;
  reference?: string | null;
  value_cents: number;
  currency: string;
}

function isClockCreditItemResource(value: unknown): value is ClockCreditItemResource {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'number' && typeof item.value_cents === 'number';
}

export type ClockPaymentReconciliationFinding =
  | { type: 'DEPOSIT_FOLIO_MISSING'; bookingId: string }
  | { type: 'CREDIT_ITEM_MISSING'; bookingId: string; depositFolioIds: string[] }
  | {
      type: 'CREDIT_ITEM_AMOUNT_MISMATCH';
      bookingId: string;
      expectedAmount: string;
      expectedCurrency: string;
      postedAmount: string;
      postedCurrency: string;
    };

export type ClockPaymentReconciliationResult = {
  bookingsChecked: number;
  findings: ClockPaymentReconciliationFinding[];
};

/**
 * Financial-flow Task C (docs/CLOCK_FINANCIAL_RECONCILIATION_PLAN.md): the
 * actual verification layer over `ClockBookingService.postDeposit`, MUST's
 * already-existing real money-movement path into Clock. Read-only — this
 * service never posts, edits, or creates anything in Clock or in
 * `payments`/`payment_provider_sessions`; a mismatch is always a
 * `PAYMENT_BOOKING_MISMATCH` for a human, never auto-corrected.
 *
 * A booking is in scope when MUST itself processed an online payment for it
 * (payment_method is Stripe or PokPay, not pay-at-hotel) and it is
 * Clock-attached — postDeposit's own precondition. The expected value is
 * `payments`' own successful-charge total (the same aggregate the dashboard
 * already shows as `paidAmount`), which must appear as a `credit_item` on
 * one of the booking's real deposit folios, matched by the credit_item's own
 * `reference` field — confirmed for real (Task 0) to exactly equal MUST's
 * `external_reference`, the same value postDeposit posts it as.
 */
@Injectable()
export class ClockPaymentReconciliationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
  ) {}

  async check(
    tenantId: string,
    propertyId: string,
    since: Date,
  ): Promise<ClockPaymentReconciliationResult> {
    try {
      return await this.checkInternal(tenantId, propertyId, since);
    } catch (error) {
      reportOperationalFailure(error, {
        component: 'clock',
        operation: 'payment-reconciliation-check',
        tenantId,
        propertyId,
      });
      throw error;
    }
  }

  private async checkInternal(
    tenantId: string,
    propertyId: string,
    since: Date,
  ): Promise<ClockPaymentReconciliationResult> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new Error(
        classifyConfigurationError('This property has no active Clock PMS connection.').message,
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new Error(classifyConfigurationError(parsed.message).message);

    const bookings = await this.paidClockAttachedBookings(tenantId, propertyId, since);
    const findings: ClockPaymentReconciliationFinding[] = [];
    for (const booking of bookings) {
      const finding = await this.checkBooking(parsed.value, booking);
      if (finding) findings.push(finding);
    }

    await this.audit.record({
      tenantId,
      propertyId,
      actorUserId: null,
      action: 'clock_payment_reconciliation.checked',
      targetType: 'property',
      targetId: propertyId,
      details: { bookingsChecked: bookings.length, findingCounts: countFindings(findings) },
    });

    for (const finding of findings) {
      await this.manualReview.record({
        tenantId,
        propertyId,
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceType: 'booking',
        referenceId: finding.bookingId,
        message: reconciliationFindingMessage(finding),
        context: finding,
      });
    }

    return { bookingsChecked: bookings.length, findings };
  }

  private async checkBooking(
    credentials: ClockConnectionCredentials,
    booking: PaidBookingRow,
  ): Promise<ClockPaymentReconciliationFinding | null> {
    const depositFolioIds = await this.depositFolioIds(credentials, booking.externalBookingId);
    if (depositFolioIds.length === 0)
      return { type: 'DEPOSIT_FOLIO_MISSING', bookingId: booking.id };

    let postedCents = 0;
    let postedCurrency: string | null = null;
    let matched = false;
    for (const folioId of depositFolioIds) {
      const items = await this.creditItemsByReference(
        credentials,
        folioId,
        booking.externalReference,
      );
      for (const item of items) {
        matched = true;
        postedCents += item.value_cents;
        postedCurrency = item.currency;
      }
    }
    if (!matched)
      return {
        type: 'CREDIT_ITEM_MISSING',
        bookingId: booking.id,
        depositFolioIds: depositFolioIds.map(String),
      };

    const expectedCents = Math.round(Number(booking.paidAmount) * 100);
    if (
      postedCents !== expectedCents ||
      (postedCurrency ?? '').toUpperCase() !== booking.currency.toUpperCase()
    )
      return {
        type: 'CREDIT_ITEM_AMOUNT_MISMATCH',
        bookingId: booking.id,
        expectedAmount: booking.paidAmount,
        expectedCurrency: booking.currency,
        postedAmount: (postedCents / 100).toFixed(2),
        postedCurrency: postedCurrency ?? '',
      };

    return null;
  }

  private async paidClockAttachedBookings(
    tenantId: string,
    propertyId: string,
    since: Date,
  ): Promise<PaidBookingRow[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<PaidBookingRow[]>`
        SELECT b.id, b.external_booking_id AS "externalBookingId",
          b.external_reference AS "externalReference", rp.currency,
          paid."paidAmount"
        FROM bookings b
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        JOIN LATERAL (
          SELECT SUM(p.amount)::text AS "paidAmount"
          FROM payments p
          WHERE p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id
            AND p.kind = 'CHARGE' AND p.status = 'succeeded'
        ) paid ON TRUE
        WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
          AND b.external_booking_id IS NOT NULL
          AND b.payment_method IN ('STRIPE_CHECKOUT'::"BookingPaymentMethod", 'POKPAY'::"BookingPaymentMethod")
          AND b.created_at >= ${since}
          AND paid."paidAmount" IS NOT NULL
      `,
    );
  }

  /** Every real folio for this booking that is a deposit folio, open or
   * closed — a credit_item posted to a since-closed folio is still real
   * financial history and still needs to reconcile. Never creates a folio;
   * read-only, unlike ClockBookingService's own depositFolio lookup. */
  private async depositFolioIds(
    credentials: ClockConnectionCredentials,
    externalBookingId: string,
  ): Promise<number[]> {
    const listed = await this.fetchClock<unknown>(
      credentials,
      'pms_api',
      `/bookings/${externalBookingId}/folios/`,
    );
    if (
      !Array.isArray(listed) ||
      !listed.every((id): id is ClockFolioListItem => typeof id === 'number')
    )
      throw new Error('Clock returned an unexpected booking-folio list response.');

    const depositIds: number[] = [];
    for (const folioId of listed) {
      const detail = await this.fetchClock<unknown>(credentials, 'base_api', `/folios/${folioId}`);
      if (isClockFolioDetailResource(detail) && detail.deposit === true) depositIds.push(folioId);
    }
    return depositIds;
  }

  private async creditItemsByReference(
    credentials: ClockConnectionCredentials,
    folioId: number,
    reference: string,
  ): Promise<ClockCreditItemResource[]> {
    const response = await this.fetchClock<unknown>(
      credentials,
      'base_api',
      `/folios/${folioId}/credit_items`,
      { 'reference.eq': reference },
    );
    const items = Array.isArray(response) ? response.filter(isClockCreditItemResource) : [];
    return items.filter((item) => item.reference === reference);
  }

  /** Same rate-limit/circuit-breaker-wrapped GET pattern used throughout the
   * Clock integration (ClockFolioHydrationService, ClockBookingConsistencyService). */
  private async fetchClock<T>(
    credentials: ClockConnectionCredentials,
    api: 'pms_api' | 'base_api',
    path: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError)
        throw new Error(`Clock payment reconciliation unavailable: ${error.message}`);
      throw error;
    }
    for (;;) {
      const rateLimit = await this.rateLimiter.consume(breakerKey);
      if (rateLimit.allowed) break;
      await wait(rateLimit.retryAfterSeconds * 1_000);
    }

    try {
      const response = await this.client.request<T>(credentials, {
        api,
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
        throw new Error(
          classifyClockClientFailure(error.isTimeout ? 'timeout' : 'network', error.message)
            .message,
        );
      }
      throw error;
    }
  }
}

function countFindings(findings: ClockPaymentReconciliationFinding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.type] = (counts[finding.type] ?? 0) + 1;
    return counts;
  }, {});
}

function reconciliationFindingMessage(finding: ClockPaymentReconciliationFinding): string {
  switch (finding.type) {
    case 'DEPOSIT_FOLIO_MISSING':
      return `Booking ${finding.bookingId} has a successful MUST payment but no deposit folio exists in Clock.`;
    case 'CREDIT_ITEM_MISSING':
      return `Booking ${finding.bookingId} has a successful MUST payment with no matching credit_item on its deposit folio(s) (${finding.depositFolioIds.join(', ')}).`;
    case 'CREDIT_ITEM_AMOUNT_MISMATCH':
      return `Booking ${finding.bookingId}: MUST charged ${finding.expectedAmount} ${finding.expectedCurrency} but Clock's posted credit_item(s) total ${finding.postedAmount} ${finding.postedCurrency}.`;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
