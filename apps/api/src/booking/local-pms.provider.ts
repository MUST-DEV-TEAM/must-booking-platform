import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  type AvailabilityQuery,
  type AvailabilityResult,
  type Booking,
  BookingStatus,
  type CancelBookingCommand,
  type CatalogItem,
  type CreateBookingCommand,
  type Page,
  type PmsProvider,
  type PmsProviderContext,
  type Result,
  type UpdateBookingCommand,
} from '@must/domain-contracts';

import { AvailabilityService } from '../tenancy/availability.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { BookingStateMachine } from './booking-state-machine';
import { QuoteService } from './quote.service';

export const PMS_PROVIDER = Symbol('PMS_PROVIDER');

export type LocalCreateBookingCommand = CreateBookingCommand & {
  quoteToken?: string;
  quoteSessionId?: string;
};

type BookingRow = {
  id: string;
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  guestId: string | null;
  ratePlanId: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  totalAmount: string;
  currency: string;
  externalReference: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type IntegrationOperationRow = {
  requestHash: string;
  result: Result<Booking> | null;
};

type CancellationPolicy = {
  freeCancellationUntilHours: number | null;
  cutoffAt: Date | null;
  isFree: boolean;
};

@Injectable()
export class LocalPmsProvider implements PmsProvider {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BookingStateMachine) private readonly stateMachine: BookingStateMachine,
    @Inject(QuoteService) private readonly quotes: QuoteService,
  ) {}

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
    } catch {
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

  async createBooking(
    context: PmsProviderContext,
    command: LocalCreateBookingCommand,
  ): Promise<Result<Booking>> {
    if (
      !this.validStay(command.startsOn, command.endsOn) ||
      !this.validAmount(command.total.amount)
    ) {
      return this.failure('INVALID_BOOKING_COMMAND', 'Booking dates or total are invalid.');
    }

    return this.database.withTenantTransaction(context, async (tx) => {
      // Serialize the complete booking transaction before it obtains booking or guest row locks.
      // reserveBookedUnits takes this same transaction-scoped lock again before its range update.
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
        command.externalReference,
        async () => {
          const resolvedGuest = await this.resolveGuest(tx, context.tenantId, command.guest);
          if (!resolvedGuest.ok) return resolvedGuest;
          const guestId = resolvedGuest.value;
          const catalogError = await this.validateCatalog(
            tx,
            context,
            command.roomTypeId,
            command.ratePlanId,
            command.total.currency,
          );
          if (catalogError) return catalogError;

          const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO bookings (
          tenant_id, property_id, room_type_id, guest_id, external_reference,
          status, starts_on, ends_on, rate_plan_id, total_amount
        ) VALUES (
          ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${command.roomTypeId}::uuid,
          ${guestId}::uuid, ${command.externalReference}, ${BookingStatus.DRAFT}::"BookingStatus",
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
            details: { guestId },
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
          const quoteError = this.quotes.validate(command.quoteToken, command.quoteSessionId, {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            roomTypeId: command.roomTypeId,
            ratePlanId: command.ratePlanId,
            startsOn: command.startsOn,
            endsOn: command.endsOn,
            total: command.total,
          });
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

          const reserved = await this.availability.reserveBookedUnits(
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
              'Inventory is no longer available for the requested stay.',
            );
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
          return row && this.toBooking(row)
            ? { ok: true, value: this.toBooking(row)! }
            : this.failure('BOOKING_NOT_FOUND', 'Created booking could not be loaded.');
        },
      );
    });
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
          if (row.version !== command.expectedVersion)
            return this.failure(
              'VERSION_CONFLICT',
              'Booking has changed; reload it before updating.',
              true,
            );
          const booking = this.toBooking(row);
          if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (!command.total) return { ok: true, value: booking };
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

  async cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand,
  ): Promise<Result<Booking>> {
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
          if (row.version !== command.expectedVersion)
            return this.failure(
              'VERSION_CONFLICT',
              'Booking has changed; reload it before cancelling.',
              true,
            );
          const booking = this.toBooking(row);
          if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
          if (!this.stateMachine.canTransition(row.status, BookingStatus.CANCELLED))
            return this.failure(
              'INVALID_BOOKING_STATE',
              `Booking cannot be cancelled from ${row.status}.`,
            );

          if (
            row.status === BookingStatus.PMS_CONFIRMATION_PENDING ||
            row.status === BookingStatus.CONFIRMED
          ) {
            await this.availability.releaseBookedUnits(tx, context.tenantId, context.propertyId, {
              roomTypeId: row.roomTypeId,
              startsOn: row.startsOn,
              endsOn: row.endsOn,
              units: 1,
            });
          }
          const cancellationPolicy = await this.cancellationPolicy(tx, context, row.id);
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
            actorUserId: null,
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
          const cancelled = await this.bookingById(tx, context, row.id);
          return cancelled && this.toBooking(cancelled)
            ? { ok: true, value: this.toBooking(cancelled)! }
            : this.failure('BOOKING_NOT_FOUND', 'Cancelled booking could not be loaded.');
        },
      ),
    );
  }

  private async withIdempotency(
    tx: TenantTransaction,
    context: PmsProviderContext,
    idempotencyKey: string,
    request: object,
    aggregateId: string | null,
    externalReference: string | null,
    execute: () => Promise<Result<Booking>>,
  ): Promise<Result<Booking>> {
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
    if (!email) return this.failure('INVALID_GUEST_EMAIL', 'Guest email is required.');
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    if (existing[0]) return { ok: true, value: existing[0].id };

    const id = randomUUID();
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO guests (id, tenant_id, email, phone)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${email}, ${guest.phone})
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
    return status;
  }

  private async bookingById(
    tx: TenantTransaction,
    context: PmsProviderContext,
    id: string,
  ): Promise<BookingRow | null> {
    const rows = await tx.$queryRaw<BookingRow[]>`
      SELECT b.id, b.tenant_id AS "tenantId", b.property_id AS "propertyId",
        b.room_type_id AS "roomTypeId", b.guest_id AS "guestId", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.total_amount::text AS "totalAmount", rp.currency, b.external_reference AS "externalReference",
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
        b.room_type_id AS "roomTypeId", b.guest_id AS "guestId", b.rate_plan_id AS "ratePlanId",
        b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status,
        b.total_amount::text AS "totalAmount", rp.currency, b.external_reference AS "externalReference",
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
    return {
      id: row.id,
      tenantId: row.tenantId,
      propertyId: row.propertyId,
      roomTypeId: row.roomTypeId,
      guestId: row.guestId,
      ratePlanId: row.ratePlanId,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status,
      total: { amount: row.totalAmount, currency: row.currency },
      externalReference: row.externalReference,
      externalBookingId: row.id,
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
      start.toISOString().slice(0, 10) === startsOn &&
      end.toISOString().slice(0, 10) === endsOn &&
      end > start
    );
  }

  private validAmount(amount: string): boolean {
    return /^\d+(?:\.\d{1,2})?$/.test(amount);
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
