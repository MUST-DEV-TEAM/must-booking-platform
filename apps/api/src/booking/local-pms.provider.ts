import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
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
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { PaymentProviderRegistry } from '../payments/payment-provider-registry';
import { PaymentRefundService, type RefundConfirmation } from '../payments/payment-refund.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';
import { BookingCancellationNotificationService } from '../mail/booking-cancellation-notification.service';
import { BookingStateMachine } from './booking-state-machine';
import { bookingNeedsAttention } from './booking-attention';
import { QuoteService } from './quote.service';
import { NotificationsService } from '../tenancy/notifications.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { ManualReviewService } from '../integrations/manual-review.service';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { generateBookingReference } from './booking-reference';

export const PMS_PROVIDER = Symbol('PMS_PROVIDER');

export type LocalCreateBookingCommand = CreateBookingCommand & {
  quoteToken?: string;
  quoteSessionId?: string;
  staffActorId?: string;
  skipQuoteValidation?: boolean;
  returnUrl?: string;
};

type BookingRow = {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  roomId: string | null;
  guestId: string | null;
  guestSessionId: string | null;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  totalAmount: string;
  guestCount: number;
  currency: string;
  nightlyRates: unknown;
  externalReference: string;
  orderReference: string | null;
  externalBookingId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type IntegrationOperationRow = {
  requestHash: string;
  result: Result<BookingWithCheckout> | null;
};

type BookingWithCheckout = Booking & { checkoutUrl?: string };

class CheckoutSessionCreationError extends Error {
  constructor(readonly result: Result<never>) {
    super(result.ok ? 'Checkout session creation failed.' : result.error.message);
  }
}

type CancellationPolicy = {
  freeCancellationUntilHours: number | null;
  cutoffAt: Date | null;
  isFree: boolean;
};

type MultiRoomCancellation = {
  result: Result<Booking>;
  refundConfirmations: RefundConfirmation[];
  cancelledBookingIds: string[];
};

type RoomSelection = { autoAssign: boolean };

@Injectable()
export class LocalPmsProvider implements PmsProvider {
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
      return this.toBooking(row);
    });
  }

  async createBooking(
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<Result<BookingWithCheckout>> {
    if (
      !this.validStay(command.startsOn, command.endsOn) ||
      !this.validAmount(command.total.amount) ||
      !this.validGuestCount(command.guestCount) ||
      !(command.quoteSessionId ?? command.staffActorId)
    ) {
      return this.failure(
        'INVALID_BOOKING_COMMAND',
        'Booking dates, total, or guest count are invalid.',
      );
    }

    let payAtHotelConfirmationBookingId: string | null = null;
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
          return this.withIdempotency(
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
              const catalogError = await this.validateCatalog(
                tx,
                context,
                command.roomTypeId,
                ratePlanId,
                command.total.currency,
              );
              if (catalogError) return catalogError;
              const roomSelection = await this.validateRoomSelection(tx, context, command);
              if ('ok' in roomSelection) return roomSelection;
              const paymentMethod = await this.paymentMethod(tx, context, command);
              if (!paymentMethod.ok) return paymentMethod;
              const resolvedGuest = await this.resolveGuest(tx, context.tenantId, command.guest);
              if (!resolvedGuest.ok) return resolvedGuest;
              const guestId = resolvedGuest.value;
              const externalReference =
                command.externalReference ?? (await this.generatedExternalReference(tx, context));

              const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO bookings (
          tenant_id, property_id, room_type_id, room_id, guest_id, external_reference,
          guest_session_id, special_requests, status, payment_method, starts_on, ends_on, rate_plan_id, total_amount,
          guest_count
        ) VALUES (
          ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${command.roomTypeId}::uuid,
          ${command.roomId ?? null}::uuid, ${guestId}::uuid, ${externalReference},
          ${command.quoteSessionId ?? null}::uuid,
          ${command.guest.specialRequests?.trim() || null},
          ${BookingStatus.DRAFT}::"BookingStatus",
          ${paymentMethod.value}::"BookingPaymentMethod",
          ${command.startsOn}::date, ${command.endsOn}::date, ${ratePlanId}::uuid,
          ${command.total.amount}::numeric, ${command.guestCount ?? 1}
        )
        RETURNING id
      `;
              const bookingId = inserted[0]!.id;
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
                targetType: 'booking',
                targetId: bookingId,
                details: { guestId },
              });
              await this.notificationsService.recordInTransaction(tx, {
                tenantId: context.tenantId,
                propertyId: context.propertyId,
                type: 'BOOKING_CREATED',
                payload: { bookingId, guestId },
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
                    startsOn: command.startsOn,
                    endsOn: command.endsOn,
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
              const autoAssignedRoomId = roomSelection.autoAssign
                ? await this.reserveSamePricedRoom(tx, context, command)
                : null;
              if (roomSelection.autoAssign && !autoAssignedRoomId) {
                await this.transition(
                  tx,
                  context,
                  bookingId,
                  status,
                  BookingStatus.AVAILABILITY_FAILED,
                );
                return this.failure(
                  'AUTO_ASSIGNMENT_UNAVAILABLE',
                  'No available room matches the quoted price for the requested stay.',
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
                return this.failure(
                  'AVAILABILITY_FAILED',
                  (autoAssignedRoomId ?? command.roomId)
                    ? 'The selected room is no longer available for the requested stay.'
                    : 'Inventory is no longer available for the requested stay.',
                );
              }

              if (
                paymentMethod.value === BookingPaymentMethod.STRIPE_CHECKOUT ||
                paymentMethod.value === BookingPaymentMethod.POKPAY
              ) {
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
                  amount: command.total,
                  successUrl: this.checkoutReturnUrl(bookingId, 'success', guestReturnUrl),
                  cancelUrl: this.checkoutReturnUrl(bookingId, 'cancel', guestReturnUrl),
                });
                if (!checkout.ok) throw new CheckoutSessionCreationError(checkout);
                if (paymentMethod.value === BookingPaymentMethod.POKPAY) {
                  await tx.$executeRaw`
                  INSERT INTO payment_provider_sessions (
                    tenant_id, property_id, booking_id, provider, external_payment_id
                  ) VALUES (
                    ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid,
                    'pokpay', ${checkout.value.id}
                  )
                  ON CONFLICT (tenant_id, property_id, booking_id, provider) DO NOTHING
                `;
                }
                const row = await this.bookingById(tx, context, bookingId);
                const booking = row && this.toBooking(row);
                return booking
                  ? { ok: true, value: { ...booking, checkoutUrl: checkout.value.url } }
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
        },
        { timeoutMs: 30_000 },
      );
      if (payAtHotelConfirmationBookingId)
        await this.confirmations.sendAfterConfirmation(
          context,
          payAtHotelConfirmationBookingId,
          `pay-at-hotel:${payAtHotelConfirmationBookingId}`,
        );
      return result;
    } catch (error) {
      if (error instanceof CheckoutSessionCreationError) return error.result;
      throw error;
    }
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

  async continueAfterPayment(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
  ): Promise<Result<Booking>> {
    const row = await this.bookingById(tx, context, bookingId);
    if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
    if (row.orderReference) return this.continueMultiRoomOrderAfterPayment(tx, context, row);
    if (row.status !== BookingStatus.PAYMENT_PENDING) {
      return this.failure(
        'INVALID_BOOKING_STATE',
        `Booking cannot be confirmed from ${row.status}.`,
      );
    }

    let status = await this.transition(
      tx,
      context,
      bookingId,
      row.status,
      BookingStatus.PMS_CREATION_PENDING,
    );

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
          row.paymentMethod === BookingPaymentMethod.STRIPE_CHECKOUT ? 'Stripe' : 'PokPay',
          row.externalReference,
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
          row.paymentMethod === BookingPaymentMethod.STRIPE_CHECKOUT ? 'Stripe' : 'PokPay',
          row.externalReference,
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
  ): Promise<boolean> {
    const row = await this.bookingById(tx, context, bookingId);
    if (
      !row ||
      row.status !== BookingStatus.PAYMENT_PENDING ||
      row.createdAt.getTime() > cutoffAt.getTime()
    ) {
      return false;
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
    if (!row.roomId)
      await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
        roomTypeId: row.roomTypeId,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        units: 1,
      });
    await this.transition(tx, context, bookingId, row.status, BookingStatus.EXPIRED);
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

  async cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand,
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
            const row = await this.bookingById(tx, context, command.bookingId);
            if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
            if (!command.staffActorId && row.guestSessionId !== command.guestSessionId)
              return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
            if (row.version !== command.expectedVersion)
              return this.failure(
                'VERSION_CONFLICT',
                'Booking has changed; reload it before cancelling.',
                true,
              );
            if (row.orderReference) {
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
            SELECT CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)
              - make_interval(days => p.free_cancellation_days_before_arrival) AS "canCancel"
            FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
            WHERE b.id = ${row.id}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          `;
            if (selfServiceWindow[0]?.canCancel === false)
              return this.failure(
                'CANCELLATION_WINDOW_CLOSED',
                'This booking is too close to arrival to cancel online. Please contact the hotel directly.',
              );

            if (await this.isClockConnected(context)) {
              if (row.externalBookingId) {
                const cancelledAtClock = await this.clockBooking.cancelRealReservation(
                  context,
                  row.externalBookingId,
                );
                if (!cancelledAtClock.ok) return cancelledAtClock;
              }
            }

            const cancellationPolicy = await this.cancellationPolicy(tx, context, row.id);
            if (cancellationPolicy.isFree) {
              const refunded = await this.refunds.refundPaidChargeForBooking(
                tx,
                context,
                row.id,
                `cancellation-refund:${command.idempotencyKey}`,
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
          AND version = ${command.expectedVersion}
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
      await this.notifications.sendRefundConfirmationEmailSafely(refundConfirmation);
    for (const cancelledBookingId of cancelledBookingIds)
      await this.cancellations.sendAfterCancellation(context, cancelledBookingId);
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
      if (!cancellationPolicy.isFree) continue;
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
      SELECT CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)
        - make_interval(days => p.free_cancellation_days_before_arrival) AS "canCancel"
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
  ): Promise<Result<Booking> | null> {
    const roomTypes = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types
      WHERE id = ${roomTypeId}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
    `;
    if (!roomTypes[0]) return this.failure('ROOM_TYPE_NOT_FOUND', 'Room type was not found.');
    const ratePlans = await tx.$queryRaw<Array<{ id: string; currency: string }>>`
      SELECT id, currency FROM rate_plans
      WHERE id = ${ratePlanId}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid AND is_active = true
    `;
    if (!ratePlans[0])
      return this.failure('RATE_PLAN_NOT_FOUND', 'Active rate plan was not found.');
    return ratePlans[0].currency === totalCurrency
      ? null
      : this.failure(
          'CURRENCY_MISMATCH',
          'Booking total currency must match the rate plan currency.',
        );
  }

  private async validateRoomSelection(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: CreateBookingCommand,
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
    `;
    return rooms[0]
      ? { autoAssign: false }
      : this.failure('ROOM_NOT_FOUND', 'Room was not found for the requested room type.');
  }

  private async reserveSamePricedRoom(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: CreateBookingCommand,
  ): Promise<string | null> {
    const rooms = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM rooms
      WHERE tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
        AND room_type_id = ${command.roomTypeId}::uuid
      ORDER BY created_at
    `;
    for (const room of rooms) {
      const price = await this.quotes.price(context.tenantId, context.propertyId, {
        roomTypeId: command.roomTypeId,
        roomId: room.id,
        ratePlanId: command.ratePlanId,
        startsOn: command.startsOn,
        endsOn: command.endsOn,
      });
      if (price.amount !== command.total.amount || price.currency !== command.total.currency)
        continue;
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
      if (reserved) return room.id;
    }
    return null;
  }

  private async cancellationPolicy(
    tx: TenantTransaction,
    context: PmsProviderContext,
    bookingId: string,
  ): Promise<CancellationPolicy> {
    const rows = await tx.$queryRaw<
      Array<{
        freeCancellationUntilHours: number | null;
        cutoffAt: Date | null;
        isFree: boolean;
      }>
    >`
      SELECT rp.free_cancellation_until_hours AS "freeCancellationUntilHours",
        CASE
          WHEN rp.free_cancellation_until_hours IS NULL THEN NULL
          ELSE (b.starts_on::timestamp AT TIME ZONE p.timezone)
            - make_interval(hours => rp.free_cancellation_until_hours)
        END AS "cutoffAt",
        rp.free_cancellation_until_hours IS NOT NULL
          AND CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)
            - make_interval(hours => rp.free_cancellation_until_hours) AS "isFree"
      FROM bookings b
      JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
      WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
      FOR UPDATE
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
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    if (existing[0]) {
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
        WHERE id = ${existing[0].id}::uuid AND tenant_id = ${tenantId}::uuid
      `;
      return { ok: true, value: existing[0].id };
    }

    const id = randomUUID();
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO guests (
        id, tenant_id, email, first_name, last_name, phone, street_address, address_line_2, city, county, postcode
      ) VALUES (
        ${id}::uuid, ${tenantId}::uuid, ${email}, ${firstName}, ${lastName}, ${guest.phone},
        ${guest.streetAddress ?? null}, ${guest.addressLine2 ?? null}, ${guest.city ?? null},
        ${guest.county ?? null}, ${guest.postcode ?? null}
      )
      ON CONFLICT (tenant_id, lower(email)) DO NOTHING
      RETURNING id
    `;
    if (inserted[0]) return { ok: true, value: inserted[0].id };
    const matched = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    if (!matched[0])
      return this.failure('GUEST_MATCH_FAILED', 'Guest matching could not be completed.', true);
    return { ok: true, value: matched[0].id };
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
      SET status = ${status}::"BookingStatus", updated_at = CURRENT_TIMESTAMP
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
        b.guest_session_id AS "guestSessionId", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.payment_method AS "paymentMethod",
        b.total_amount::text AS "totalAmount", b.guest_count AS "guestCount", b.nightly_rates AS "nightlyRates",
        rp.currency, b.external_reference AS "externalReference", b.order_reference AS "orderReference",
        b.external_booking_id AS "externalBookingId",
        b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
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
        b.room_type_id AS "roomTypeId", b.room_id AS "roomId", b.guest_id AS "guestId", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.payment_method AS "paymentMethod",
        b.total_amount::text AS "totalAmount", b.guest_count AS "guestCount", b.nightly_rates AS "nightlyRates",
        rp.currency, b.external_reference AS "externalReference", b.order_reference AS "orderReference",
        b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
      FROM bookings b JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      WHERE b.external_reference = ${reference} AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
    `;
    return rows[0] ?? null;
  }

  private toBooking(row: BookingRow): Booking | null {
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
      paymentMethod: row.paymentMethod,
      total: { amount: row.totalAmount, currency: row.currency },
      guestCount: row.guestCount,
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

  private validGuestCount(value: number | undefined): boolean {
    return value === undefined || (Number.isInteger(value) && value > 0);
  }

  private requiresCheckout(amount: string): boolean {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) > 0n;
  }

  private async paymentMethod(
    tx: TenantTransaction,
    context: PmsProviderContext,
    command: CreateBookingCommand,
  ): Promise<Result<BookingPaymentMethod>> {
    if (!this.requiresCheckout(command.total.amount))
      return { ok: true, value: BookingPaymentMethod.FREE };

    const selected = this.requestedPaymentMethod(command);
    if (!selected)
      return this.failure(
        'PAYMENT_METHOD_REQUIRED',
        'Select an enabled payment method before creating a non-zero-total booking.',
      );

    const properties = await tx.$queryRaw<
      Array<{ stripeEnabled: boolean; pokpayEnabled: boolean; payAtHotelEnabled: boolean }>
    >`
      SELECT stripe_enabled AS "stripeEnabled", pokpay_enabled AS "pokpayEnabled",
        pay_at_hotel_enabled AS "payAtHotelEnabled"
      FROM properties
      WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.propertyId}::uuid
    `;
    const property = properties[0];
    const enabled =
      (selected === 'stripe' && property?.stripeEnabled) ||
      (selected === 'pokpay' && property?.pokpayEnabled) ||
      (selected === 'pay_at_hotel' && property?.payAtHotelEnabled);
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
  ): string {
    if (!returnUrl)
      return new URL(
        `/bookings/${bookingId}/payment/${outcome}`,
        process.env.WEB_APP_URL!,
      ).toString();

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
