import { Inject, Injectable } from '@nestjs/common';
import {
  BookingPaymentMethod,
  BookingStatus,
  type CreateBookingCommand,
  type GuestPaymentMethod,
  type Money,
  type Result,
} from '@must/domain-contracts';
import { createHash, randomUUID } from 'node:crypto';

import { AvailabilityService } from '../tenancy/availability.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { PaymentProviderRegistry } from '../payments/payment-provider-registry';
import { QuoteService } from './quote.service';

type RoomGuestName = Pick<CreateBookingCommand['guest'], 'firstName' | 'lastName'>;

export type MultiRoomBookingCommand = {
  idempotencyKey: string;
  externalReference?: string;
  startsOn: string;
  endsOn: string;
  guest: CreateBookingCommand['guest'];
  paymentMethod?: GuestPaymentMethod;
  quoteSessionId: string;
  rooms: Array<{
    roomTypeId: string;
    roomId?: string;
    ratePlanId: string;
    total: Money;
    guestCount?: number;
    quoteToken: string;
    guest?: RoomGuestName;
  }>;
};

export type MultiRoomOrder = {
  orderReference: string;
  checkoutUrl?: string;
  bookings: Array<{
    id: string;
    externalReference: string;
    status: BookingStatus;
    total: Money;
  }>;
};

type GuestRow = { id: string };
type OperationRow = { requestHash: string; result: Result<MultiRoomOrder> | null };

class MultiRoomAvailabilityError extends Error {}

/**
 * Milestone 12 Task 14 local half of the multi-room flow.  This service deliberately
 * owns no provider calls: every requested room is validated and held in the one tenant
 * transaction before a later payment/Clock step is allowed to run.
 */
@Injectable()
export class MultiRoomBookingService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(PaymentProviderRegistry) private readonly paymentProviders: PaymentProviderRegistry,
  ) {}

  async create(
    context: { tenantId: string; propertyId: string },
    command: MultiRoomBookingCommand,
  ): Promise<Result<MultiRoomOrder>> {
    const invalid = this.validateCommand(command);
    if (invalid) return invalid;

    try {
      return await this.database.withTenantTransaction(
        context,
        async (tx) => {
          await this.lockInventory(tx, context, command.rooms);
          return this.withIdempotency(tx, context, command, async () => {
            const paymentMethod = await this.paymentMethod(
              tx,
              context,
              command.paymentMethod,
              command.rooms,
            );
            if (!paymentMethod.ok) return paymentMethod;

            for (const room of command.rooms) {
              const quoteError = this.quotes.validate(room.quoteToken, command.quoteSessionId, {
                tenantId: context.tenantId,
                propertyId: context.propertyId,
                roomTypeId: room.roomTypeId,
                roomId: room.roomId,
                ratePlanId: room.ratePlanId,
                startsOn: command.startsOn,
                endsOn: command.endsOn,
                total: room.total,
              });
              if (quoteError) return this.failure(quoteError.code, quoteError.message);
              if (!this.quotes.nightlyRates(room.quoteToken))
                return this.failure(
                  'QUOTE_INVALID',
                  'The quote does not contain a price for every night. Please request a new quote.',
                );
              if (!(await this.validCatalog(tx, context, room)))
                return this.failure(
                  'CATALOG_MISMATCH',
                  'A requested room type or rate plan is no longer available.',
                );
            }

            const guest = await this.resolveGuest(tx, context.tenantId, command.guest);
            if (!guest.ok) return guest;

            // Reserve every target before inserting any booking. A false return throws so the
            // transaction rolls back all earlier holds as well as all provisional rows.
            await this.reserveAll(tx, context, command);

            const orderReference = command.externalReference ?? `must-order-${randomUUID()}`;
            const status =
              paymentMethod.value === BookingPaymentMethod.STRIPE_CHECKOUT ||
              paymentMethod.value === BookingPaymentMethod.POKPAY
                ? BookingStatus.PAYMENT_PENDING
                : BookingStatus.CONFIRMED;
            const bookings: MultiRoomOrder['bookings'] = [];
            for (const [index, room] of command.rooms.entries()) {
              const externalReference = `${orderReference}-room${index + 1}`;
              const nightlyRates = this.quotes.nightlyRates(room.quoteToken)!;
              const roomGuest = room.guest ?? command.guest;
              const inserted = await tx.$queryRaw<Array<{ id: string }>>`
                INSERT INTO bookings (
                  tenant_id, property_id, room_type_id, room_id, guest_id, guest_session_id,
                  external_reference, order_reference, order_room_number,
                  room_guest_first_name, room_guest_last_name, status, payment_method,
                  starts_on, ends_on, rate_plan_id, total_amount, guest_count, nightly_rates
                ) VALUES (
                  ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${room.roomTypeId}::uuid,
                  ${room.roomId ?? null}::uuid, ${guest.value}::uuid, ${command.quoteSessionId}::uuid,
                  ${externalReference}, ${orderReference}, ${index + 1},
                  ${roomGuest.firstName?.trim() || null}, ${roomGuest.lastName?.trim() || null},
                  ${status}::"BookingStatus", ${paymentMethod.value}::"BookingPaymentMethod",
                  ${command.startsOn}::date, ${command.endsOn}::date, ${room.ratePlanId}::uuid,
                  ${room.total.amount}::numeric, ${room.guestCount ?? 1}, ${JSON.stringify(nightlyRates)}::jsonb
                )
                RETURNING id
              `;
              bookings.push({ id: inserted[0]!.id, externalReference, status, total: room.total });
            }
            if (
              paymentMethod.value === BookingPaymentMethod.STRIPE_CHECKOUT ||
              paymentMethod.value === BookingPaymentMethod.POKPAY
            ) {
              const provider = this.paymentProviders.forBookingMethod(paymentMethod.value);
              if (!provider)
                return this.failure(
                  'PAYMENT_PROVIDER_NOT_AVAILABLE',
                  'Payment provider is unavailable.',
                );
              const amount = this.total(bookings.map((booking) => booking.total));
              const checkout = await provider.createCheckoutSession(context, {
                idempotencyKey: command.idempotencyKey,
                bookingId: bookings[0]!.id,
                amount,
                successUrl: this.checkoutReturnUrl(bookings[0]!.id, 'success'),
                cancelUrl: this.checkoutReturnUrl(bookings[0]!.id, 'cancel'),
              });
              if (!checkout.ok) return checkout;
              if (paymentMethod.value === BookingPaymentMethod.POKPAY)
                await tx.$executeRaw`
                  INSERT INTO payment_provider_sessions (
                    tenant_id, property_id, booking_id, provider, external_payment_id
                  ) VALUES (
                    ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookings[0]!.id}::uuid,
                    'pokpay', ${checkout.value.id}
                  )
                  ON CONFLICT (tenant_id, property_id, booking_id, provider) DO NOTHING
                `;
              return {
                ok: true,
                value: { orderReference, bookings, checkoutUrl: checkout.value.url },
              };
            }
            return { ok: true, value: { orderReference, bookings } };
          });
        },
        { timeoutMs: 30_000 },
      );
    } catch (error) {
      if (error instanceof MultiRoomAvailabilityError)
        return this.failure(
          'AVAILABILITY_FAILED',
          'One or more requested rooms are no longer available; no rooms were held.',
        );
      throw error;
    }
  }

  private validateCommand(command: MultiRoomBookingCommand): Result<never> | null {
    if (
      !command.idempotencyKey ||
      !command.quoteSessionId ||
      !this.validDateRange(command.startsOn, command.endsOn)
    )
      return this.failure('INVALID_BOOKING_COMMAND', 'Booking dates or session are invalid.');
    if (!Array.isArray(command.rooms) || command.rooms.length < 2)
      return this.failure('MULTI_ROOM_REQUEST_INVALID', 'Request at least two rooms in one order.');
    if (
      command.externalReference &&
      (command.externalReference.length > 185 || !command.externalReference.trim())
    )
      return this.failure('INVALID_EXTERNAL_REFERENCE', 'The order reference is invalid.');
    if (!command.guest.email.trim())
      return this.failure('INVALID_GUEST_EMAIL', 'Guest email is required.');
    const selectedRoomIds = command.rooms.flatMap((room) => (room.roomId ? [room.roomId] : []));
    if (new Set(selectedRoomIds).size !== selectedRoomIds.length)
      return this.failure('MULTI_ROOM_REQUEST_INVALID', 'The same room cannot be requested twice.');
    for (const room of command.rooms) {
      if (
        !room.roomTypeId ||
        !room.ratePlanId ||
        !room.quoteToken ||
        !this.validMoney(room.total) ||
        (room.guestCount !== undefined &&
          (!Number.isInteger(room.guestCount) || room.guestCount < 1))
      )
        return this.failure(
          'MULTI_ROOM_REQUEST_INVALID',
          'Each requested room needs a valid quote and total.',
        );
    }
    if (new Set(command.rooms.map((room) => room.total.currency)).size !== 1)
      return this.failure(
        'MULTI_ROOM_CURRENCY_MISMATCH',
        'All rooms in one order must use the same currency.',
      );
    return null;
  }

  private async lockInventory(
    tx: TenantTransaction,
    context: { tenantId: string; propertyId: string },
    rooms: MultiRoomBookingCommand['rooms'],
  ): Promise<void> {
    const roomIds = rooms.flatMap((room) => (room.roomId ? [room.roomId] : [])).sort();
    const roomTypeIds = [
      ...new Set(rooms.filter((room) => !room.roomId).map((room) => room.roomTypeId)),
    ].sort();
    for (const roomId of roomIds)
      await this.availability.lockRoom(tx, context.tenantId, context.propertyId, roomId);
    for (const roomTypeId of roomTypeIds)
      await this.availability.lockBookedUnits(tx, context.tenantId, context.propertyId, roomTypeId);
  }

  private async reserveAll(
    tx: TenantTransaction,
    context: { tenantId: string; propertyId: string },
    command: MultiRoomBookingCommand,
  ): Promise<void> {
    for (const room of command.rooms
      .filter((candidate) => candidate.roomId)
      .sort((a, b) => a.roomId!.localeCompare(b.roomId!))) {
      const reserved = await this.availability.reserveRoom(
        tx,
        context.tenantId,
        context.propertyId,
        {
          roomId: room.roomId!,
          startsOn: command.startsOn,
          endsOn: command.endsOn,
        },
      );
      if (!reserved) throw new MultiRoomAvailabilityError();
    }
    const unitsByType = new Map<string, number>();
    for (const room of command.rooms.filter((candidate) => !candidate.roomId))
      unitsByType.set(room.roomTypeId, (unitsByType.get(room.roomTypeId) ?? 0) + 1);
    for (const [roomTypeId, units] of [...unitsByType.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const reserved = await this.availability.reserveBookedUnits(
        tx,
        context.tenantId,
        context.propertyId,
        {
          roomTypeId,
          startsOn: command.startsOn,
          endsOn: command.endsOn,
          units,
        },
      );
      if (!reserved) throw new MultiRoomAvailabilityError();
    }
  }

  private async validCatalog(
    tx: TenantTransaction,
    context: { tenantId: string; propertyId: string },
    room: MultiRoomBookingCommand['rooms'][number],
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT rp.id
      FROM rate_plans rp
      JOIN room_types rt
        ON rt.tenant_id = rp.tenant_id AND rt.property_id = rp.property_id
        AND rt.id = ${room.roomTypeId}::uuid
      WHERE rp.tenant_id = ${context.tenantId}::uuid
        AND rp.property_id = ${context.propertyId}::uuid
        AND rp.id = ${room.ratePlanId}::uuid
        AND rp.is_active = true
        AND rp.currency = ${room.total.currency}
    `;
    if (!rows[0]) return false;
    if (!room.roomId) return true;
    const selected = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rooms
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND id = ${room.roomId}::uuid AND room_type_id = ${room.roomTypeId}::uuid
    `;
    return !!selected[0];
  }

  private async paymentMethod(
    tx: TenantTransaction,
    context: { tenantId: string; propertyId: string },
    selected: GuestPaymentMethod | undefined,
    rooms: MultiRoomBookingCommand['rooms'],
  ): Promise<Result<BookingPaymentMethod>> {
    const needsCheckout = rooms.some((room) => this.minorUnits(room.total.amount) > 0n);
    if (!needsCheckout) return { ok: true, value: BookingPaymentMethod.FREE };
    if (!selected)
      return this.failure('PAYMENT_METHOD_REQUIRED', 'Select an enabled payment method.');
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
        'The selected payment method is not enabled.',
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

  private async resolveGuest(
    tx: TenantTransaction,
    tenantId: string,
    guest: CreateBookingCommand['guest'],
  ): Promise<Result<string>> {
    const email = guest.email.trim().toLowerCase();
    const existing = await tx.$queryRaw<GuestRow[]>`
      SELECT id FROM guests WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    if (existing[0]) return { ok: true, value: existing[0].id };
    const inserted = await tx.$queryRaw<GuestRow[]>`
      INSERT INTO guests (id, tenant_id, email, first_name, last_name, phone)
      VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${email},
        ${guest.firstName?.trim() || null}, ${guest.lastName?.trim() || null}, ${guest.phone ?? null})
      ON CONFLICT (tenant_id, lower(email)) DO NOTHING
      RETURNING id
    `;
    if (inserted[0]) return { ok: true, value: inserted[0].id };
    const matched = await tx.$queryRaw<GuestRow[]>`
      SELECT id FROM guests WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
    `;
    return matched[0]
      ? { ok: true, value: matched[0].id }
      : this.failure('GUEST_MATCH_FAILED', 'Guest matching could not be completed.', true);
  }

  private async withIdempotency(
    tx: TenantTransaction,
    context: { tenantId: string; propertyId: string },
    command: MultiRoomBookingCommand,
    execute: () => Promise<Result<MultiRoomOrder>>,
  ): Promise<Result<MultiRoomOrder>> {
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const inserted = await tx.$queryRaw<Array<{ requestHash: string }>>`
      INSERT INTO integration_operations (
        tenant_id, property_id, idempotency_key, aggregate_id, request_hash, status
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${command.idempotencyKey},
        ${randomUUID()}::uuid, ${requestHash}, 'PENDING'
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING request_hash AS "requestHash"
    `;
    if (!inserted[0]) {
      const existing = await tx.$queryRaw<OperationRow[]>`
        SELECT request_hash AS "requestHash", result
        FROM integration_operations
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND idempotency_key = ${command.idempotencyKey}
        FOR UPDATE
      `;
      const operation = existing[0];
      if (!operation || operation.requestHash !== requestHash)
        return this.failure(
          'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key was used for another request.',
        );
      return (
        operation.result ??
        this.failure('IDEMPOTENCY_IN_PROGRESS', 'Booking order is in progress.', true)
      );
    }
    const result = await execute();
    await tx.$executeRaw`
      UPDATE integration_operations
      SET status = ${result.ok ? 'SUCCEEDED' : 'FAILED'}, result = ${JSON.stringify(result)}::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND idempotency_key = ${command.idempotencyKey}
    `;
    return result;
  }

  private validDateRange(startsOn: string, endsOn: string): boolean {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(startsOn) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endsOn) &&
      endsOn > startsOn
    );
  }

  private validMoney(money: Money): boolean {
    return (
      !!money && /^[0-9]+(?:\.\d{1,2})?$/.test(money.amount) && /^[A-Z]{3}$/.test(money.currency)
    );
  }

  private minorUnits(amount: string): bigint {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }

  private total(amounts: Money[]): Money {
    const currency = amounts[0]!.currency;
    const total = amounts.reduce((sum, amount) => sum + this.minorUnits(amount.amount), 0n);
    return {
      amount: `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`,
      currency,
    };
  }

  private checkoutReturnUrl(bookingId: string, outcome: 'success' | 'cancel'): string {
    return new URL(
      `/bookings/${bookingId}/payment/${outcome}`,
      process.env.WEB_APP_URL!,
    ).toString();
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
