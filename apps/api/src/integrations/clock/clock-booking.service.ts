import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BookingPaymentMethod,
  BookingStatus,
  type Booking,
  type CancelBookingCommand,
  type CreateBookingCommand,
  type PmsProviderContext,
  type Result,
  type UpdateBookingCommand,
} from '@must/domain-contracts';

import { AuditLogService } from '../../tenancy/audit-log.service';
import {
  TenantDatabaseService,
  type TenantTransaction,
} from '../../tenancy/tenant-database.service';
import { NotificationsService } from '../../tenancy/notifications.service';
import { BookingStateMachine } from '../../booking/booking-state-machine';
import { bookingNeedsAttention } from '../../booking/booking-attention';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import { parseClockCredentials } from './clock-credentials';
import {
  classifyClockClientFailure,
  classifyClockHttpResponse,
  type ClockClassifiedError,
} from './clock-error-classification';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

// Confirmed against Clock's own public Postman docs (2026-08-04) — see
// docs/CLOCK_ENDPOINT_MATRIX.md. Live sandbox success responses were not
// observed (the demo account has no rate/availability configured for any
// room type, and the API user lacks the "Rate Availability Control
// Override" right), but the request contract itself and the 400
// rejection/500-stale-object shapes were reproduced for real.
interface ClockBookingResource {
  id: number;
  lock_version: number;
  status: string;
}

type BookingRow = {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  roomId: string | null;
  guestId: string | null;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  totalAmount: string;
  currency: string;
  externalReference: string;
  externalBookingId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type IntegrationOperationRow = { requestHash: string; result: Result<Booking> | null };

const STALE_OBJECT_MESSAGE = 'Attempted to update a stale object: Booking';

@Injectable()
export class ClockBookingService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(BookingStateMachine) private readonly stateMachine: BookingStateMachine,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
  ) {}

  async createBooking(
    context: PmsProviderContext,
    command: CreateBookingCommand,
  ): Promise<Result<Booking>> {
    if (
      !this.validStay(command.startsOn, command.endsOn) ||
      !this.validAmount(command.total.amount)
    )
      return this.failure('INVALID_BOOKING_COMMAND', 'Booking dates or total are invalid.');

    // Fetched outside the transaction below — IntegrationConnectionsService
    // opens its own tenant transaction internally, and nesting transactions
    // through TenantDatabaseService is not a supported pattern here.
    const connection = await this.credentials(context);
    if (!connection.ok) return connection;

    return this.database.withTenantTransaction(
      context,
      (tx) =>
        this.withIdempotency(tx, context, command.idempotencyKey, command, null, async () => {
          const externalRoomTypeId = await this.mappedExternalId(
            tx,
            context,
            'ROOM_TYPE',
            command.roomTypeId,
          );
          if (!externalRoomTypeId)
            return this.failure(
              'clock_configuration',
              'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
            );
          const externalRoomId = command.roomId
            ? await this.mappedExternalId(tx, context, 'ROOM', command.roomId)
            : null;

          const rate = await this.singleRatePlanId(connection.value);
          if (!rate.ok) return rate;

          const guestId = await this.resolveGuest(tx, context.tenantId, command.guest);

          const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO bookings (
            tenant_id, property_id, room_type_id, room_id, guest_id, external_reference,
            status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
          ) VALUES (
            ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${command.roomTypeId}::uuid,
            ${command.roomId ?? null}::uuid, ${guestId}::uuid, ${command.externalReference},
            ${BookingStatus.DRAFT}::"BookingStatus",
            ${this.paymentMethodOf(command)}::"BookingPaymentMethod",
            ${command.startsOn}::date, ${command.endsOn}::date, ${command.ratePlanId}::uuid,
            ${command.total.amount}::numeric
          )
          RETURNING id
        `;
          const bookingId = inserted[0]!.id;
          await this.audit.recordInTransaction(tx, {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            actorUserId: null,
            action: 'booking.created',
            targetType: 'booking',
            targetId: bookingId,
            details: { guestId, provider: 'CLOCK_PMS' },
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

          const response = await this.fetch<ClockBookingResource>(connection.value, {
            method: 'POST',
            path: '/bookings/',
            body: {
              booking: {
                arrival: command.startsOn,
                departure: command.endsOn,
                status: 'expected',
                arrival_room_type_id: Number(externalRoomTypeId),
                arrival_room_id: externalRoomId ? Number(externalRoomId) : null,
                rate_id: Number(rate.value),
                reference_number: command.externalReference,
                guest_e_mail: command.guest.email,
                guest_first_name: command.guest.firstName,
                guest_last_name: command.guest.lastName,
              },
            },
          });

          if (!response.ok) {
            // Section 18: a client-side timeout/network failure never means
            // "assume it failed" — Clock may have created it anyway. Look it
            // up by our own reference before giving up on the attempt.
            if (response.error.category === 'timeout' || response.error.category === 'network') {
              const linked = await this.linkIfClockHasIt(
                tx,
                context,
                connection.value,
                bookingId,
                command.externalReference,
              );
              if (linked) return { ok: true, value: linked };
              await this.transition(
                tx,
                context,
                bookingId,
                status,
                BookingStatus.PMS_UNKNOWN_RESULT,
              );
              return this.failure(
                response.error.code,
                response.error.message,
                response.error.retryable,
              );
            }
            await this.transition(tx, context, bookingId, status, BookingStatus.PMS_REJECTED);
            return this.failure(response.error.code, response.error.message, false);
          }

          await tx.$executeRaw`
          UPDATE bookings SET external_booking_id = ${String(response.value.id)}
          WHERE id = ${bookingId}::uuid
        `;
          status = await this.transition(
            tx,
            context,
            bookingId,
            status,
            BookingStatus.PMS_CONFIRMATION_PENDING,
          );
          await this.transition(tx, context, bookingId, status, BookingStatus.CONFIRMED);

          const row = await this.bookingById(tx, context, bookingId);
          return row && this.toBooking(row)
            ? { ok: true, value: this.toBooking(row)! }
            : this.failure('BOOKING_NOT_FOUND', 'Created booking could not be loaded.');
        }),
      // Rate-plan lookup + booking create + possible reconciliation lookup —
      // up to 3 real Clock calls inside this transaction.
      { timeoutMs: 45_000 },
    );
  }

  async updateBooking(
    context: PmsProviderContext,
    command: UpdateBookingCommand,
  ): Promise<Result<Booking>> {
    if (command.roomTypeId || command.ratePlanId || command.guest || command.total)
      return this.failure(
        'UNSUPPORTED_UPDATE',
        'Room, rate, guest, and price changes are not available yet.',
      );

    // Fetched outside the transaction below — see the note in createBooking.
    const connection = await this.credentials(context);

    return this.database.withTenantTransaction(
      context,
      (tx) =>
        this.withIdempotency(tx, context, command.idempotencyKey, command, null, async () => {
          const row = await this.bookingById(tx, context, command.bookingId);
          if (!row || !row.externalBookingId)
            return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (row.version !== command.expectedVersion)
            return this.failure(
              'VERSION_CONFLICT',
              'Booking has changed; reload it before updating.',
              true,
            );
          if (!command.startsOn && !command.endsOn) {
            const booking = this.toBooking(row);
            return booking
              ? { ok: true, value: booking }
              : this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          }

          if (!connection.ok) return connection;
          const current = await this.fetch<ClockBookingResource>(connection.value, {
            method: 'GET',
            path: `/bookings/${row.externalBookingId}`,
          });
          if (!current.ok) return this.failure(current.error.code, current.error.message);

          const response = await this.fetch<ClockBookingResource>(connection.value, {
            method: 'PUT',
            path: `/bookings/${row.externalBookingId}`,
            body: {
              booking: {
                arrival: command.startsOn ?? row.startsOn,
                departure: command.endsOn ?? row.endsOn,
                lock_version: current.value.lock_version,
              },
            },
          });
          if (!response.ok) return this.failure(response.error.code, response.error.message);

          await tx.$executeRaw`
          UPDATE bookings
          SET starts_on = ${command.startsOn ?? row.startsOn}::date,
              ends_on = ${command.endsOn ?? row.endsOn}::date,
              version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${row.id}::uuid AND tenant_id = ${context.tenantId}::uuid
            AND property_id = ${context.propertyId}::uuid AND version = ${command.expectedVersion}
        `;
          await this.audit.recordInTransaction(tx, {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            actorUserId: null,
            action: 'booking.updated',
            targetType: 'booking',
            targetId: row.id,
            details: { startsOn: command.startsOn, endsOn: command.endsOn },
          });
          const updated = await this.bookingById(tx, context, row.id);
          return updated && this.toBooking(updated)
            ? { ok: true, value: this.toBooking(updated)! }
            : this.failure('BOOKING_NOT_FOUND', 'Updated booking could not be loaded.');
        }),
      // GET current lock_version + PUT the update — 2 real Clock calls.
      { timeoutMs: 30_000 },
    );
  }

  async cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand,
  ): Promise<Result<Booking>> {
    // Fetched outside the transaction below — see the note in createBooking.
    const connection = await this.credentials(context);

    return this.database.withTenantTransaction(
      context,
      (tx) =>
        this.withIdempotency(tx, context, command.idempotencyKey, command, null, async () => {
          const row = await this.bookingById(tx, context, command.bookingId);
          if (!row) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (row.version !== command.expectedVersion)
            return this.failure(
              'VERSION_CONFLICT',
              'Booking has changed; reload it before cancelling.',
              true,
            );
          if (!this.stateMachine.canTransition(row.status, BookingStatus.CANCELLED))
            return this.failure(
              'INVALID_BOOKING_STATE',
              `Booking cannot be cancelled from ${row.status}.`,
            );

          if (row.externalBookingId) {
            if (!connection.ok) return connection;
            const current = await this.fetch<ClockBookingResource>(connection.value, {
              method: 'GET',
              path: `/bookings/${row.externalBookingId}`,
            });
            if (!current.ok) return this.failure(current.error.code, current.error.message);
            const response = await this.fetch<ClockBookingResource>(connection.value, {
              method: 'PUT',
              path: `/bookings/${row.externalBookingId}`,
              body: { booking: { status: 'canceled', lock_version: current.value.lock_version } },
            });
            if (!response.ok) return this.failure(response.error.code, response.error.message);
          }

          this.stateMachine.transition(row.status, BookingStatus.CANCELLED);
          await tx.$executeRaw`
          UPDATE bookings
          SET status = ${BookingStatus.CANCELLED}::"BookingStatus", version = version + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${row.id}::uuid AND tenant_id = ${context.tenantId}::uuid
            AND property_id = ${context.propertyId}::uuid AND version = ${command.expectedVersion}
        `;
          await this.audit.recordInTransaction(tx, {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            actorUserId: null,
            action: 'booking.cancelled',
            targetType: 'booking',
            targetId: row.id,
            details: { reason: command.reason },
          });
          const cancelled = await this.bookingById(tx, context, row.id);
          return cancelled && this.toBooking(cancelled)
            ? { ok: true, value: this.toBooking(cancelled)! }
            : this.failure('BOOKING_NOT_FOUND', 'Cancelled booking could not be loaded.');
        }),
      // GET current lock_version + PUT the cancellation — 2 real Clock calls.
      { timeoutMs: 30_000 },
    );
  }

  async getBooking(
    context: PmsProviderContext,
    externalBookingId: string,
  ): Promise<Booking | null> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<BookingRow[]>`
        SELECT b.id, b.tenant_id AS "tenantId", b.property_id AS "propertyId", b.room_type_id AS "roomTypeId",
          b.room_id AS "roomId", b.guest_id AS "guestId", b.rate_plan_id AS "ratePlanId",
          b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
          b.payment_method AS "paymentMethod", b.total_amount::text AS "totalAmount", rp.currency,
          b.external_reference AS "externalReference", b.external_booking_id AS "externalBookingId",
          b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
        FROM bookings b JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        WHERE b.external_booking_id = ${externalBookingId} AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      return rows[0] ? this.toBooking(rows[0]) : null;
    });
  }

  async findBookingByExternalReference(
    context: PmsProviderContext,
    reference: string,
  ): Promise<Booking | null> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const rows = await tx.$queryRaw<BookingRow[]>`
        SELECT b.id, b.tenant_id AS "tenantId", b.property_id AS "propertyId", b.room_type_id AS "roomTypeId",
          b.room_id AS "roomId", b.guest_id AS "guestId", b.rate_plan_id AS "ratePlanId",
          b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
          b.payment_method AS "paymentMethod", b.total_amount::text AS "totalAmount", rp.currency,
          b.external_reference AS "externalReference", b.external_booking_id AS "externalBookingId",
          b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
        FROM bookings b JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        WHERE b.external_reference = ${reference} AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      return rows[0] ? this.toBooking(rows[0]) : null;
    });
  }

  /** Section 18: after a creation timeout, search Clock itself (not just our
   * local row) for a booking carrying our reference — Clock may have
   * created it despite us never seeing the response. */
  private async linkIfClockHasIt(
    tx: TenantTransaction,
    context: PmsProviderContext,
    credentials: ClockConnectionCredentials,
    bookingId: string,
    reference: string,
  ): Promise<Booking | null> {
    const found = await this.fetch<ClockBookingResource[]>(credentials, {
      method: 'GET',
      path: '/bookings/',
      query: { reference_number: reference },
    });
    if (!found.ok || found.value.length === 0) return null;
    const match = found.value[0]!;
    await tx.$executeRaw`
      UPDATE bookings SET external_booking_id = ${String(match.id)} WHERE id = ${bookingId}::uuid
    `;
    await this.transition(
      tx,
      context,
      bookingId,
      BookingStatus.PMS_CREATION_PENDING,
      BookingStatus.PMS_CONFIRMATION_PENDING,
    );
    await this.transition(
      tx,
      context,
      bookingId,
      BookingStatus.PMS_CONFIRMATION_PENDING,
      BookingStatus.CONFIRMED,
    );
    const row = await this.bookingById(tx, context, bookingId);
    return row ? this.toBooking(row) : null;
  }

  private async credentials(
    context: PmsProviderContext,
  ): Promise<Result<ClockConnectionCredentials>> {
    const connection = await this.connections.activePmsConnectionCredentials(
      context.tenantId,
      context.propertyId,
    );
    if (!connection || connection.provider !== 'CLOCK_PMS')
      return this.failure(
        'clock_configuration',
        'This property has no active Clock PMS connection.',
      );
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) return this.failure('clock_configuration', parsed.message);
    return { ok: true, value: parsed.value };
  }

  private async mappedExternalId(
    tx: TenantTransaction,
    context: PmsProviderContext,
    entityType: 'ROOM_TYPE' | 'ROOM',
    localEntityId: string,
  ): Promise<string | null> {
    const rows = await tx.$queryRawUnsafe<Array<{ externalEntityId: string }>>(
      `SELECT external_entity_id AS "externalEntityId" FROM clock_catalog_mappings
       WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND entity_type = $3::"ClockCatalogEntityType"
         AND local_entity_id = $4::uuid AND sync_status = 'CONFIRMED'`,
      context.tenantId,
      context.propertyId,
      entityType,
      localEntityId,
    );
    return rows[0]?.externalEntityId ?? null;
  }

  /** Clock has no rate-plan catalog mapping yet (Task 7 only tracks room
   * types/rooms) — a "basic" milestone simplification: if the property's
   * Clock account has exactly one rate plan, use it; otherwise this is
   * genuinely ambiguous and reported as a clear configuration error rather
   * than guessing. Follow-up: extend the catalog mapping to RATE_PLAN. */
  private async singleRatePlanId(credentials: ClockConnectionCredentials): Promise<Result<string>> {
    const response = await this.fetch<Array<number | string>>(credentials, {
      method: 'GET',
      path: '/rate_plans',
    });
    if (!response.ok) return response;
    if (response.value.length !== 1)
      return this.failure(
        'clock_configuration',
        response.value.length === 0
          ? 'This Clock property has no rate plans configured yet.'
          : 'This Clock property has multiple rate plans — automatic rate selection is not supported yet.',
      );
    return { ok: true, value: String(response.value[0]) };
  }

  private async resolveGuest(
    tx: TenantTransaction,
    tenantId: string,
    guest: CreateBookingCommand['guest'],
  ): Promise<string> {
    const email = guest.email.trim().toLowerCase();
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM guests WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    if (existing[0]) return existing[0].id;
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO guests (tenant_id, email, first_name, last_name, phone)
      VALUES (${tenantId}::uuid, ${email}, ${guest.firstName}, ${guest.lastName}, ${guest.phone})
      ON CONFLICT (tenant_id, lower(email)) DO NOTHING
      RETURNING id
    `;
    if (inserted[0]) return inserted[0].id;
    const matched = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM guests WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    return matched[0]!.id;
  }

  private paymentMethodOf(command: CreateBookingCommand): BookingPaymentMethod {
    if (command.paymentMethod === 'stripe') return BookingPaymentMethod.STRIPE_CHECKOUT;
    if (command.paymentMethod === 'pokpay') return BookingPaymentMethod.POKPAY;
    if (command.paymentMethod === 'pay_at_hotel' || command.payAtHotel)
      return BookingPaymentMethod.PAY_AT_HOTEL;
    return BookingPaymentMethod.FREE;
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
      UPDATE bookings SET status = ${status}::"BookingStatus", updated_at = CURRENT_TIMESTAMP
      WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
    `;
    if (bookingNeedsAttention(status)) {
      await this.notifications.recordInTransaction(tx, {
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
      SELECT b.id, b.tenant_id AS "tenantId", b.property_id AS "propertyId", b.room_type_id AS "roomTypeId",
        b.room_id AS "roomId", b.guest_id AS "guestId", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.payment_method AS "paymentMethod", b.total_amount::text AS "totalAmount", rp.currency,
        b.external_reference AS "externalReference", b.external_booking_id AS "externalBookingId",
        b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
      FROM bookings b JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      WHERE b.id = ${id}::uuid AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private toBooking(row: BookingRow): Booking | null {
    if (!row.guestId) return null;
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
      externalReference: row.externalReference,
      externalBookingId: row.externalBookingId,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private validStay(startsOn: string, endsOn: string): boolean {
    const start = new Date(`${startsOn}T00:00:00Z`);
    const end = new Date(`${endsOn}T00:00:00Z`);
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(startsOn) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endsOn) &&
      !Number.isNaN(start.valueOf()) &&
      !Number.isNaN(end.valueOf()) &&
      end > start
    );
  }

  private validAmount(amount: string): boolean {
    return /^\d+(?:\.\d{1,2})?$/.test(amount);
  }

  private async withIdempotency(
    tx: TenantTransaction,
    context: PmsProviderContext,
    idempotencyKey: string,
    request: object,
    aggregateId: string | null,
    execute: () => Promise<Result<Booking>>,
  ): Promise<Result<Booking>> {
    if (!idempotencyKey.trim())
      return this.failure('IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
    const requestHash = this.requestHash(request);
    const inserted = await tx.$queryRaw<Array<{ requestHash: string }>>`
      INSERT INTO integration_operations (
        tenant_id, property_id, idempotency_key, aggregate_id, request_hash, status
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${idempotencyKey},
        ${aggregateId}::uuid, ${requestHash}, 'PENDING'
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
    const externalEntityId = result.ok ? result.value.id : aggregateId;
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
    const normalized = { ...(request as Record<string, unknown>) };
    delete normalized.idempotencyKey;
    return createHash('sha256').update(this.stableJson(normalized)).digest('hex');
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

  private async fetch<T>(
    credentials: ClockConnectionCredentials,
    options: {
      method: 'GET' | 'POST' | 'PUT';
      path: string;
      body?: unknown;
      query?: Record<string, string>;
    },
  ): Promise<ClockOutcome<T>> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError)
        return this.failureError({
          category: 'provider_unavailable',
          code: 'clock_provider_unavailable',
          message: error.message,
          retryable: true,
        });
      throw error;
    }

    const rateLimit = await this.rateLimiter.consume(credentials.apiUser);
    if (!rateLimit.allowed)
      return this.failureError({
        category: 'rate_limited',
        code: 'clock_rate_limited',
        message: `Too many Clock requests right now — try again in ${rateLimit.retryAfterSeconds}s.`,
        retryable: true,
      });

    try {
      const response = await this.client.request<T>(credentials, {
        api: 'pms_api',
        method: options.method,
        path: options.path,
        query: options.query,
        body: options.body,
        timeoutMs: 15_000,
      });
      if (response.status < 200 || response.status >= 300) {
        this.circuitBreaker.recordFailure(breakerKey);
        // Clock's documented optimistic-concurrency conflict is a plain
        // HTTP 500 with this exact message, not a 409 — must be special-
        // cased or it would otherwise be misclassified as a permanent error.
        if (
          response.status === 500 &&
          typeof response.body === 'object' &&
          response.body !== null &&
          'error' in response.body &&
          String((response.body as { error?: unknown }).error).includes(STALE_OBJECT_MESSAGE)
        ) {
          return this.failureError({
            category: 'conflict',
            code: 'clock_conflict',
            message: 'Clock booking has changed since it was last read; reload and retry.',
            retryable: true,
          });
        }
        return this.failureError(classifyClockHttpResponse(response.status, response.body));
      }
      this.circuitBreaker.recordSuccess(breakerKey);
      return { ok: true, value: response.body };
    } catch (error) {
      this.circuitBreaker.recordFailure(breakerKey);
      if (error instanceof ClockHttpError)
        return this.failureError(classifyClockClientFailure('network', error.message));
      throw error;
    }
  }

  private failureError(error: ClockClassifiedError): { ok: false; error: ClockClassifiedError } {
    return { ok: false, error };
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}

type ClockOutcome<T> = { ok: true; value: T } | { ok: false; error: ClockClassifiedError };
