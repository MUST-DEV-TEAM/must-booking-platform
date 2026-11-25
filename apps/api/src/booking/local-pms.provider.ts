import { paymentMethodAvailability } from './payment-method-availability';
import type {
  RoomMoveAvailabilityQuery,
  RoomMoveAvailabilitySnapshot,
} from '@must/domain-contracts';
import type { MoveBookingRoomCommand } from '@must/domain-contracts';
import { checkTermsAcceptance, recordTermsAcceptance } from './terms-acceptance';
import { enforcePropertyBookingLimits } from './property-booking-limits';
import { enforceChildrenAges, enforceGuestForm } from './guest-form-rules';
import { resolveBillingRatePlan } from './billing-rate-plan';
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  type AvailabilityQuery,
  type AvailabilityResult,
  type Booking,
  BookingPaymentMethod,
  BookingStatus,
  type CancelBookingCommand,
  type CatalogItem,
  type CreateBookingCommand,
  type GuestPaymentMethod,
  type Money,
  type Page,
  type PmsProvider,
  type PmsProviderContext,
  type Result,
  type UpdateBookingCommand,
} from '@must/domain-contracts';

import { AvailabilityService } from '../tenancy/availability.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { loadCheckoutDescription } from '../payments/checkout-description';
import { checkoutHoldMinutes } from '../payments/checkout-hold';
import { requestPaymentLink } from '../payments/request-payment-link';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { PaymentProviderRegistry } from '../payments/payment-provider-registry';
import { PaymentRefundService, type RefundConfirmation } from '../payments/payment-refund.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';
import { BookingCancellationNotificationService } from '../mail/booking-cancellation-notification.service';
import { LifecycleEmailService } from '../mail/lifecycle-email.service';
import { BookingStateMachine } from './booking-state-machine';
import { bookingNeedsAttention } from './booking-attention';
import { QuoteService } from './quote.service';
import { resolveBookingOccupancy, validBookingOccupancy } from './booking-occupancy';
import { NotificationsService } from '../tenancy/notifications.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { ManualReviewService } from '../integrations/manual-review.service';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { PrePaymentAvailabilityRegistry } from './pre-payment-availability';
import { generateBookingReference } from './booking-reference';
import { resolveGuestWithPhoneSignal } from './guest-matching';
import { PromoCodeService } from './promo-code.service';
import type { PromoApplied } from './quote.service';

export const PMS_PROVIDER = Symbol('PMS_PROVIDER');

export type LocalCreateBookingCommand = CreateBookingCommand & {
  childrenAges?: number[];
  quoteToken?: string;
  quoteSessionId?: string;
  staffActorId?: string;
  /** Staff only: why the hotel's own booking limits were overridden for this booking. */
  ruleOverrideReason?: string;
  skipQuoteValidation?: boolean;
  /** Clock hotels: the published Clock rate chosen for the stay; it is part of the signed quote. */
  clockRateId?: string;
  /** The promo code entered for this stay; it is part of the signed quote. */
  promoCode?: string;
  /** Staff bookings: the promo that was applied when the price was worked out. */
  promo?: PromoApplied;
  /** Only the local development demo seed sets this, to create booking history in the past. */
  allowPastStay?: boolean;
  returnUrl?: string;
  /** The website shows the card checkout inside its own page (Stripe, when the hotel saved its publishable key). */
  embeddedCheckout?: boolean;
};

export type ResendPokPayCheckoutCommand = {
  bookingId: string;
  idempotencyKey: string;
  actorUserId: string;
};

type BookingRow = {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  roomId: string | null;
  guestId: string | null;
  guestSessionId: string | null;
  guestReturnUrl: string | null;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  totalAmount: string;
  adults: number;
  children: number;
  childrenAges: number[] | null;
  currency: string;
  nightlyRates: unknown;
  externalReference: string;
  orderReference: string | null;
  externalBookingId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  onRequestDeadlineAt: Date | null;
  paymentPendingAt: Date | null;
  paymentDueAt: Date | null;
  onRequestCheckoutUrl: string | null;
};

type IntegrationOperationRow = {
  requestHash: string;
  result: Result<BookingWithCheckout> | null;
};

type BookingWithCheckout = Booking & {
  checkoutUrl?: string;
  checkoutOrderId?: string;
  /** Set when the checkout is shown inside the website's page: the website's script mounts it. */
  checkoutClientSecret?: string;
  stripePublishableKey?: string;
  onRequestDeadlineAt?: string;
};

type ConfirmedPaymentDetails = {
  reference: string;
  paymentSubType: string;
  paymentType?: 'cash' | 'card' | 'bank' | 'on-line';
};

class CheckoutSessionCreationError extends Error {
  constructor(readonly result: Result<never>) {
    super(result.ok ? 'Checkout session creation failed.' : result.error.message);
  }
}

/**
 * This must escape the tenant transaction after a local reservation succeeds:
 * AVAILABILITY_FAILED has no outgoing transition, so returning it directly
 * would commit a stranded room/inventory hold. The outer createBooking catch
 * converts it back to the safe public Result after rollback.
 */
class PrePaymentAvailabilityError extends Error {
  constructor(readonly result: Result<never>) {
    super(result.ok ? 'Clock availability check failed.' : result.error.message);
  }
}

type CancellationPolicy = {
  freeCancellationUntilHours: number | null;
  cutoffAt: Date | null;
  isFree: boolean;
  autoRefund?: boolean;
};

type MultiRoomCancellation = {
  result: Result<Booking>;
  refundConfirmations: RefundConfirmation[];
  cancelledBookingIds: string[];
};

type RoomSelection = { autoAssign: boolean };

/** How long a due request booking with an open payment page waits for the provider's notice before release. */
const REQUEST_RECONCILE_GRACE_MS = 5 * 60_000;

@Injectable()
export class LocalPmsProvider implements PmsProvider {
  private readonly logger = new Logger(LocalPmsProvider.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BookingStateMachine) private readonly stateMachine: BookingStateMachine,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(PaymentProviderRegistry) private readonly paymentProviders: PaymentProviderRegistry,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
    @Inject(BookingConfirmationNotificationService)
    private readonly confirmations: BookingConfirmationNotificationService,
    @Inject(BookingCancellationNotificationService)
    private readonly cancellations: BookingCancellationNotificationService,
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
    @Inject(ClockBookingService) private readonly clockBooking: ClockBookingService,
    @Inject(PrePaymentAvailabilityRegistry)
    private readonly prePaymentAvailability: PrePaymentAvailabilityRegistry,
    @Inject(PromoCodeService) private readonly promos?: PromoCodeService,
    @Optional() @Inject(LifecycleEmailService) private readonly lifecycle?: LifecycleEmailService,
  ) {}

  /** Milestone 11.5 Task 4/2: whether this property should get a real Clock
   * reservation once its local booking is valid (and, for online payment,
   * paid). Deliberately not routed through PmsProviderRegistry here — that
   * would create a constructor cycle (the registry itself depends on this
   * class) and isn't needed: this only ever wants one specific answer. */
  private async isClockConnected(context: PmsProviderContext): Promise<boolean> {
    const connection = await this.connections.activePmsConnectionCredentials(
      context.tenantId,
      context.propertyId,
    );
    return connection?.provider === 'CLOCK_PMS';
  }

  /**
   * After a cancellation that carries no fee, clears the room charges in Clock the way Clock's own
   * Cancel does (voids the booking's open, non-deposit folios). The cancellation already stands, so a
   * failure never undoes it: a missing Clock right is only logged (the Clock permissions panel shows
   * it), any other failure becomes a manual-review item so the hotel voids the folio by hand.
   */
  private async clearRoomChargesAfterFreeCancellation(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    externalBookingId: string,
  ): Promise<void> {
    const cleared = await this.clockBooking.voidRoomChargeFolios(context, externalBookingId);
    if (cleared.ok) return;
    if (cleared.error.code === 'CLOCK_RIGHT_MISSING') {
      this.logger.warn(
        `Room charges not cleared for booking ${bookingId}: ${cleared.error.message}`,
      );
      return;
    }
    await this.manualReview.recordInTransaction(tx, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      category: 'UNKNOWN_RESULT',
      referenceType: 'booking',
      referenceId: bookingId,
      message: `The booking was cancelled, but its room charges could not be cleared in Clock: ${cleared.error.message} Void the room folio in Clock by hand.`,
      context: {
        kind: 'CANCEL_ROOM_CHARGES_NOT_CLEARED',
        externalBookingId,
        errorCode: cleared.error.code,
      },
    });
  }

  async testConnection(context: PmsProviderContext): Promise<Result<void>> {
    void context;
    return { ok: true, value: undefined };
  }

  async syncCatalog(context: PmsProviderContext, cursor?: string): Promise<Page<CatalogItem>> {
    void cursor;
    return this.database.withTenantTransaction(context, async (tx) => {
      const roomTypes = await tx.$queryRaw<
        Array<{ id: string; name: string; maxOccupancy: number }>
      >`
        SELECT id, name, max_occupancy AS "maxOccupancy"
        FROM room_types
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        ORDER BY name, id
      `;
      const ratePlans = await tx.$queryRaw<
        Array<{ id: string; name: string; currency: string; isActive: boolean }>
      >`
        SELECT id, name, currency, is_active AS "isActive"
        FROM rate_plans
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        ORDER BY name, id
      `;
      return {
        items: [
          ...roomTypes.map((roomType) => ({ kind: 'room_type' as const, ...roomType })),
          ...ratePlans.map((ratePlan) => ({ kind: 'rate_plan' as const, ...ratePlan })),
        ],
        nextCursor: null,
      };
    });
  }

  async getAvailability(
    context: PmsProviderContext,
    query: AvailabilityQuery,
  ): Promise<Result<AvailabilityResult>> {
    try {
      return {
        ok: true,
        value: await this.availability.getAvailability(context.tenantId, context.propertyId, query),
      };
    } catch (error) {
      // Callers (e.g. PublicAvailabilityController, dispatching through
      // PmsProviderRegistry) rely on AvailabilityService's real status codes
      // and messages (400 for a bad query, 404 for an unknown room type,
      // etc.) — only flatten truly unexpected errors into a generic failure.
      if (error instanceof HttpException) throw error;
      return {
        ok: false,
        error: {
          code: 'AVAILABILITY_QUERY_FAILED',
          message: 'Availability could not be determined for the requested stay.',
          retryable: false,
        },
      };
    }
  }

  async getBooking(
    context: PmsProviderContext,
    externalBookingId: string,
  ): Promise<Booking | null> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const row = await this.bookingById(tx, context, externalBookingId);
      return row ? this.toBooking(row) : null;
    });
  }

  async findBookingByExternalReference(
    context: PmsProviderContext,
    reference: string,
  ): Promise<Booking | null> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const row = await this.bookingByReference(tx, context, reference);
      return row ? this.toBooking(row) : null;
    });
  }

  async getGuestBooking(
    context: PmsProviderContext,
    bookingId: string,
    guestSessionId: string,
  ): Promise<Booking | null> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const row = await this.bookingById(tx, context, bookingId);
      if (!row || row.guestSessionId !== guestSessionId) return null;
      const booking = this.toBooking(row);
      return booking && row.status === BookingStatus.PAYMENT_PENDING
        ? { ...booking, checkoutExpiresAt: await this.checkoutExpiry(tx, context, row) }
        : booking;
    });
  }

  async createBooking(
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<Result<BookingWithCheckout>> {
    const occupancy = resolveBookingOccupancy(command);
    if (
      !this.validStay(command.startsOn, command.endsOn) ||
      !this.validAmount(command.total.amount) ||
      !validBookingOccupancy(command) ||
      !(command.quoteSessionId ?? command.staffActorId)
    ) {
      return this.failure(
        'INVALID_BOOKING_COMMAND',
        'Booking dates, total, or guest count are invalid.',
      );
    }

    let payAtHotelConfirmationBookingId: string | null = null;
    let onRequestCreated: { id: string; deadline: string } | null = null;
    try {
      const result = await this.database.withTenantTransaction(
        context,
        async (tx) => {
          // Serialize the complete booking transaction before it obtains booking or guest row locks.
          // The respective reservation method takes the same transaction-scoped lock again.
          if (command.roomId)
            await this.availability.lockRoom(
              tx,
              context.tenantId,
              context.propertyId,
              command.roomId,
            );
          else
            await this.availability.lockBookedUnits(
              tx,
              context.tenantId,
              context.propertyId,
              command.roomTypeId,
            );
          const created = await this.withIdempotency(
            tx,
            context,
            command.idempotencyKey,
            command,
            null,
            command.externalReference ?? null,
            async () => {
              // Walk-in booking redesign: staff no longer picks a rate plan
              // for a Clock-connected room type — resolve the auto-created
              // shadow rate plan (Task confirm-time) instead of failing on an
              // empty ratePlanId, which would otherwise reach validateCatalog's
              // ::uuid cast as '' and throw a raw Postgres error.
              const ratePlanId = command.ratePlanId
                ? command.ratePlanId
                : await this.clockShadowRatePlanId(tx, context, command.roomTypeId);
              if (!ratePlanId)
                return this.failure(
                  'RATE_PLAN_REQUIRED',
                  'A rate plan is required for this room type.',
                );
              const limits = command.allowPastStay
                ? { overridden: [] }
                : await enforcePropertyBookingLimits(
                    tx,
                    context,
                    {
                      startsOn: command.startsOn,
                      endsOn: command.endsOn,
                      adults: occupancy.adults,
                      children: occupancy.children,
                      roomCount: 1,
                    },
                    command.staffActorId ? command.ruleOverrideReason : undefined,
                  );
              // A guest booking must carry every field the hotel marked Required in its Booking form.
              // Staff bookings are not held to the form.
              if (!command.staffActorId) {
                await enforceGuestForm(tx, context, command.guest);
                await enforceChildrenAges(tx, context, occupancy, command.childrenAges);
              }
              // The hotel's terms and privacy links, when it requires the guest to accept them (G-56).
              const terms = command.staffActorId
                ? ({ ok: true, record: null } as const)
                : await checkTermsAcceptance(tx, context, command.guest.termsAccepted === true);
              if (!terms.ok) return this.failure(terms.code, terms.message);
              const catalog = await this.validateCatalog(
                tx,
                context,
                command.roomTypeId,
                ratePlanId,
                command.total.currency,
              );
              if (typeof catalog !== 'string') return catalog;
              const billingRatePlanId = catalog;
              const roomSelection = await this.validateRoomSelection(tx, context, command);
              if ('ok' in roomSelection) return roomSelection;
              const paymentMethod = await this.paymentMethod(tx, context, command);
              if (!paymentMethod.ok) return paymentMethod;
              const onRequestSettings = await tx.$queryRaw<Array<{ mode: string; hours: number }>>`
                SELECT confirmation_mode AS mode, COALESCE(on_request_hours, 24) AS hours
                FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid
              `;
              const onRequest =
                !command.staffActorId && onRequestSettings[0]?.mode === 'on_request';
              if (onRequest && (await this.isClockConnected(context)))
                return this.failure(
                  'ON_REQUEST_PMS_UNAVAILABLE',
                  'On-request confirmation is unavailable while a PMS is connected.',
                );
              if (onRequest && paymentMethod.value === BookingPaymentMethod.PAY_AT_HOTEL)
                return this.failure(
                  'ON_REQUEST_ONLINE_PAYMENT_REQUIRED',
                  'Choose an online payment method for an on-request booking.',
                );
              const resolvedGuest = await this.resolveGuest(tx, context.tenantId, command.guest);
              if (!resolvedGuest.ok) return resolvedGuest;
              const guestId = resolvedGuest.value;
              const externalReference =
                command.externalReference ?? (await this.generatedExternalReference(tx, context));

              // The promo signed into the quote (guest) or applied to the staff price. Whether one more use is
              // left is checked under a lock; the booking itself is what counts as a use, and a booking
              // that fails validation or availability stops counting by itself.
              const promo =
                command.promo ??
                (command.promoCode ? this.quotes.promoOf(command.quoteToken) : null);
              if (promo?.source === 'own') {
                const redeemed = await this.promos?.reserveUse(tx, context, promo.code);
                if (!redeemed)
                  return this.failure(
                    'PROMO_UNAVAILABLE',
                    'This code has just been used up. Please request a new quote.',
                  );
              }

              const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO bookings (
          tenant_id, property_id, room_type_id, room_id, guest_id, external_reference,
          guest_session_id, special_requests, status, payment_method, starts_on, ends_on, rate_plan_id, total_amount,
          adults, children, children_ages, guest_count, source, clock_rate_id,
          promo_code, promo_discount_amount, original_total_amount,
          estimated_arrival_time, company_name, tax_number, marketing_consent, marketing_consent_at
        ) VALUES (
          ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${command.roomTypeId}::uuid,
          ${command.roomId ?? null}::uuid, ${guestId}::uuid, ${externalReference},
          ${command.quoteSessionId ?? null}::uuid,
          ${command.guest.specialRequests?.trim() || null},
          ${BookingStatus.DRAFT}::"BookingStatus",
          ${paymentMethod.value}::"BookingPaymentMethod",
          ${command.startsOn}::date, ${command.endsOn}::date, ${billingRatePlanId}::uuid,
          ${command.total.amount}::numeric, ${occupancy.adults}, ${occupancy.children}, ${command.childrenAges === undefined ? null : JSON.stringify(command.childrenAges)}::jsonb,
          ${occupancy.guestCount}, ${command.staffActorId ? 'DIRECT' : 'WEBSITE'}, ${command.clockRateId ?? null},
          ${promo?.code ?? null}, ${promo?.discount.amount ?? null}::numeric, ${promo?.originalTotal.amount ?? null}::numeric,
          ${command.guest.arrivalTime ?? null}, ${command.guest.companyName ?? null}, ${command.guest.taxNumber ?? null},
          ${command.guest.marketingConsent === true},
          ${command.guest.marketingConsent === true ? new Date() : null}::timestamptz
        )
        RETURNING id
      `;
              const bookingId = inserted[0]!.id;
              await recordTermsAcceptance(tx, context, [bookingId], terms.record);
              const guestReturnUrl = await this.validatedGuestReturnUrl(
                tx,
                context,
                command.returnUrl,
              );
              if (guestReturnUrl)
                await tx.$executeRaw`UPDATE bookings SET guest_return_url = ${guestReturnUrl} WHERE id = ${bookingId}::uuid`;
              await this.audit.recordInTransaction(tx, {
                tenantId: context.tenantId,
                propertyId: context.propertyId,
                actorUserId: command.staffActorId ?? null,
                action: 'booking.created',
                source: command.staffActorId ? 'MUST_STAFF' : 'GUEST',
                operationId: command.idempotencyKey,
                targetType: 'booking',
                targetId: bookingId,
                details: { guestId },
              });
              if (limits.overridden.length)
                await this.audit.recordInTransaction(tx, {
                  tenantId: context.tenantId,
                  propertyId: context.propertyId,
                  actorUserId: command.staffActorId ?? null,
                  action: 'booking.rules_overridden',
                  source: 'MUST_STAFF',
                  operationId: command.idempotencyKey,
                  targetType: 'booking',
                  targetId: bookingId,
                  details: {
                    reason: command.ruleOverrideReason,
                    rules: limits.overridden.map((rule) => rule.code),
                  },
                });
              let status = BookingStatus.DRAFT;
              status = await this.transition(tx, context, bookingId, status, BookingStatus.QUOTED);
              status = await this.transition(
                tx,
                context,
                bookingId,
                status,
                BookingStatus.INVENTORY_REVALIDATING,
              );
              if (!command.skipQuoteValidation) {
                const quoteError = this.quotes.validate(
                  command.quoteToken,
                  command.quoteSessionId,
                  {
                    tenantId: context.tenantId,
                    propertyId: context.propertyId,
                    roomTypeId: command.roomTypeId,
                    roomId: command.roomId,
                    ratePlanId: command.ratePlanId,
                    clockRateId: command.clockRateId,
                    promoCode: command.promoCode,
                    startsOn: command.startsOn,
                    endsOn: command.endsOn,
                    adults: occupancy.adults,
                    children: occupancy.children,
                    childrenAges: command.childrenAges,
                    guestCount: occupancy.guestCount,
                    total: command.total,
                  },
                );
                if (quoteError) {
                  await this.transition(
                    tx,
                    context,
                    bookingId,
                    status,
                    BookingStatus.AVAILABILITY_FAILED,
                  );
                  return this.failure(quoteError.code, quoteError.message);
                }
                const nightlyRates = this.quotes.nightlyRates(command.quoteToken);
                if (!nightlyRates) {
                  await this.transition(
                    tx,
                    context,
                    bookingId,
                    status,
                    BookingStatus.AVAILABILITY_FAILED,
                  );
                  return this.failure(
                    'QUOTE_INVALID',
                    'The quote does not contain a price for every night. Please request a new quote.',
                  );
                }
                await tx.$executeRaw`
                  UPDATE bookings
                  SET nightly_rates = ${JSON.stringify(nightlyRates)}::jsonb
                  WHERE id = ${bookingId}::uuid
                    AND tenant_id = ${context.tenantId}::uuid
                    AND property_id = ${context.propertyId}::uuid
                `;
              }
              // A guest who leaves the payment page and tries again must not be refused by their own unpaid
              // attempt. Released only now, after the quote is proven to belong to this session, so a failed
              // retry never costs the guest the hold they already have.
              if (!command.skipQuoteValidation)
                await this.releaseOwnUnpaidHolds(tx, context, command);
              const assignment = roomSelection.autoAssign
                ? await this.reserveSamePricedRoom(tx, context, command)
                : null;
              const autoAssignedRoomId = assignment?.roomId ?? null;
              if (roomSelection.autoAssign && !autoAssignedRoomId) {
                await this.transition(
                  tx,
                  context,
                  bookingId,
                  status,
                  BookingStatus.AVAILABILITY_FAILED,
                );
                return (
                  // A room held by someone else's unpaid checkout says for how long; a changed price has its own answer.
                  (assignment?.reason === 'price_changed'
                    ? null
                    : await this.heldForPaymentFailure(tx, context, command, bookingId)) ??
                  this.failure(
                    assignment?.reason === 'held'
                      ? 'CHECKOUT_HOLD_ACTIVE'
                      : assignment?.reason === 'price_changed'
                        ? 'PRICE_CHANGED'
                        : 'AUTO_ASSIGNMENT_UNAVAILABLE',
                    assignment?.reason === 'held'
                      ? 'This room is temporarily held while another checkout awaits payment. Please try again shortly or choose another room.'
                      : assignment?.reason === 'price_changed'
                        ? 'The available room price has changed. Please refresh the price before booking.'
                        : 'No assignable room is available for the requested stay. Please choose another room or different dates.',
                  )
                );
              }
              if (autoAssignedRoomId)
                await tx.$executeRaw`
                UPDATE bookings
                SET room_id = ${autoAssignedRoomId}::uuid
                WHERE id = ${bookingId}::uuid
              `;

              const reserved = roomSelection.autoAssign
                ? true
                : command.roomId
                  ? await this.availability.reserveRoom(tx, context.tenantId, context.propertyId, {
                      roomId: command.roomId,
                      startsOn: command.startsOn,
                      endsOn: command.endsOn,
                    })
                  : await this.availability.reserveBookedUnits(
                      tx,
                      context.tenantId,
                      context.propertyId,
                      {
                        roomTypeId: command.roomTypeId,
                        startsOn: command.startsOn,
                        endsOn: command.endsOn,
                        units: 1,
                      },
                    );
              if (!reserved) {
                await this.transition(
                  tx,
                  context,
                  bookingId,
                  status,
                  BookingStatus.AVAILABILITY_FAILED,
                );
                return (
                  (await this.heldForPaymentFailure(tx, context, command, bookingId)) ??
                  this.failure(
                    'AVAILABILITY_FAILED',
                    (autoAssignedRoomId ?? command.roomId)
                      ? 'The selected room is no longer available for the requested stay.'
                      : 'Inventory is no longer available for the requested stay.',
                  )
                );
              }

              if (onRequest) {
                const deadline = new Date(
                  Date.now() + onRequestSettings[0]!.hours * 60 * 60 * 1000,
                );
                await tx.$executeRaw`UPDATE bookings SET on_request_deadline_at=${deadline}::timestamptz
                  WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${bookingId}::uuid`;
                await this.transition(
                  tx,
                  context,
                  bookingId,
                  status,
                  BookingStatus.ON_REQUEST_PENDING,
                );
                await this.audit.recordInTransaction(tx, {
                  tenantId: context.tenantId,
                  propertyId: context.propertyId,
                  actorUserId: null,
                  action: 'booking.requested',
                  source: 'GUEST',
                  operationId: command.idempotencyKey,
                  targetType: 'booking',
                  targetId: bookingId,
                  details: {
                    before: { status },
                    after: {
                      status: BookingStatus.ON_REQUEST_PENDING,
                      deadline: deadline.toISOString(),
                    },
                  },
                });
                onRequestCreated = { id: bookingId, deadline: deadline.toISOString() };
                const row = await this.bookingById(tx, context, bookingId);
                const booking = row && this.toBooking(row);
                return booking
                  ? { ok: true, value: { ...booking, onRequestDeadlineAt: deadline.toISOString() } }
                  : this.failure('BOOKING_NOT_FOUND', 'Created booking could not be loaded.');
              }

              if (
                paymentMethod.value === BookingPaymentMethod.STRIPE_CHECKOUT ||
                paymentMethod.value === BookingPaymentMethod.POKPAY
              ) {
                const confirmed = await this.prePaymentAvailability.confirmAvailable(context, {
                  startsOn: command.startsOn,
                  endsOn: command.endsOn,
                  rooms: [
                    {
                      roomTypeId: command.roomTypeId,
                      roomId: command.roomId,
                      adults: occupancy.adults,
                      children: occupancy.children,
                      childrenAges: command.childrenAges,
                    },
                  ],
                });
                if (!confirmed.ok) throw new PrePaymentAvailabilityError(confirmed);
                status = await this.transition(
                  tx,
                  context,
                  bookingId,
                  status,
                  BookingStatus.PAYMENT_PENDING,
                );
                const provider = this.paymentProviders.forBookingMethod(paymentMethod.value);
                if (!provider)
                  return this.failure(
                    'PAYMENT_PROVIDER_NOT_AVAILABLE',
                    'Payment provider is unavailable.',
                  );
                const checkout = await provider.createCheckoutSession(context, {
                  idempotencyKey: command.idempotencyKey,
                  bookingId,
                  description: await loadCheckoutDescription(tx, context, bookingId),
                  expiresAfterMinutes: await checkoutHoldMinutes(tx, context, bookingId),
                  amount: command.total,
                  successUrl: this.checkoutReturnUrl(bookingId, 'success', guestReturnUrl, context),
                  cancelUrl: this.checkoutReturnUrl(bookingId, 'cancel', guestReturnUrl, context),
                  ...(command.embeddedCheckout ? { embedded: true } : {}),
                });
                if (!checkout.ok) throw new CheckoutSessionCreationError(checkout);
                {
                  await tx.$executeRaw`
                  INSERT INTO payment_provider_sessions (
                    tenant_id, property_id, booking_id, provider, external_payment_id, connection_id
                  ) VALUES (
                    ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid,
                    ${paymentMethod.value === BookingPaymentMethod.POKPAY ? 'pokpay' : 'stripe'},
                    ${checkout.value.id}, ${checkout.value.connectionId ?? null}::uuid
                  )
                  ON CONFLICT (tenant_id, provider, external_payment_id) DO NOTHING
                `;
                }
                const row = await this.bookingById(tx, context, bookingId);
                const booking = row && this.toBooking(row);
                return booking
                  ? {
                      ok: true,
                      value: {
                        ...booking,
                        checkoutUrl: checkout.value.url,
                        checkoutOrderId: checkout.value.id,
                        ...(checkout.value.clientSecret && checkout.value.publishableKey
                          ? {
                              checkoutClientSecret: checkout.value.clientSecret,
                              stripePublishableKey: checkout.value.publishableKey,
                            }
                          : {}),
                      },
                    }
                  : this.failure('BOOKING_NOT_FOUND', 'Created booking could not be loaded.');
              }

              status = await this.transition(
                tx,
                context,
                bookingId,
                status,
                BookingStatus.PAYMENT_NOT_REQUIRED,
              );
              status = await this.transition(
                tx,
                context,
                bookingId,
                status,
                BookingStatus.PMS_CREATION_PENDING,
              );

              // Milestone 11.5 Task 4: pay-at-hotel has no payment to gate on
              // (nothing charged online), so a Clock-connected property's real
              // reservation is created right here rather than deferred —
              // there's no ADR-0001 premature-inventory risk for this method.
              if (await this.isClockConnected(context)) {
                const attached = await this.clockBooking.attachRealReservation(
                  tx,
                  context,
                  bookingId,
                );
                if (
                  attached.ok &&
                  attached.value.paymentMethod === BookingPaymentMethod.PAY_AT_HOTEL
                )
                  payAtHotelConfirmationBookingId = attached.value.id;
                return attached;
              }

              status = await this.transition(
                tx,
                context,
                bookingId,
                status,
                BookingStatus.PMS_CONFIRMATION_PENDING,
              );
              await this.transition(tx, context, bookingId, status, BookingStatus.CONFIRMED);
              const row = await this.bookingById(tx, context, bookingId);
              const booking = row && this.toBooking(row);
              if (booking?.paymentMethod === BookingPaymentMethod.PAY_AT_HOTEL)
                payAtHotelConfirmationBookingId = booking.id;
              return booking
                ? { ok: true, value: booking }
                : this.failure('BOOKING_NOT_FOUND', 'Created booking could not be loaded.');
            },
          );
          return this.currentCheckout(tx, context, created);
        },
        { timeoutMs: 30_000 },
      );
      if (payAtHotelConfirmationBookingId)
        await this.confirmations.sendAfterConfirmation(
          context,
          payAtHotelConfirmationBookingId,
          `pay-at-hotel:${payAtHotelConfirmationBookingId}`,
        );
      if (
        !onRequestCreated &&
        result.ok &&
        result.value.status === BookingStatus.ON_REQUEST_PENDING &&
        result.value.onRequestDeadlineAt
      )
        onRequestCreated = { id: result.value.id, deadline: result.value.onRequestDeadlineAt };
      if (onRequestCreated) {
        const request = onRequestCreated as { id: string; deadline: string };
        await Promise.all([
          this.lifecycle?.guest(context, {
            topic: 'booking_request',
            key: 'booking_request_received',
            eventType: 'guest.booking_request_received',
            idempotencyKey: `booking-request/guest/${request.id}`,
            bookingId: request.id,
            heading: 'Booking request received',
            force: true,
            values: { decision_deadline: request.deadline },
          }),
          this.lifecycle?.staff(context, {
            topic: 'booking_request',
            key: 'staff_booking_request',
            eventType: 'staff.booking_request_received',
            idempotencyKey: `booking-request/staff/${request.id}`,
            bookingId: request.id,
            heading: 'Booking request needs a decision',
            values: { decision_deadline: request.deadline },
          }),
        ]);
      }
      return result;
    } catch (error) {
      if (error instanceof CheckoutSessionCreationError) return error.result;
      if (error instanceof PrePaymentAvailabilityError) return error.result;
      throw error;
    }
  }

  /** A staff decision is serialized with expiry and can only be made before the saved deadline. */
  async decideOnRequest(
    context: PmsProviderContext,
    bookingId: string,
    actorUserId: string,
    expectedVersion: number,
    decision: 'accept' | 'decline',
  ): Promise<Result<BookingWithCheckout>> {
    if (await this.isClockConnected(context))
      return this.failure(
        'ON_REQUEST_PMS_UNAVAILABLE',
        'On-request confirmation is unavailable while a PMS is connected.',
      );
    let notification: 'accepted' | 'declined' | null = null;
    let notificationBookingId = bookingId;
    let freeConfirmation = false;
    const result = await this.database.withTenantTransaction(
      context,
      async (tx) => {
        const members = await this.lockRequestMembers(tx, context, bookingId);
        const row = await this.bookingById(tx, context, bookingId);
        if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
        const bookings = await Promise.all(
          members.map(async ({ id }) => (id === row.id ? row : this.bookingById(tx, context, id))),
        );
        const anchor = bookings[0]!;
        notificationBookingId = anchor.id;
        if (bookings.some((item) => !item || item.status !== row.status))
          return this.failure(
            'INVALID_BOOKING_STATE',
            'The rooms in this order do not have the same decision state. Review the order.',
          );
        if (row.status !== BookingStatus.ON_REQUEST_PENDING) {
          if (
            row.onRequestDeadlineAt &&
            ((decision === 'decline' && row.status === BookingStatus.DECLINED) ||
              (decision === 'accept' &&
                [BookingStatus.PAYMENT_PENDING, BookingStatus.CONFIRMED].includes(row.status)))
          ) {
            notification =
              row.status === BookingStatus.CONFIRMED
                ? null
                : decision === 'accept'
                  ? 'accepted'
                  : 'declined';
            return {
              ok: true as const,
              value: {
                ...this.toBooking(row)!,
                ...(anchor.onRequestCheckoutUrl
                  ? { checkoutUrl: anchor.onRequestCheckoutUrl }
                  : {}),
              },
            };
          }
          return this.failure(
            'INVALID_BOOKING_STATE',
            'This booking request has already been decided.',
          );
        }
        if (row.version !== expectedVersion)
          return this.failure(
            'VERSION_CONFLICT',
            'The booking changed. Reload it before deciding.',
          );
        if (!row.onRequestDeadlineAt || row.onRequestDeadlineAt.getTime() <= Date.now())
          return this.failure(
            'REQUEST_DEADLINE_PASSED',
            'The decision deadline has passed. The request will be declined automatically.',
          );
        if (decision === 'decline') {
          for (const member of bookings)
            await this.declineOnRequest(tx, context, member!, actorUserId, 'staff');
          notification = 'declined';
          const updated = await this.bookingById(tx, context, bookingId);
          return { ok: true as const, value: this.toBooking(updated!)! };
        }
        const before = {
          status: row.status,
          version: row.version,
          deadline: row.onRequestDeadlineAt.toISOString(),
        };
        if (row.paymentMethod === BookingPaymentMethod.FREE) {
          for (const member of bookings) {
            let status = await this.transition(
              tx,
              context,
              member!.id,
              member!.status,
              BookingStatus.PAYMENT_NOT_REQUIRED,
            );
            status = await this.transition(
              tx,
              context,
              member!.id,
              status,
              BookingStatus.PMS_CREATION_PENDING,
            );
            status = await this.transition(
              tx,
              context,
              member!.id,
              status,
              BookingStatus.PMS_CONFIRMATION_PENDING,
            );
            await this.transition(tx, context, member!.id, status, BookingStatus.CONFIRMED);
          }
          freeConfirmation = true;
        } else {
          if (
            ![BookingPaymentMethod.POKPAY, BookingPaymentMethod.STRIPE_CHECKOUT].includes(
              row.paymentMethod,
            )
          )
            return this.failure('INVALID_PAYMENT_METHOD', 'An online payment method is required.');
          const [timing] = await tx.$queryRaw<Array<{ dueAt: Date }>>`
            SELECT CURRENT_TIMESTAMP + make_interval(days => payment_link_valid_days) AS "dueAt"
            FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid`;
          if (!timing) return this.failure('PROPERTY_NOT_FOUND', 'Property was not found.');
          const link = requestPaymentLink({
            ...context,
            bookingId: anchor.id,
            dueAt: timing.dueAt.toISOString(),
          });
          for (const member of bookings) {
            await tx.$executeRaw`UPDATE bookings SET payment_due_at=${timing.dueAt}::timestamptz,
              on_request_checkout_url=${member!.id === anchor.id ? link : null}
              WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${member!.id}::uuid`;
          }
          for (const member of bookings)
            await this.transition(
              tx,
              context,
              member!.id,
              member!.status,
              BookingStatus.PAYMENT_PENDING,
            );
        }
        const updated = await this.bookingById(tx, context, bookingId);
        const updatedAnchor =
          anchor.id === bookingId ? updated : await this.bookingById(tx, context, anchor.id);
        for (const member of bookings) {
          const after =
            member!.id === bookingId
              ? updated!
              : (await this.bookingById(tx, context, member!.id))!;
          await this.audit.recordInTransaction(tx, {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            actorUserId,
            action: 'booking.request_accepted',
            source: 'MUST_STAFF',
            targetType: 'booking',
            targetId: member!.id,
            details: {
              before,
              after: {
                status: after.status,
                version: after.version,
                paymentPendingAt: after.paymentPendingAt?.toISOString() ?? null,
                paymentDueAt: after.paymentDueAt?.toISOString() ?? null,
              },
            },
          });
        }
        notification = 'accepted';
        return {
          ok: true as const,
          value: {
            ...this.toBooking(updated!)!,
            ...(updatedAnchor!.onRequestCheckoutUrl
              ? { checkoutUrl: updatedAnchor!.onRequestCheckoutUrl }
              : {}),
          },
        };
      },
      { timeoutMs: 30_000 },
    );
    if (!result.ok || !notification) return result;
    if (freeConfirmation)
      await this.confirmations.sendAfterConfirmation(
        context,
        notificationBookingId,
        `on-request-free/${notificationBookingId}`,
      );
    const accepted = notification === 'accepted';
    const paymentLink =
      'checkoutUrl' in result.value && typeof result.value.checkoutUrl === 'string'
        ? result.value.checkoutUrl
        : undefined;
    await Promise.all([
      this.lifecycle?.guest(context, {
        topic: 'booking_request_decision',
        key: accepted ? 'booking_request_accepted' : 'booking_request_declined',
        eventType: accepted ? 'guest.booking_request_accepted' : 'guest.booking_request_declined',
        idempotencyKey: `booking-request/decision/guest/${notificationBookingId}`,
        bookingId: notificationBookingId,
        heading: accepted ? 'Booking request accepted' : 'Booking request declined',
        force: true,
        ...(accepted && paymentLink
          ? {
              values: { payment_link: paymentLink },
              cta: { label: 'Pay for your booking', url: paymentLink },
            }
          : {}),
      }),
      this.lifecycle?.staff(context, {
        topic: 'booking_request_decision',
        key: 'staff_booking_request_decided',
        eventType: 'staff.booking_request_decided',
        idempotencyKey: `booking-request/decision/staff/${notificationBookingId}`,
        bookingId: notificationBookingId,
        heading: accepted ? 'Booking request accepted' : 'Booking request declined',
      }),
    ]);
    return result;
  }

  private async declineOnRequest(
    tx: TenantTransaction,
    context: PmsProviderContext,
    row: BookingRow,
    actorUserId: string | null,
    cause: 'staff' | 'deadline',
  ): Promise<void> {
    if (!row.roomId)
      await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
        roomTypeId: row.roomTypeId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        units: 1,
      });
    await this.transition(tx, context, row.id, row.status, BookingStatus.DECLINED);
    const updated = await this.bookingById(tx, context, row.id);
    await this.audit.recordInTransaction(tx, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      actorUserId,
      action: 'booking.request_declined',
      source: actorUserId ? 'MUST_STAFF' : 'MUST_AUTOMATION',
      targetType: 'booking',
      targetId: row.id,
      details: {
        before: {
          status: row.status,
          version: row.version,
          deadline: row.onRequestDeadlineAt?.toISOString() ?? null,
        },
        after: { status: updated?.status, version: updated?.version, cause },
      },
    });
  }

  async expireOnRequest(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    now: Date,
  ): Promise<boolean> {
    const members = await this.lockRequestMembers(tx, context, bookingId);
    const row = await this.bookingById(tx, context, bookingId);
    if (
      !row ||
      row.status !== BookingStatus.ON_REQUEST_PENDING ||
      !row.onRequestDeadlineAt ||
      row.onRequestDeadlineAt.getTime() > now.getTime()
    )
      return false;
    for (const member of members) {
      const current = member.id === row.id ? row : await this.bookingById(tx, context, member.id);
      if (current?.status === BookingStatus.ON_REQUEST_PENDING)
        await this.declineOnRequest(tx, context, current, null, 'deadline');
    }
    return true;
  }

  private async lockRequestMembers(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
  ): Promise<Array<{ id: string }>> {
    const hint = await tx.$queryRaw<Array<{ orderReference: string | null }>>`
      SELECT order_reference AS "orderReference" FROM bookings
      WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
        AND id=${bookingId}::uuid`;
    if (!hint[0]) return [];
    if (!hint[0].orderReference)
      return tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bookings
        WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
          AND id=${bookingId}::uuid FOR UPDATE`;
    return tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM bookings
      WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
        AND order_reference=${hint[0].orderReference}
      ORDER BY order_room_number,id FOR UPDATE`;
  }

  async unavailableRoomsForMove(
    context: PmsProviderContext,
    query: RoomMoveAvailabilityQuery,
  ): Promise<Result<RoomMoveAvailabilitySnapshot>> {
    // Clock properties must never fall back to local occupancy.
    if (await this.isClockConnected(context))
      return this.failure(
        'PROVIDER_REQUIRED',
        'The Clock connection must be available to check rooms.',
      );
    const unavailable = await this.database.withTenantTransaction(context, (tx) =>
      this.availability.unavailableRoomsForMove(tx, context.tenantId, context.propertyId, query),
    );
    return {
      ok: true,
      value: {
        unavailableRoomIds: unavailable,
        source: 'LOCAL',
        lastSyncedAt: new Date().toISOString(),
        complete: true,
        stale: false,
      },
    };
  }

  async moveBookingRoom(
    context: PmsProviderContext,
    command: MoveBookingRoomCommand,
  ): Promise<Result<Booking>> {
    return this.database.withTenantTransaction(context, (tx) =>
      this.withIdempotency(
        tx,
        context,
        'move-room:' + command.idempotencyKey,
        command,
        command.bookingId,
        null,
        async () => {
          await this.availability.lockRoom(
            tx,
            context.tenantId,
            context.propertyId,
            command.roomId,
          );
          const row = await this.bookingById(tx, context, command.bookingId);
          if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (row.version !== command.expectedVersion)
            return this.failure('VERSION_CONFLICT', 'The reservation changed. Review it again.');
          if (row.status !== 'CONFIRMED')
            return this.failure(
              'INVALID_BOOKING_STATE',
              'Only confirmed reservations can move rooms.',
            );
          if (row.externalBookingId || (await this.isClockConnected(context)))
            return this.failure(
              'PROVIDER_REQUIRED',
              'Use the active PMS connection to move this reservation.',
            );
          const eligible = await tx.$queryRaw<
            Array<{ allowed: boolean }>
          >`SELECT (p.booking_mode<>'ROOM_TYPE_ONLY' AND b.starts_on>=(now() AT TIME ZONE p.timezone)::date AND COALESCE(b.pms_stay_status,'expected')='expected') AS allowed FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id WHERE b.tenant_id=${context.tenantId}::uuid AND b.property_id=${context.propertyId}::uuid AND b.id=${row.id}::uuid`;
          if (!eligible[0]?.allowed)
            return this.failure(
              'ROOM_MOVE_UNAVAILABLE',
              'Only upcoming stays with individual room assignment can move rooms here.',
            );
          const rooms = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM rooms WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${command.roomId}::uuid AND room_type_id=${row.roomTypeId}::uuid AND is_active`;
          if (!rooms[0])
            return this.failure('ROOM_NOT_FOUND', 'Choose an active room in the booked room type.');
          if (row.roomId === command.roomId) return { ok: true, value: this.toBooking(row)! };
          const available = await this.availability.reserveRoom(
            tx,
            context.tenantId,
            context.propertyId,
            { roomId: command.roomId, startsOn: row.startsOn, endsOn: row.endsOn },
          );
          if (!available)
            return this.failure(
              'ROOM_UNAVAILABLE',
              'This room is no longer available for the whole stay.',
            );
          if (!row.roomId)
            await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
              roomTypeId: row.roomTypeId,
              startsOn: row.startsOn,
              endsOn: row.endsOn,
              units: 1,
            });
          await tx.$executeRaw`UPDATE bookings SET room_id=${command.roomId}::uuid,version=version+1,updated_at=now() WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND id=${row.id}::uuid`;
          await this.audit.recordInTransaction(tx, {
            ...context,
            actorUserId: command.staffActorId,
            action: 'booking.room_moved',
            operationId: command.idempotencyKey,
            targetType: 'booking',
            targetId: row.id,
            details: { oldRoomId: row.roomId, newRoomId: command.roomId, reason: command.reason },
          });
          return {
            ok: true,
            value: this.toBooking((await this.bookingById(tx, context, row.id))!)!,
          };
        },
      ),
    );
  }

  async updateBooking(
    context: PmsProviderContext,
    command: UpdateBookingCommand,
  ): Promise<Result<Booking>> {
    if (
      command.roomTypeId ||
      command.ratePlanId ||
      command.startsOn ||
      command.endsOn ||
      command.guest
    ) {
      return this.failure(
        'UNSUPPORTED_UPDATE',
        'Room, rate, stay, and guest changes are not available yet.',
      );
    }
    if (command.total && !this.validAmount(command.total.amount))
      return this.failure('INVALID_BOOKING_COMMAND', 'Booking total is invalid.');

    return this.database.withTenantTransaction(context, (tx) =>
      this.withIdempotency(
        tx,
        context,
        command.idempotencyKey,
        command,
        command.bookingId,
        null,
        async () => {
          const row = await this.bookingById(tx, context, command.bookingId);
          if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (row.guestSessionId !== command.guestSessionId)
            return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (row.version !== command.expectedVersion)
            return this.failure(
              'VERSION_CONFLICT',
              'Booking has changed; reload it before updating.',
              true,
            );
          const booking = this.toBooking(row);
          if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (!command.total) return { ok: true, value: booking };
          if (
            ![
              BookingStatus.DRAFT,
              BookingStatus.QUOTED,
              BookingStatus.INVENTORY_REVALIDATING,
            ].includes(row.status)
          ) {
            return this.failure(
              'UNSUPPORTED_UPDATE',
              'Booking total cannot be changed after inventory reservation or payment has begun.',
            );
          }
          if (command.total.currency !== row.currency)
            return this.failure(
              'CURRENCY_MISMATCH',
              'Booking total currency must match the rate plan currency.',
            );

          await tx.$executeRaw`
        UPDATE bookings
        SET total_amount = ${command.total.amount}::numeric, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${command.bookingId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND property_id = ${context.propertyId}::uuid
          AND version = ${command.expectedVersion}
      `;
          const updated = await this.bookingById(tx, context, command.bookingId);
          return updated && this.toBooking(updated)
            ? { ok: true, value: this.toBooking(updated)! }
            : this.failure('BOOKING_NOT_FOUND', 'Updated booking could not be loaded.');
        },
      ),
    );
  }

  async resendPokPayCheckout(
    context: PmsProviderContext,
    command: ResendPokPayCheckoutCommand,
  ): Promise<Result<BookingWithCheckout>> {
    return this.database.withTenantTransaction(
      context,
      (tx) =>
        this.withIdempotency(
          tx,
          context,
          command.idempotencyKey,
          command,
          command.bookingId,
          null,
          async () => {
            const booking = await this.bookingById(tx, context, command.bookingId);
            if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
            if (booking.status !== BookingStatus.PAYMENT_PENDING)
              return this.failure(
                'INVALID_BOOKING_STATE',
                `A PokPay checkout link cannot be resent from ${booking.status}.`,
              );
            if (booking.paymentMethod !== BookingPaymentMethod.POKPAY)
              return this.failure(
                'POKPAY_CHECKOUT_NOT_AVAILABLE',
                'This reservation was not started with PokPay.',
              );
            const provider = this.paymentProviders.forBookingMethod(BookingPaymentMethod.POKPAY);
            if (!provider)
              return this.failure(
                'PAYMENT_PROVIDER_NOT_AVAILABLE',
                'PokPay is unavailable for this reservation.',
              );
            const checkoutAmount = await this.checkoutAmount(tx, context, booking);
            const checkout = await provider.createCheckoutSession(context, {
              idempotencyKey: command.idempotencyKey,
              bookingId: booking.id,
              description: await loadCheckoutDescription(tx, context, booking.id),
              expiresAfterMinutes: await checkoutHoldMinutes(tx, context, booking.id),
              amount: { amount: checkoutAmount, currency: booking.currency },
              successUrl: this.checkoutReturnUrl(
                booking.id,
                'success',
                booking.guestReturnUrl,
                context,
              ),
              cancelUrl: this.checkoutReturnUrl(
                booking.id,
                'cancel',
                booking.guestReturnUrl,
                context,
              ),
            });
            if (!checkout.ok) return checkout;
            // Keep every gateway order binding. A guest may still complete an
            // earlier link after staff sends a new one; payment-ledger and
            // booking-state idempotency decide which verified completion wins.
            await tx.$executeRaw`
              INSERT INTO payment_provider_sessions (
                tenant_id, property_id, booking_id, provider, external_payment_id, connection_id
              ) VALUES (
                ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
                'pokpay', ${checkout.value.id}, ${checkout.value.connectionId ?? null}::uuid
              )
              ON CONFLICT (tenant_id, provider, external_payment_id) DO NOTHING
            `;
            await this.audit.recordInTransaction(tx, {
              tenantId: context.tenantId,
              propertyId: context.propertyId,
              actorUserId: command.actorUserId,
              action: 'payment.pokpay_checkout_resent',
              targetType: 'booking',
              targetId: booking.id,
              details: { externalPaymentId: checkout.value.id },
            });
            const value = this.toBooking(booking);
            return value
              ? {
                  ok: true,
                  value: {
                    ...value,
                    checkoutUrl: checkout.value.url,
                    checkoutOrderId: checkout.value.id,
                  },
                }
              : this.failure('BOOKING_NOT_FOUND', 'Booking could not be reloaded.');
          },
        ),
      { timeoutMs: 30_000 },
    );
  }

  async mirrorConfirmedPayment(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    amount: Money,
    reference: string,
    method: 'cash' | 'card_in_person' | 'bank_transfer',
  ) {
    if (!(await this.isClockConnected(context))) return;
    await this.clockBooking.postDeposit(
      tx,
      context,
      bookingId,
      amount,
      method === 'cash' ? 'Cash' : method === 'card_in_person' ? 'Card / POS' : 'Bank transfer',
      reference,
      method === 'cash' ? 'cash' : method === 'card_in_person' ? 'card' : 'bank',
    );
  }

  async continueAfterPayment(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    payment?: ConfirmedPaymentDetails,
  ): Promise<Result<Booking>> {
    const row = await this.bookingById(tx, context, bookingId);
    if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
    if (row.orderReference)
      return this.continueMultiRoomOrderAfterPayment(tx, context, row, payment);
    if (
      row.status !== BookingStatus.PAYMENT_PENDING &&
      row.status !== BookingStatus.PMS_CREATION_PENDING
    ) {
      return this.failure(
        'INVALID_BOOKING_STATE',
        `Booking cannot be confirmed from ${row.status}.`,
      );
    }

    let status: BookingStatus = row.status;
    if (row.status === BookingStatus.PAYMENT_PENDING) {
      status = await this.transition(
        tx,
        context,
        bookingId,
        row.status,
        BookingStatus.PMS_CREATION_PENDING,
      );
    }

    // Milestone 11.5 Task 4 (ADR-0001 payment-first ordering): payment is
    // already confirmed at this point (the caller only reaches
    // continueAfterPayment from a verified gateway webhook) — this is where
    // a Clock-connected property's real reservation gets created, never
    // earlier. attachRealReservation owns its own transitions on both
    // success (-> CONFIRMED) and failure (-> PMS_UNKNOWN_RESULT + manual
    // review; never a silent retry or auto-refund, since the guest has
    // already paid).
    if (await this.isClockConnected(context)) {
      const attached = await this.clockBooking.attachRealReservation(tx, context, bookingId);
      // Milestone 11.5 Task 5: the deposit posts only once the reservation
      // itself is real — a failure here is recorded (inside postDeposit) as
      // a ManualReviewItem, not surfaced as an overall failure, since the
      // booking is genuinely confirmed at Clock at this point; only the
      // secondary accounting entry needs a human.
      if (attached.ok) {
        // payment_type is one of Clock's own fixed enum values (cash, card,
        // bank, debit, on-line, check, vaucher, other, transfer,
        // crossaccounttransfer, tip, barter) — postDeposit hardcodes
        // 'on-line' for this. The specific gateway isn't one of Clock's
        // categories, so it goes in payment_sub_type instead.
        await this.clockBooking.postDeposit(
          tx,
          context,
          bookingId,
          { amount: row.totalAmount, currency: row.currency },
          payment?.paymentSubType ??
            (row.paymentMethod === BookingPaymentMethod.STRIPE_CHECKOUT ? 'Stripe' : 'PokPay'),
          payment?.reference ?? row.externalReference,
          payment?.paymentType,
        );
      }
      return attached;
    }

    status = await this.transition(
      tx,
      context,
      bookingId,
      status,
      BookingStatus.PMS_CONFIRMATION_PENDING,
    );
    await this.transition(tx, context, bookingId, status, BookingStatus.CONFIRMED);
    const confirmed = await this.bookingById(tx, context, bookingId);
    return confirmed && this.toBooking(confirmed)
      ? { ok: true, value: this.toBooking(confirmed)! }
      : this.failure('BOOKING_NOT_FOUND', 'Confirmed booking could not be loaded.');
  }

  /** Task 15: one confirmed gateway charge fans out to every child in its local
   * order. Each Clock attach is intentionally independent: attachRealReservation
   * records a manual-review item for only the failed child, while this loop keeps
   * confirming its siblings. */
  private async continueMultiRoomOrderAfterPayment(
    tx: TenantTransaction,
    context: PmsProviderContext,
    anchor: BookingRow,
    payment?: ConfirmedPaymentDetails,
  ): Promise<Result<Booking>> {
    if (anchor.status !== BookingStatus.PAYMENT_PENDING)
      return this.failure(
        'INVALID_BOOKING_STATE',
        `Booking cannot be confirmed from ${anchor.status}.`,
      );
    const childIds = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND order_reference = ${anchor.orderReference}
      ORDER BY order_room_number, id
      FOR UPDATE
    `;
    const clockConnected = await this.isClockConnected(context);
    for (const child of childIds) {
      const row = await this.bookingById(tx, context, child.id);
      if (!row || row.status !== BookingStatus.PAYMENT_PENDING) continue;
      let status = await this.transition(
        tx,
        context,
        row.id,
        BookingStatus.PAYMENT_PENDING,
        BookingStatus.PMS_CREATION_PENDING,
      );
      if (clockConnected) {
        const attached = await this.clockBooking.attachRealReservation(tx, context, row.id);
        if (!attached.ok) continue;
        await this.clockBooking.postDeposit(
          tx,
          context,
          row.id,
          { amount: row.totalAmount, currency: row.currency },
          payment?.paymentSubType ??
            (row.paymentMethod === BookingPaymentMethod.STRIPE_CHECKOUT ? 'Stripe' : 'PokPay'),
          payment?.reference ?? row.externalReference,
          payment?.paymentType,
        );
        continue;
      }
      status = await this.transition(
        tx,
        context,
        row.id,
        status,
        BookingStatus.PMS_CONFIRMATION_PENDING,
      );
      await this.transition(tx, context, row.id, status, BookingStatus.CONFIRMED);
    }
    const confirmed = await this.bookingById(tx, context, anchor.id);
    return confirmed && this.toBooking(confirmed)
      ? { ok: true, value: this.toBooking(confirmed)! }
      : this.failure('BOOKING_NOT_FOUND', 'Booking could not be reloaded.');
  }

  async expirePaymentPending(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    cutoffAt: Date,
    reconcileGraceMs = REQUEST_RECONCILE_GRACE_MS,
  ): Promise<boolean> {
    const sweepTime = new Date(cutoffAt.getTime() + 30 * 60000);
    const settings = await tx.$queryRaw<
      { minutes: number }[]
    >`SELECT online_payment_hold_minutes AS minutes FROM properties WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid FOR UPDATE`;
    cutoffAt = new Date(cutoffAt.getTime() + (30 - (settings[0]?.minutes ?? 30)) * 60000);
    let row = await this.bookingById(tx, context, bookingId);
    if (row?.paymentDueAt) {
      await this.lockRequestMembers(tx, context, bookingId);
      row = await this.bookingById(tx, context, bookingId);
    }
    if (
      !row ||
      row.status !== BookingStatus.PAYMENT_PENDING ||
      (row.paymentDueAt
        ? row.paymentDueAt.getTime() > sweepTime.getTime()
        : (row.paymentPendingAt ?? row.createdAt).getTime() > cutoffAt.getTime())
    ) {
      return false;
    }
    // A guest may have paid just before the deadline while the provider's notice is still on its way. While a
    // payment page is open, the sweep waits a few minutes (and the poll/webhook can confirm) before it releases
    // the room. A notice that proves a payment came after the deadline expires the booking at once (grace 0).
    if (
      row.paymentDueAt &&
      reconcileGraceMs > 0 &&
      row.paymentDueAt.getTime() + reconcileGraceMs > sweepTime.getTime()
    ) {
      const [open] = await tx.$queryRaw<Array<{ open: boolean }>>`SELECT EXISTS(
        SELECT 1 FROM integration_operations WHERE tenant_id=${context.tenantId}::uuid
          AND property_id=${context.propertyId}::uuid AND aggregate_id=${bookingId}::uuid
          AND result->>'kind'='request_checkout' AND result->>'stage'='READY') AS open`;
      if (open?.open) return false;
    }
    if (row.orderReference) {
      const children = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM bookings
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND order_reference = ${row.orderReference}
        ORDER BY order_room_number, id
        FOR UPDATE
      `;
      for (const child of children) {
        const childRow = await this.bookingById(tx, context, child.id);
        if (!childRow || childRow.status !== BookingStatus.PAYMENT_PENDING) continue;
        if (!childRow.roomId)
          await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
            roomTypeId: childRow.roomTypeId,
            startsOn: childRow.startsOn,
            endsOn: childRow.endsOn,
            units: 1,
          });
        await this.transition(tx, context, childRow.id, childRow.status, BookingStatus.EXPIRED);
      }
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId: null,
        action: 'booking.order_payment_expired',
        targetType: 'booking_order',
        targetId: row.orderReference,
        details: { cutoffAt: cutoffAt.toISOString() },
      });
      return true;
    }
    await this.releaseUnpaidHold(tx, context, row);
    await this.audit.recordInTransaction(tx, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      actorUserId: null,
      action: 'booking.payment_expired',
      targetType: 'booking',
      targetId: bookingId,
      details: { cutoffAt: cutoffAt.toISOString() },
    });
    return true;
  }

  /**
   * Recheck the due time before processing a provider notification, even between sweep runs. A payment that was
   * finished before the deadline keeps the booking, however late its notice arrives: either the provider's own
   * time (`paidAt`) is not after the deadline, or the payment page we created could not stay open past it.
   */
  async expireRequestPaymentIfDue(
    context: PmsProviderContext,
    bookingId: string,
    evidence: { externalPaymentId?: string; paidAt?: Date } = {},
  ): Promise<void> {
    await this.database.withTenantTransaction(context, async (tx) => {
      const [candidate] = await tx.$queryRaw<
        Array<{ due: boolean; dueAt: Date }>
      >`SELECT payment_due_at <= CURRENT_TIMESTAMP AS due,
          payment_due_at AS "dueAt"
        FROM bookings WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
          AND id=${bookingId}::uuid AND status='PAYMENT_PENDING' AND payment_due_at IS NOT NULL`;
      if (!candidate?.due) return;
      if (evidence.paidAt && evidence.paidAt.getTime() <= candidate.dueAt.getTime()) return;
      if (evidence.externalPaymentId) {
        const [bound] = await tx.$queryRaw<
          Array<{ onTime: boolean }>
        >`SELECT COALESCE((result->>'expiresAt')::timestamptz <= ${candidate.dueAt}::timestamptz, false) AS "onTime"
          FROM integration_operations WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
            AND aggregate_id=${bookingId}::uuid AND result->>'kind'='request_checkout'
            AND external_reference=${evidence.externalPaymentId} LIMIT 1`;
        if (bound?.onTime) return;
      }
      await this.expirePaymentPending(tx, context, bookingId, new Date(Date.now() - 30 * 60000), 0);
    });
  }

  /** Gives back what a single unpaid online booking held and marks it expired. */
  private async releaseUnpaidHold(
    tx: TenantTransaction,
    context: PmsProviderContext,
    row: {
      id: string;
      status: BookingStatus;
      roomId?: string | null;
      roomTypeId: string;
      startsOn: string;
      endsOn: string;
    },
  ): Promise<void> {
    if (!row.roomId)
      await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
        roomTypeId: row.roomTypeId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        units: 1,
      });
    await this.transition(tx, context, row.id, row.status, BookingStatus.EXPIRED);
  }

  /**
   * A guest who leaves the payment page and starts again would otherwise be refused by their own unpaid
   * hold until it ran out (30 minutes by default). Before a new website booking reserves anything, the
   * same browser session's earlier unpaid single-room online booking for the same room type and overlapping dates
   * is released. The session is the server-issued guest cookie that the signed quote is bound to; the email a guest
   * types is deliberately not used, because anyone could type another person's address. Only a booking that is still
   * waiting for payment and has no payment recorded is touched. If the guest still pays on the old page, the
   * late-payment flow refunds it (ADR-0043), and an old Stripe page is closed by the expiry sweep.
   */
  private async releaseOwnUnpaidHolds(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<void> {
    if (command.staffActorId || !command.quoteSessionId) return;
    const held = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT b.id
      FROM bookings b
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
        AND b.status = 'PAYMENT_PENDING'::"BookingStatus"
        AND b.payment_due_at IS NULL
        AND b.source = 'WEBSITE'
        AND b.order_reference IS NULL
        AND b.room_type_id = ${command.roomTypeId}::uuid
        AND b.starts_on < ${command.endsOn}::date AND b.ends_on > ${command.startsOn}::date
        AND b.guest_session_id = ${command.quoteSessionId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id)
      ORDER BY b.id
      FOR UPDATE OF b
    `;
    for (const { id } of held) {
      const row = await this.bookingById(tx, context, id);
      if (!row || row.status !== BookingStatus.PAYMENT_PENDING) continue;
      await this.releaseUnpaidHold(tx, context, row);
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId: null,
        action: 'booking.payment_superseded',
        targetType: 'booking',
        targetId: id,
        details: { replacedByExternalReference: command.externalReference ?? null },
      });
    }
  }

  /**
   * When a new booking is refused and the room is only held by someone else's unpaid booking, say that
   * (and when it frees up) instead of the generic "no longer available". Returns null when nothing is
   * held for payment, so the usual refusal stands.
   */
  private async heldForPaymentFailure(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
    bookingId: string,
  ): Promise<Result<never> | null> {
    const held = await tx.$queryRaw<Array<{ minutes: number }>>`
      SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
        MIN(COALESCE(b.payment_due_at, b.created_at + make_interval(mins => p.online_payment_hold_minutes))) - now()
      )) / 60))::int AS minutes
      FROM bookings b
      JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
      WHERE b.tenant_id = ${context.tenantId}::uuid AND b.property_id = ${context.propertyId}::uuid
        AND b.id <> ${bookingId}::uuid
        AND b.status = 'PAYMENT_PENDING'::"BookingStatus"
        AND b.room_type_id = ${command.roomTypeId}::uuid
        AND b.starts_on < ${command.endsOn}::date AND b.ends_on > ${command.startsOn}::date
      GROUP BY p.online_payment_hold_minutes
    `;
    const minutes = held[0]?.minutes;
    if (minutes === undefined || minutes === null) return null;
    return this.failure(
      'ROOM_HELD_FOR_PAYMENT',
      `This room is being held for another guest who has not finished paying yet. If they do not, it becomes available again in about ${minutes} minute${minutes === 1 ? '' : 's'}. Please try again then, or choose other dates.`,
    );
  }

  async cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand & {
      notifyGuest?: boolean;
      singleBooking?: boolean;
      onlyPendingRequest?: boolean;
      /** Set only when a reviewer approved a saved cancellation request. The booking's version may have moved
       * for harmless reasons, so it is not compared; instead the dates and total the request was made on (when
       * it saved them) are checked here, under the booking's row lock, and must still be the same. */
      approvedRequest?: { startsOn?: string; endsOn?: string; total?: string };
    },
  ): Promise<Result<Booking>> {
    const refundConfirmations: RefundConfirmation[] = [];
    const cancelledBookingIds: string[] = [];
    const result = await this.database.withTenantTransaction(
      context,
      (tx) =>
        this.withIdempotency(
          tx,
          context,
          command.idempotencyKey,
          command,
          command.bookingId,
          null,
          async () => {
            if (command.approvedRequest)
              await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${command.bookingId}::uuid
                AND tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid FOR UPDATE`;
            const row = await this.bookingById(tx, context, command.bookingId);
            if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
            if (!command.staffActorId && row.guestSessionId !== command.guestSessionId)
              return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
            if (command.onlyPendingRequest && row.status !== BookingStatus.ON_REQUEST_PENDING)
              return this.failure('INVALID_BOOKING_STATE', 'This request is no longer waiting.');
            if (row.status === BookingStatus.ON_REQUEST_PENDING) {
              const members = await this.lockRequestMembers(tx, context, row.id);
              const current = await this.bookingById(tx, context, row.id);
              if (
                !current ||
                current.status !== BookingStatus.ON_REQUEST_PENDING ||
                current.version !== command.expectedVersion
              )
                return this.failure(
                  'VERSION_CONFLICT',
                  'Booking has changed; reload it before cancelling.',
                  true,
                );
              const selected =
                command.staffActorId && command.singleBooking
                  ? members.filter((member) => member.id === row.id)
                  : members;
              for (const member of selected) {
                const pending =
                  member.id === current.id
                    ? current
                    : await this.bookingById(tx, context, member.id);
                if (!pending || pending.status !== BookingStatus.ON_REQUEST_PENDING)
                  return this.failure(
                    'INVALID_BOOKING_STATE',
                    'The booking request has already been decided.',
                  );
              }
              for (const member of selected) {
                const pending =
                  member.id === current.id
                    ? current
                    : (await this.bookingById(tx, context, member.id))!;
                if (!pending.roomId)
                  await this.availability.releaseBookedUnits(
                    tx,
                    context.tenantId,
                    context.propertyId,
                    {
                      roomTypeId: pending.roomTypeId,
                      startsOn: pending.startsOn,
                      endsOn: pending.endsOn,
                      units: 1,
                    },
                  );
                await this.transition(
                  tx,
                  context,
                  pending.id,
                  pending.status,
                  BookingStatus.CANCELLED,
                );
                const after = await this.bookingById(tx, context, pending.id);
                await this.audit.recordInTransaction(tx, {
                  tenantId: context.tenantId,
                  propertyId: context.propertyId,
                  actorUserId: command.staffActorId ?? null,
                  action: 'booking.cancelled',
                  targetType: 'booking',
                  targetId: pending.id,
                  details: {
                    before: { status: pending.status, version: pending.version },
                    after: { status: after!.status, version: after!.version },
                  },
                });
                cancelledBookingIds.push(pending.id);
              }
              const cancelled = await this.bookingById(tx, context, row.id);
              return { ok: true as const, value: this.toBooking(cancelled!)! };
            }
            const approved = command.approvedRequest;
            if (
              approved &&
              ((approved.startsOn !== undefined && approved.startsOn !== row.startsOn) ||
                (approved.endsOn !== undefined && approved.endsOn !== row.endsOn) ||
                (approved.total !== undefined && approved.total !== row.totalAmount))
            )
              return this.failure(
                'VERSION_CONFLICT',
                'The booking changed since the request was made; reject it and create a fresh request.',
                true,
              );
            const expectedVersion = approved ? row.version : command.expectedVersion;
            if (row.version !== expectedVersion)
              return this.failure(
                'VERSION_CONFLICT',
                'Booking has changed; reload it before cancelling.',
                true,
              );
            if (row.orderReference && !(command.staffActorId && command.singleBooking)) {
              if (!command.staffActorId && (await this.isClockConnected(context)))
                return this.failure(
                  'CANCELLATION_REQUIRES_REVIEW',
                  'Multi-room Clock bookings require staff review. Please send a cancellation request.',
                );
              const cancelled = await this.cancelMultiRoomOrder(tx, context, command, row);
              refundConfirmations.push(...cancelled.refundConfirmations);
              cancelledBookingIds.push(...cancelled.cancelledBookingIds);
              return cancelled.result;
            }
            const booking = this.toBooking(row);
            if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
            if (!this.stateMachine.canTransition(row.status, BookingStatus.CANCELLED))
              return this.failure(
                'INVALID_BOOKING_STATE',
                `Booking cannot be cancelled from ${row.status}.`,
              );

            // Milestone 11.5 Task 6: self-service cancellation window, separate
            // from the rate plan's own refund-eligibility policy below — this
            // is an access gate (can the guest cancel online at all), not a
            // money question. Every cancellation reaching this point is
            // guest-initiated (row.guestSessionId matched command.guestSessionId
            // above), so staff cancellations deliberately bypass this gate.
            const selfServiceWindow = command.staffActorId
              ? [{ canCancel: true }]
              : await tx.$queryRaw<Array<{ canCancel: boolean }>>`
            SELECT CASE WHEN b.cancellation_terms IS NOT NULL THEN b.cancellation_terms->>'arrivalDate'=b.starts_on::text AND CURRENT_TIMESTAMP <= (b.cancellation_terms->>'cutoffAt')::timestamptz
              WHEN b.external_booking_id IS NOT NULL OR EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id WHERE pc.tenant_id=b.tenant_id AND pc.property_id=b.property_id AND pc.enabled AND pc.kind='PMS' AND ic.provider='CLOCK_PMS') THEN false
              ELSE CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)-make_interval(days=>p.free_cancellation_days_before_arrival) END AS "canCancel"
            FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
            WHERE b.id = ${row.id}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          `;
            if (selfServiceWindow[0]?.canCancel === false)
              return this.failure(
                'CANCELLATION_WINDOW_CLOSED',
                'This booking is too close to arrival to cancel online. Please contact the hotel directly.',
              );

            let cancelledInClock = false;
            if (await this.isClockConnected(context)) {
              if (!command.staffActorId) {
                const checked = await tx.$queryRaw<
                  Array<{ safe: boolean }>
                >`SELECT EXISTS(SELECT 1 FROM clock_sync_jobs j JOIN property_integration_connections pc ON pc.tenant_id=j.tenant_id AND pc.property_id=j.property_id AND pc.connection_id=j.connection_id AND pc.enabled AND pc.kind='PMS' WHERE j.tenant_id=${context.tenantId}::uuid AND j.property_id=${context.propertyId}::uuid AND j.resource=${'financial:' + row.id} AND j.status='SYNCED' AND j.last_error IS NULL AND (j.snapshot->>'fetchedAt')::timestamptz>now()-interval '60 seconds' AND (j.snapshot->>'bookingVersion')::int=${row.version}
                  AND (j.snapshot#>>'{paid,amount}')::numeric=(j.snapshot->>'localPaid')::numeric
                  AND (j.snapshot#>>'{refunded,amount}')::numeric=(j.snapshot->>'localRefunded')::numeric
                  AND j.snapshot#>>'{balance,currency}'=${row.currency}
                  AND (j.snapshot#>>'{balance,amount}')::numeric>=0
                  AND (SELECT count(*) FROM payments WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND booking_id=${row.id}::uuid AND kind='CHARGE' AND status IN ('PAID','succeeded'))<=1
                  AND NOT EXISTS(SELECT 1 FROM payments WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND booking_id=${row.id}::uuid AND kind='CHARGE' AND status IN ('PAID','succeeded') AND provider NOT IN ('pokpay','stripe'))
                  AND (j.snapshot->>'localPaid')::numeric=COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND booking_id=${row.id}::uuid AND kind='CHARGE' AND status IN ('PAID','succeeded')),0) AND (j.snapshot->>'localRefunded')::numeric=COALESCE((SELECT sum(amount) FROM payments WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND booking_id=${row.id}::uuid AND kind='REFUND' AND status='REFUNDED'),0)) AS safe`;
                if (!checked[0]?.safe)
                  return this.failure(
                    'CANCELLATION_REQUIRES_REVIEW',
                    'The payment position changed. Hotel staff must review this cancellation.',
                  );
              }
              if (row.externalBookingId) {
                const cancelledAtClock = await this.clockBooking.cancelRealReservation(
                  context,
                  row.externalBookingId,
                );
                if (!cancelledAtClock.ok) return cancelledAtClock;
                cancelledInClock = true;
              }
            }

            const cancellationPolicy = await this.cancellationPolicy(tx, context, row.id);
            if (cancelledInClock && cancellationPolicy.isFree && row.externalBookingId)
              await this.clearRoomChargesAfterFreeCancellation(
                tx,
                context,
                row.id,
                row.externalBookingId,
              );
            if (
              cancellationPolicy.isFree &&
              cancellationPolicy.autoRefund !== false &&
              !command.skipAutomaticRefund
            ) {
              const refunded = await this.refunds.refundPaidChargeForBooking(
                tx,
                context,
                row.id,
                `cancellation-refund:${command.idempotencyKey}`,
                // A guest who cancels on their own bears the payment fee (when the hotel says so).
                { guestDecision: !command.staffActorId },
              );
              if (!refunded.result.ok)
                await this.recordAutomaticRefundFailure(tx, context, row.id, refunded.result.error);
              if (refunded.confirmation) refundConfirmations.push(refunded.confirmation);
            }

            if (
              !row.roomId &&
              (row.status === BookingStatus.PAYMENT_PENDING ||
                row.status === BookingStatus.PMS_CONFIRMATION_PENDING ||
                row.status === BookingStatus.CONFIRMED)
            ) {
              await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
                roomTypeId: row.roomTypeId,
                startsOn: row.startsOn,
                endsOn: row.endsOn,
                units: 1,
              });
            }
            this.stateMachine.transition(row.status, BookingStatus.CANCELLED);
            await tx.$executeRaw`
        UPDATE bookings
        SET status = ${BookingStatus.CANCELLED}::"BookingStatus",
            cancellation_is_free = ${cancellationPolicy.isFree},
            cancellation_free_until_hours = ${cancellationPolicy.freeCancellationUntilHours},
            cancellation_cutoff_at = ${cancellationPolicy.cutoffAt}::timestamptz,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.id}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND property_id = ${context.propertyId}::uuid
          AND version = ${expectedVersion}
      `;
            await this.audit.recordInTransaction(tx, {
              tenantId: context.tenantId,
              propertyId: context.propertyId,
              actorUserId: command.staffActorId ?? null,
              action: 'booking.cancelled',
              targetType: 'booking',
              targetId: row.id,
              details: {
                guestId: booking.guestId,
                cancellation: {
                  isFree: cancellationPolicy.isFree,
                  freeCancellationUntilHours: cancellationPolicy.freeCancellationUntilHours,
                  cutoffAt: cancellationPolicy.cutoffAt?.toISOString() ?? null,
                },
              },
            });
            cancelledBookingIds.push(row.id);
            const cancelled = await this.bookingById(tx, context, row.id);
            return cancelled && this.toBooking(cancelled)
              ? { ok: true, value: this.toBooking(cancelled)! }
              : this.failure('BOOKING_NOT_FOUND', 'Cancelled booking could not be loaded.');
          },
        ),
      { timeoutMs: 30_000 },
    );
    for (const refundConfirmation of refundConfirmations)
      await this.notifications.sendRefundConfirmationEmailSafely(refundConfirmation, context);
    for (const cancelledBookingId of cancelledBookingIds)
      await this.cancellations.sendAfterCancellation(context, cancelledBookingId, {
        notifyGuest: command.notifyGuest,
      });
    return result;
  }

  /** Task 19: a cancellation request for any child is an order cancellation.
   * Every child remains independently subject to its own Clock, inventory and
   * refund-policy work; the one gateway charge is refunded only for the sum of
   * children whose policies permit it. */
  private async cancelMultiRoomOrder(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: CancelBookingCommand,
    anchor: BookingRow,
  ): Promise<MultiRoomCancellation> {
    const orderReference = anchor.orderReference;
    if (!orderReference)
      return this.multiRoomCancellationFailure(
        'BOOKING_NOT_FOUND',
        'Multi-room order could not be identified.',
      );
    const childIds = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND order_reference = ${orderReference}
      ORDER BY order_room_number, id
      FOR UPDATE
    `;
    const clockConnected = await this.isClockConnected(context);
    const refundConfirmations: RefundConfirmation[] = [];
    const cancelledBookingIds: string[] = [];
    const children: Array<{ row: BookingRow; cancellationPolicy: CancellationPolicy }> = [];
    let refundCurrency: string | null = null;

    // Validate every child before making an irreversible provider call. Once
    // Clock confirms a room cancellation, its local projection must be
    // updated before attempting the next child (Task 20).
    for (const child of childIds) {
      const row = await this.bookingById(tx, context, child.id);
      if (!row || (!command.staffActorId && row.guestSessionId !== command.guestSessionId))
        return this.multiRoomCancellationFailure('BOOKING_NOT_FOUND', 'Booking was not found.');
      if (!this.stateMachine.canTransition(row.status, BookingStatus.CANCELLED))
        return this.multiRoomCancellationFailure(
          'INVALID_BOOKING_STATE',
          `Booking cannot be cancelled from ${row.status}.`,
        );
      if (
        !command.staffActorId &&
        !(await this.selfServiceCancellationAllowed(tx, context, row.id))
      )
        return this.multiRoomCancellationFailure(
          'CANCELLATION_WINDOW_CLOSED',
          'This booking is too close to arrival to cancel online. Please contact the hotel directly.',
        );
      const cancellationPolicy = await this.cancellationPolicy(tx, context, row.id);
      if (cancellationPolicy.isFree) {
        if (refundCurrency && refundCurrency !== row.currency)
          return this.multiRoomCancellationFailure(
            'CURRENCY_MISMATCH',
            'Rooms in one order must use the same refund currency.',
          );
        refundCurrency = row.currency;
      }
      children.push({ row, cancellationPolicy });
    }

    const cancelledChildren: Array<{ row: BookingRow; cancellationPolicy: CancellationPolicy }> =
      [];
    let cancellationFailure: Result<never> | null = null;
    for (const child of children) {
      if (clockConnected && child.row.externalBookingId) {
        const cancelledAtClock = await this.clockBooking.cancelRealReservation(
          context,
          child.row.externalBookingId,
        );
        if (!cancelledAtClock.ok) {
          await this.manualReview.recordInTransaction(tx, {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            category: 'UNKNOWN_RESULT',
            referenceType: 'booking',
            referenceId: child.row.id,
            message: `Clock cancellation could not be confirmed for this room: ${cancelledAtClock.error.message}`,
            context: {
              kind: 'ORDER_ROOM_CLOCK_CANCEL_UNCONFIRMED',
              orderReference,
              externalBookingId: child.row.externalBookingId,
              errorCode: cancelledAtClock.error.code,
              retryable: cancelledAtClock.error.retryable,
            },
          });
          cancellationFailure ??= this.failure(
            'ORDER_CANCELLATION_PARTIAL_FAILURE',
            'Some rooms could not be cancelled. Hotel staff will review the affected room.',
            cancelledAtClock.error.retryable,
          );
          continue;
        }
      }

      if (clockConnected && child.row.externalBookingId && child.cancellationPolicy.isFree)
        await this.clearRoomChargesAfterFreeCancellation(
          tx,
          context,
          child.row.id,
          child.row.externalBookingId,
        );

      await this.applyMultiRoomCancellation(
        tx,
        context,
        orderReference,
        child.row,
        child.cancellationPolicy,
        command.staffActorId,
      );
      cancelledBookingIds.push(child.row.id);
      cancelledChildren.push(child);
    }

    let refundableMinorUnits = 0n;
    for (const { row, cancellationPolicy } of cancelledChildren) {
      if (!cancellationPolicy.isFree || cancellationPolicy.autoRefund === false) continue;
      refundableMinorUnits += this.minorUnits(row.totalAmount);
    }

    if (refundableMinorUnits > 0n && refundCurrency) {
      const amount: Money = { amount: this.money(refundableMinorUnits), currency: refundCurrency };
      const refunded = await this.refunds.refundPaidChargeForBookingAmount(
        tx,
        context,
        anchor.id,
        amount,
        `order-cancellation-refund:${command.idempotencyKey}`,
        undefined,
        { guestDecision: !command.staffActorId },
      );
      if (!refunded.result.ok)
        await this.recordAutomaticRefundFailure(tx, context, anchor.id, refunded.result.error, {
          orderReference,
          amount,
        });
      if (refunded.confirmation) refundConfirmations.push(refunded.confirmation);
    }

    const cancelledAnchor = await this.bookingById(tx, context, anchor.id);
    return {
      result:
        cancellationFailure ??
        (cancelledAnchor && this.toBooking(cancelledAnchor)
          ? { ok: true, value: this.toBooking(cancelledAnchor)! }
          : this.failure('BOOKING_NOT_FOUND', 'Booking could not be reloaded.')),
      refundConfirmations,
      cancelledBookingIds,
    };
  }

  private async applyMultiRoomCancellation(
    tx: TenantTransaction,
    context: PmsProviderContext,
    orderReference: string,
    row: BookingRow,
    cancellationPolicy: CancellationPolicy,
    staffActorId?: string,
  ): Promise<void> {
    if (
      !row.roomId &&
      (row.status === BookingStatus.PAYMENT_PENDING ||
        row.status === BookingStatus.PMS_CONFIRMATION_PENDING ||
        row.status === BookingStatus.CONFIRMED)
    ) {
      await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
        roomTypeId: row.roomTypeId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        units: 1,
      });
    }
    this.stateMachine.transition(row.status, BookingStatus.CANCELLED);
    await tx.$executeRaw`
      UPDATE bookings
      SET status = ${BookingStatus.CANCELLED}::"BookingStatus",
          cancellation_is_free = ${cancellationPolicy.isFree},
          cancellation_free_until_hours = ${cancellationPolicy.freeCancellationUntilHours},
          cancellation_cutoff_at = ${cancellationPolicy.cutoffAt}::timestamptz,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${row.id}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid AND version = ${row.version}
    `;
    const booking = this.toBooking(row);
    await this.audit.recordInTransaction(tx, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      actorUserId: staffActorId ?? null,
      action: 'booking.cancelled',
      targetType: 'booking',
      targetId: row.id,
      details: {
        guestId: booking?.guestId ?? null,
        cancellation: {
          isFree: cancellationPolicy.isFree,
          freeCancellationUntilHours: cancellationPolicy.freeCancellationUntilHours,
          cutoffAt: cancellationPolicy.cutoffAt?.toISOString() ?? null,
        },
        orderReference,
      },
    });
  }

  private async selfServiceCancellationAllowed(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ canCancel: boolean }>>`
      SELECT CASE WHEN b.cancellation_terms IS NOT NULL THEN
        b.cancellation_terms->>'arrivalDate'=b.starts_on::text AND CURRENT_TIMESTAMP <= (b.cancellation_terms->>'cutoffAt')::timestamptz
        ELSE CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)
        - make_interval(days => p.free_cancellation_days_before_arrival) END AS "canCancel"
      FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
      WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
    `;
    return rows[0]?.canCancel !== false;
  }

  private multiRoomCancellationFailure(
    code: string,
    message: string,
    retryable = false,
  ): MultiRoomCancellation {
    return {
      result: this.failure(code, message, retryable),
      refundConfirmations: [],
      cancelledBookingIds: [],
    };
  }

  /** A failed gateway refund must not undo an eligible cancellation. The
   * original charge remains the staff team's responsibility, so record the
   * exact outcome once in the same transaction as the local cancellation. */
  private async recordAutomaticRefundFailure(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    error: { code: string; message: string; retryable: boolean },
    details: { orderReference?: string; amount?: Money } = {},
  ): Promise<void> {
    await this.manualReview.recordInTransaction(tx, {
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      category: 'UNKNOWN_RESULT',
      referenceType: 'booking',
      referenceId: bookingId,
      message: `Automatic cancellation refund needs manual action: ${error.message}`,
      context: {
        kind: 'CANCELLATION_REFUND_NEEDS_ACTION',
        automaticRefund: true,
        errorCode: error.code,
        retryable: error.retryable,
        ...details,
      },
    });
  }

  private async withIdempotency(
    tx: TenantTransaction,
    context: PmsProviderContext,
    idempotencyKey: string,
    request: object,
    aggregateId: string | null,
    externalReference: string | null,
    execute: () => Promise<Result<BookingWithCheckout>>,
  ): Promise<Result<BookingWithCheckout>> {
    if (!idempotencyKey.trim())
      return this.failure('IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
    const requestHash = this.requestHash(request);
    const inserted = await tx.$queryRaw<Array<{ requestHash: string }>>`
      INSERT INTO integration_operations (
        tenant_id, property_id, idempotency_key, aggregate_id, external_reference,
        request_hash, status
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${idempotencyKey},
        ${aggregateId}::uuid, ${externalReference}, ${requestHash}, 'PENDING'
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING request_hash AS "requestHash"
    `;
    if (!inserted[0]) {
      const rows = await tx.$queryRaw<IntegrationOperationRow[]>`
        SELECT request_hash AS "requestHash", result
        FROM integration_operations
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND idempotency_key = ${idempotencyKey}
        FOR UPDATE
      `;
      const operation = rows[0];
      if (!operation || operation.requestHash !== requestHash)
        return this.failure(
          'IDEMPOTENCY_KEY_CONFLICT',
          'This idempotency key was already used with a different request.',
        );
      await tx.$executeRaw`
        UPDATE integration_operations SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${context.tenantId}::uuid AND idempotency_key = ${idempotencyKey}
      `;
      return (
        operation.result ??
        this.failure('IDEMPOTENCY_IN_PROGRESS', 'Operation is in progress.', true)
      );
    }

    const result = await execute();
    let externalEntityId = result.ok ? result.value.id : aggregateId;
    if (!externalEntityId && externalReference) {
      const booking = await this.bookingByReference(tx, context, externalReference);
      externalEntityId = booking?.id ?? null;
    }
    await tx.$executeRaw`
      UPDATE integration_operations
      SET status = ${result.ok ? 'SUCCEEDED' : 'FAILED'}, external_entity_id = ${externalEntityId}::uuid,
          result = ${JSON.stringify(result)}::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND idempotency_key = ${idempotencyKey}
    `;
    return result;
  }

  private requestHash(request: object): string {
    const normalizedRequest = { ...(request as Record<string, unknown>) };
    delete normalizedRequest.idempotencyKey;
    return createHash('sha256').update(this.stableJson(normalizedRequest)).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`)
      .join(',')}}`;
  }

  /** The auto-created rate plan (Task confirm-time) backing a Clock-mapped
   * room type — resolves what createBooking uses in place of a staff-picked
   * ratePlanId. Returns null for a non-Clock room type or property. */
  private async clockShadowRatePlanId(
    tx: TenantTransaction,
    context: PmsProviderContext,
    roomTypeId: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rate_plans
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND clock_shadow_room_type_id = ${roomTypeId}::uuid
    `;
    return rows[0]?.id ?? null;
  }

  /** Generated exactly once per booking, inside the idempotency-gated section of
   * createBooking() — a retry with the same idempotencyKey never re-executes this,
   * so a fresh random suffix here can never desync from what withIdempotency hashed. */
  private async generatedExternalReference(
    tx: TenantTransaction,
    context: PmsProviderContext,
  ): Promise<string> {
    const properties = await tx.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM properties
      WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    return generateBookingReference(properties[0]?.name ?? '');
  }

  private async validateCatalog(
    tx: TenantTransaction,
    context: PmsProviderContext,
    roomTypeId: string,
    ratePlanId: string,
    totalCurrency: string,
  ): Promise<Result<Booking> | string> {
    const roomTypes = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types
      WHERE id = ${roomTypeId}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid AND status = 'PUBLISHED'::"RoomTypeStatus"
    `;
    if (!roomTypes[0]) return this.failure('ROOM_TYPE_NOT_FOUND', 'Room type was not found.');
    // Returns the plan the booking is stored under: the chosen plan, or for a Clock rate that Clock sells in
    // another currency, the plan billed in that currency (see resolveBillingRatePlan).
    const billing = await resolveBillingRatePlan(tx, context, ratePlanId, totalCurrency);
    if (billing.ok) return billing.ratePlanId;
    return billing.reason === 'RATE_PLAN_NOT_FOUND'
      ? this.failure('RATE_PLAN_NOT_FOUND', 'Active rate plan was not found.')
      : this.failure(
          'CURRENCY_MISMATCH',
          'Booking total currency must match the rate plan currency.',
        );
  }

  private async validateRoomSelection(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<RoomSelection | Result<Booking>> {
    const properties = await tx.$queryRaw<Array<{ bookingMode: string }>>`
      SELECT booking_mode AS "bookingMode"
      FROM properties
      WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    const property = properties[0];
    if (!property) return this.failure('PROPERTY_NOT_FOUND', 'Property was not found.');
    if (property.bookingMode === 'ROOM_TYPE_ONLY' && command.roomId)
      return this.failure(
        'ROOM_ID_NOT_ALLOWED',
        'A specific room cannot be selected for a room-type-only property.',
      );
    if (property.bookingMode === 'INDIVIDUAL_ROOM_ONLY' && !command.roomId)
      return this.failure(
        'ROOM_ID_REQUIRED',
        'A specific room is required for an individual-room-only property.',
      );
    if (!command.roomId) return { autoAssign: property.bookingMode === 'MIXED' };

    const rooms = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM rooms
      WHERE tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
        AND id = ${command.roomId}::uuid
        AND room_type_id = ${command.roomTypeId}::uuid
        AND is_active = true
    `;
    return rooms[0]
      ? { autoAssign: false }
      : this.failure('ROOM_NOT_FOUND', 'Room was not found for the requested room type.');
  }

  private async reserveSamePricedRoom(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<{ roomId: string | null; reason?: 'held' | 'price_changed' | 'unavailable' }> {
    const occupancy = resolveBookingOccupancy(command);
    const rooms = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM rooms
      WHERE tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
        AND room_type_id = ${command.roomTypeId}::uuid
        AND is_active = true
      ORDER BY created_at
    `;
    let matchedPrice = false;
    let held = false;
    for (const room of rooms) {
      const price = await this.quotes.price(
        context.tenantId,
        context.propertyId,
        {
          roomTypeId: command.roomTypeId,
          roomId: room.id,
          ratePlanId: command.ratePlanId,
          // The room must cost the same under the rate the guest chose, not the default rate.
          clockRateId: command.clockRateId,
          promoCode: command.promoCode,
          startsOn: command.startsOn,
          endsOn: command.endsOn,
          adults: occupancy.adults,
          children: occupancy.children,
          childrenAges: command.childrenAges,
          guestCount: occupancy.guestCount,
        },
        // The same override the staff member used for the booking: the room is re-priced under the same limits.
        { overrideRules: Boolean(command.staffActorId && command.ruleOverrideReason) },
      );
      if (
        this.minorUnits(price.amount) !== this.minorUnits(command.total.amount) ||
        price.currency !== command.total.currency
      )
        continue;
      matchedPrice = true;
      const reserved = await this.availability.reserveRoom(
        tx,
        context.tenantId,
        context.propertyId,
        {
          roomId: room.id,
          startsOn: command.startsOn,
          endsOn: command.endsOn,
        },
      );
      if (reserved) return { roomId: room.id };
      const pending = await tx.$queryRaw<Array<{ held: boolean }>>`
        SELECT EXISTS(SELECT 1 FROM bookings WHERE tenant_id=${context.tenantId}::uuid
          AND property_id=${context.propertyId}::uuid AND room_id=${room.id}::uuid
          AND starts_on<${command.endsOn}::date AND ends_on>${command.startsOn}::date
          AND status='PAYMENT_PENDING' AND external_booking_id IS NULL) AS held`;
      held ||= pending[0]?.held === true;
    }
    return {
      roomId: null,
      reason: held ? 'held' : rooms.length && !matchedPrice ? 'price_changed' : 'unavailable',
    };
  }

  private async checkoutExpiry(
    tx: TenantTransaction,
    context: PmsProviderContext,
    row: BookingRow,
  ): Promise<string> {
    const settings = await tx.$queryRaw<Array<{ minutes: number }>>`
      SELECT online_payment_hold_minutes AS minutes FROM properties
      WHERE tenant_id=${context.tenantId}::uuid AND id=${context.propertyId}::uuid`;
    return new Date(row.createdAt.getTime() + (settings[0]?.minutes ?? 30) * 60000).toISOString();
  }

  /** An idempotent replay restores the original checkout, but must not revive an expired or paid hold. */
  private async currentCheckout(
    tx: TenantTransaction,
    context: PmsProviderContext,
    result: Result<BookingWithCheckout>,
  ): Promise<Result<BookingWithCheckout>> {
    if (
      !result.ok ||
      !result.value.checkoutUrl ||
      result.value.status !== BookingStatus.PAYMENT_PENDING
    )
      return result;
    const row = await this.bookingById(tx, context, result.value.id);
    if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
    if (row.status !== BookingStatus.PAYMENT_PENDING) {
      const booking = this.toBooking(row);
      return booking &&
        [
          BookingStatus.CONFIRMED,
          BookingStatus.PMS_CREATION_PENDING,
          BookingStatus.PMS_CONFIRMATION_PENDING,
          BookingStatus.PMS_UNKNOWN_RESULT,
          BookingStatus.MANUAL_REVIEW,
        ].includes(row.status)
        ? { ok: true, value: booking }
        : this.failure(
            'CHECKOUT_EXPIRED',
            'This checkout is no longer active. Please check availability and start again.',
          );
    }
    const checkoutExpiresAt = await this.checkoutExpiry(tx, context, row);
    if (Date.now() >= Date.parse(checkoutExpiresAt))
      return this.failure(
        'CHECKOUT_EXPIRED',
        'The payment time has ended. Please check the booking status before starting again.',
      );
    return { ok: true, value: { ...result.value, checkoutExpiresAt } };
  }

  private async cancellationPolicy(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
  ): Promise<CancellationPolicy> {
    const saved = await tx.$queryRaw<
      Array<{
        terms: {
          arrivalDate: string;
          cutoffAt: string;
          freeCancellationUntilHours: number;
          autoRefund: boolean;
        } | null;
        arrival: string;
        external: string | null;
        clock: boolean;
      }>
    >`SELECT b.cancellation_terms AS terms,b.starts_on::text AS arrival,b.external_booking_id AS external,EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id WHERE pc.tenant_id=b.tenant_id AND pc.property_id=b.property_id AND pc.enabled AND pc.kind='PMS' AND ic.provider='CLOCK_PMS') AS clock FROM bookings b WHERE b.tenant_id=${context.tenantId}::uuid AND b.property_id=${context.propertyId}::uuid AND b.id=${bookingId}::uuid`;
    if (saved[0]?.terms) {
      const terms = saved[0].terms;
      const cutoffAt = new Date(terms.cutoffAt);
      return {
        freeCancellationUntilHours: terms.freeCancellationUntilHours,
        cutoffAt,
        isFree: terms.arrivalDate === saved[0].arrival && Date.now() <= cutoffAt.valueOf(),
        autoRefund: terms.autoRefund,
      };
    }
    if (saved[0]?.clock || saved[0]?.external)
      return { freeCancellationUntilHours: null, cutoffAt: null, isFree: false, autoRefund: false };
    const rows = await tx.$queryRaw<
      Array<{
        freeCancellationUntilHours: number | null;
        cutoffAt: Date | null;
        isFree: boolean;
        autoRefund: boolean;
      }>
    >`
      SELECT p.auto_refund_on_free_cancellation AS "autoRefund", COALESCE(cp.free_cancellation_days_before_arrival * 24, rp.free_cancellation_until_hours) AS "freeCancellationUntilHours",
        CASE
          WHEN COALESCE(cp.free_cancellation_days_before_arrival * 24, rp.free_cancellation_until_hours) IS NULL THEN NULL
          ELSE (b.starts_on::timestamp AT TIME ZONE p.timezone)
            - make_interval(hours => COALESCE(cp.free_cancellation_days_before_arrival * 24, rp.free_cancellation_until_hours))
        END AS "cutoffAt",
        COALESCE(cp.free_cancellation_days_before_arrival * 24, rp.free_cancellation_until_hours) IS NOT NULL
          AND CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)
            - make_interval(hours => COALESCE(cp.free_cancellation_days_before_arrival * 24, rp.free_cancellation_until_hours)) AS "isFree"
      FROM bookings b
      JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      LEFT JOIN cancellation_policies cp
        ON cp.tenant_id = rp.tenant_id AND cp.property_id = rp.property_id AND cp.id = rp.cancellation_policy_id
      JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
      WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
      FOR UPDATE OF b, rp
    `;
    const policy = rows[0];
    if (!policy) return { freeCancellationUntilHours: null, cutoffAt: null, isFree: false };
    return policy;
  }

  private async resolveGuest(
    tx: TenantTransaction,
    tenantId: string,
    guest: CreateBookingCommand['guest'],
  ): Promise<Result<string>> {
    const email = guest.email.trim().toLowerCase();
    const firstName = guest.firstName?.trim() || null;
    const lastName = guest.lastName?.trim() || null;
    if (!email) return this.failure('INVALID_GUEST_EMAIL', 'Guest email is required.');
    const resolved = await resolveGuestWithPhoneSignal(tx, tenantId, guest, {
      onEmailMatch: async (guestId) => {
        await tx.$executeRaw`
          UPDATE guests
          SET first_name = CASE WHEN ${firstName !== null} THEN ${firstName} ELSE first_name END,
            last_name = CASE WHEN ${lastName !== null} THEN ${lastName} ELSE last_name END,
            street_address = CASE WHEN ${guest.streetAddress !== undefined} THEN ${guest.streetAddress ?? null} ELSE street_address END,
            address_line_2 = CASE WHEN ${guest.addressLine2 !== undefined} THEN ${guest.addressLine2 ?? null} ELSE address_line_2 END,
            city = CASE WHEN ${guest.city !== undefined} THEN ${guest.city ?? null} ELSE city END,
            county = CASE WHEN ${guest.county !== undefined} THEN ${guest.county ?? null} ELSE county END,
            postcode = CASE WHEN ${guest.postcode !== undefined} THEN ${guest.postcode ?? null} ELSE postcode END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${guestId}::uuid AND tenant_id = ${tenantId}::uuid
        `;
      },
      insertGuest: ({ email, phone, suspectedDuplicateOfGuestId }) => {
        const id = randomUUID();
        return tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO guests (
            id, tenant_id, email, first_name, last_name, phone, suspected_duplicate_of_guest_id,
            street_address, address_line_2, city, county, postcode
          ) VALUES (
            ${id}::uuid, ${tenantId}::uuid, ${email}, ${firstName}, ${lastName}, ${phone},
            ${suspectedDuplicateOfGuestId}::uuid, ${guest.streetAddress ?? null},
            ${guest.addressLine2 ?? null}, ${guest.city ?? null}, ${guest.county ?? null},
            ${guest.postcode ?? null}
          )
          ON CONFLICT (tenant_id, lower(email)) DO NOTHING
          RETURNING id
        `.then((rows) => rows[0]?.id ?? null);
      },
    });
    if (!resolved)
      return this.failure('GUEST_MATCH_FAILED', 'Guest matching could not be completed.', true);
    return { ok: true, value: resolved };
  }

  private async transition(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
    from: BookingStatus,
    to: BookingStatus,
  ): Promise<BookingStatus> {
    const status = this.stateMachine.transition(from, to);
    await tx.$executeRaw`
      UPDATE bookings
      SET status = ${status}::"BookingStatus",
        payment_pending_at = CASE WHEN ${status}::"BookingStatus" = 'PAYMENT_PENDING' THEN CURRENT_TIMESTAMP ELSE payment_pending_at END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
    `;
    if (bookingNeedsAttention(status)) {
      await this.notificationsService.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        type: 'BOOKING_NEEDS_ATTENTION',
        payload: { bookingId, from, status },
      });
    }
    // Staff hear about a booking once it is confirmed, not about an attempt that may never be paid.
    if (status === BookingStatus.CONFIRMED)
      await this.notificationsService.recordBookingConfirmedInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        bookingId,
      });
    return status;
  }

  private async bookingById(
    tx: TenantTransaction,
    context: PmsProviderContext,
    id: string,
  ): Promise<BookingRow | null> {
    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT b.id, b.tenant_id AS "tenantId", b.property_id AS "propertyId",
        b.room_type_id AS "roomTypeId", b.room_id AS "roomId", b.guest_id AS "guestId",
        b.guest_session_id AS "guestSessionId", b.guest_return_url AS "guestReturnUrl", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.payment_method AS "paymentMethod",
        b.total_amount::text AS "totalAmount", b.adults, b.children, b.children_ages AS "childrenAges", b.nightly_rates AS "nightlyRates",
        rp.currency, b.external_reference AS "externalReference", b.order_reference AS "orderReference",
        b.external_booking_id AS "externalBookingId",
        b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt",
        b.on_request_deadline_at AS "onRequestDeadlineAt", b.payment_pending_at AS "paymentPendingAt", b.payment_due_at AS "paymentDueAt",
        b.on_request_checkout_url AS "onRequestCheckoutUrl"
      FROM bookings b JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      WHERE b.id = ${id}::uuid AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async bookingByReference(
    tx: TenantTransaction,
    context: PmsProviderContext,
    reference: string,
  ): Promise<BookingRow | null> {
    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT b.id, b.tenant_id AS "tenantId", b.property_id AS "propertyId",
        b.room_type_id AS "roomTypeId", b.room_id AS "roomId", b.guest_id AS "guestId",
        b.guest_return_url AS "guestReturnUrl", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.payment_method AS "paymentMethod",
        b.total_amount::text AS "totalAmount", b.adults, b.children, b.children_ages AS "childrenAges", b.nightly_rates AS "nightlyRates",
        rp.currency, b.external_reference AS "externalReference", b.order_reference AS "orderReference",
        b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
      FROM bookings b JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      WHERE b.external_reference = ${reference} AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
    `;
    return rows[0] ?? null;
  }

  private async checkoutAmount(
    tx: TenantTransaction,
    context: PmsProviderContext,
    booking: BookingRow,
  ): Promise<string> {
    if (!booking.orderReference) return booking.totalAmount;
    const rows = await tx.$queryRaw<Array<{ totalAmount: string }>>`
      SELECT COALESCE(SUM(total_amount), 0)::text AS "totalAmount"
      FROM bookings
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND order_reference = ${booking.orderReference}
    `;
    return rows[0]?.totalAmount ?? booking.totalAmount;
  }

  private toBooking(row: BookingRow): (Booking & { onRequestDeadlineAt?: string }) | null {
    if (!row.guestId) return null;
    const nightlyRates = this.nightlyRates(row.nightlyRates);
    return {
      id: row.id,
      tenantId: row.tenantId,
      propertyId: row.propertyId,
      roomTypeId: row.roomTypeId,
      roomId: row.roomId,
      guestId: row.guestId,
      ratePlanId: row.ratePlanId,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status,
      ...(row.onRequestDeadlineAt
        ? { onRequestDeadlineAt: row.onRequestDeadlineAt.toISOString() }
        : {}),
      paymentMethod: row.paymentMethod,
      total: { amount: row.totalAmount, currency: row.currency },
      adults: row.adults,
      children: row.children,
      guestCount: row.adults + row.children,
      ...(nightlyRates ? { nightlyRates } : {}),
      externalReference: row.externalReference,
      externalBookingId: row.externalBookingId ?? row.id,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private nightlyRates(value: unknown): Array<{ date: string; amount: string }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const rates = value.filter(
      (rate): rate is { date: string; amount: string } =>
        !!rate &&
        typeof rate === 'object' &&
        typeof (rate as { date?: unknown }).date === 'string' &&
        typeof (rate as { amount?: unknown }).amount === 'string' &&
        /^\d+(?:\.\d{1,2})?$/.test((rate as { amount: string }).amount),
    );
    return rates.length === value.length ? rates : undefined;
  }

  private validStay(startsOn: string, endsOn: string): boolean {
    const start = new Date(`${startsOn}T00:00:00Z`);
    const end = new Date(`${endsOn}T00:00:00Z`);
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(startsOn) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endsOn) &&
      !Number.isNaN(start.valueOf()) &&
      !Number.isNaN(end.valueOf()) &&
      start.toISOString().slice(0, 10) === startsOn &&
      end.toISOString().slice(0, 10) === endsOn &&
      end > start
    );
  }

  private validAmount(amount: string): boolean {
    return /^\d+(?:\.\d{1,2})?$/.test(amount);
  }

  private validGuestCount(adults: number, children: number): boolean {
    return validBookingOccupancy({ adults, children });
  }

  private requiresCheckout(amount: string): boolean {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) > 0n;
  }

  private async paymentMethod(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<Result<BookingPaymentMethod>> {
    if (!this.requiresCheckout(command.total.amount))
      return { ok: true, value: BookingPaymentMethod.FREE };

    const selected = this.requestedPaymentMethod(command);
    if (!selected)
      return this.failure(
        'PAYMENT_METHOD_REQUIRED',
        'Select an enabled payment method before creating a non-zero-total booking.',
      );

    const available = await paymentMethodAvailability(tx, context);
    const enabled =
      (selected === 'stripe' && available.stripe) ||
      (selected === 'pokpay' && available.pokpay) ||
      (selected === 'pay_at_hotel' && available.payAtHotel);
    if (!enabled)
      return this.failure(
        'PAYMENT_METHOD_NOT_ENABLED',
        'The selected payment method is not enabled for this property.',
      );
    return {
      ok: true,
      value:
        selected === 'stripe'
          ? BookingPaymentMethod.STRIPE_CHECKOUT
          : selected === 'pokpay'
            ? BookingPaymentMethod.POKPAY
            : BookingPaymentMethod.PAY_AT_HOTEL,
    };
  }

  private requestedPaymentMethod(command: CreateBookingCommand): GuestPaymentMethod | null {
    const legacySelection =
      command.payAtHotel === undefined ? undefined : command.payAtHotel ? 'pay_at_hotel' : 'stripe';
    if (command.paymentMethod && legacySelection && command.paymentMethod !== legacySelection) {
      return null;
    }
    return command.paymentMethod ?? legacySelection ?? null;
  }

  private checkoutReturnUrl(
    bookingId: string,
    outcome: 'success' | 'cancel',
    returnUrl?: string | null,
    scope?: { tenantId: string; propertyId: string },
  ): string {
    if (!returnUrl) {
      const result = new URL(`/bookings/${bookingId}/payment/${outcome}`, process.env.WEB_APP_URL!);
      if (scope) {
        result.searchParams.set('tenantId', scope.tenantId);
        result.searchParams.set('propertyId', scope.propertyId);
      }
      return result.toString();
    }

    const candidate = new URL(returnUrl);
    candidate.searchParams.set('booking_id', bookingId);
    candidate.searchParams.set('outcome', outcome);
    return candidate.toString();
  }

  private async validatedGuestReturnUrl(
    tx: TenantTransaction,
    context: PmsProviderContext,
    returnUrl?: string,
  ): Promise<string | null> {
    if (!returnUrl) return null;
    let candidate: URL;
    try {
      candidate = new URL(returnUrl);
    } catch {
      throw new BadRequestException('returnUrl must be a valid URL.');
    }
    if (
      !['http:', 'https:'].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password ||
      candidate.hash
    )
      throw new BadRequestException(
        'returnUrl must be an http(s) URL without credentials or a fragment.',
      );

    const properties = await tx.$queryRaw<Array<{ publicWebsiteOrigin: string | null }>>`
      SELECT public_website_origin AS "publicWebsiteOrigin"
      FROM properties
      WHERE id = ${context.propertyId}::uuid AND tenant_id = ${context.tenantId}::uuid
    `;
    if (
      !properties[0]?.publicWebsiteOrigin ||
      candidate.origin !== properties[0].publicWebsiteOrigin
    )
      throw new BadRequestException('returnUrl must use the property public website origin.');

    return candidate.toString();
  }

  private minorUnits(amount: string): bigint {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }

  private money(minorUnits: bigint): string {
    return `${minorUnits / 100n}.${(minorUnits % 100n).toString().padStart(2, '0')}`;
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
