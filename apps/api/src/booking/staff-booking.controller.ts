import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { GuestPaymentMethod } from '@must/domain-contracts';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { PaymentRefundService } from '../payments/payment-refund.service';
import { LocalPmsProvider } from './local-pms.provider';
import { QuoteService } from './quote.service';

@Controller('tenants/:tenantId/properties/:propertyId/staff-bookings')
export class StaffBookingController {
  constructor(
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
  ) {}

  @Delete(':bookingId')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.cancel')
  @RequiresVerifiedEmail()
  async cancel(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    const key = this.idempotencyKey(idempotencyKey);
    const refund = this.refundChoice(value.refund);
    const result = await this.provider.cancelBooking(request.tenantContext, {
      idempotencyKey: key,
      bookingId,
      expectedVersion: typeof value.expectedVersion === 'number' ? value.expectedVersion : NaN,
      reason: typeof value.reason === 'string' ? value.reason : null,
      staffActorId: request.tenantContext.userId,
      // When staff pick the refund themselves the policy's automatic refund must not also run.
      skipAutomaticRefund: refund !== undefined,
    });
    if (!result.ok && result.error.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    if (!result.ok || !refund || refund.kind === 'none') return result;
    // Cancel first, then refund: a refund that fails must never leave the room held.
    const refunded = await this.refunds.manualRefund(request.tenantContext, {
      bookingId,
      idempotencyKey: `cancel-refund:${key}`,
      ...(refund.kind === 'fixed'
        ? { amount: refund.amount }
        : { percentage: refund.kind === 'full' ? 100 : refund.percentage }),
      note: `Cancellation: ${typeof value.reason === 'string' ? value.reason : ''}`.slice(0, 500),
      actorUserId: request.tenantContext.userId,
    });
    return {
      ...result,
      refundOutcome: refunded.ok
        ? { ok: true }
        : { ok: false, message: refunded.error.message },
    };
  }

  @Post()
  @HttpCode(201)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.create')
  @RequiresVerifiedEmail()
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const input = this.input(body);
    this.validateGuest(input.guest);
    const key = this.idempotencyKey(idempotencyKey);
    const total = await this.quotes.price(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      input,
    );
    const result = await this.provider.createBooking(request.tenantContext, {
      ...input,
      idempotencyKey: key,
      externalReference: this.externalReference(body),
      total,
      staffActorId: request.tenantContext.userId,
      skipQuoteValidation: true,
    });
    if (!result.ok && result.error.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    return result;
  }

  /** The same rules the dashboard form applies, so other clients cannot save bad contact data. */
  private validateGuest(guest: { email: string; firstName: string; lastName: string; phone: string | null }) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guest.email.trim()) || guest.email.length > 254)
      throw new BadRequestException('A valid guest email address is required.');
    if (!guest.firstName.trim() || guest.firstName.length > 100)
      throw new BadRequestException('A guest first name of up to 100 characters is required.');
    if (!guest.lastName.trim() || guest.lastName.length > 100)
      throw new BadRequestException('A guest last name of up to 100 characters is required.');
    if (guest.phone && !/^\+?[0-9][0-9 ]{4,19}$/.test(guest.phone.trim()))
      throw new BadRequestException('The guest phone number may contain only digits and a country prefix.');
  }

  /** What staff chose to do with money already paid: nothing, everything left, a percentage or an amount. */
  private refundChoice(value: unknown):
    | { kind: 'none' }
    | { kind: 'full' }
    | { kind: 'percentage'; percentage: number }
    | { kind: 'fixed'; amount: { amount: string; currency: string } }
    | undefined {
    if (value === undefined || value === null) return undefined;
    const choice = value as Record<string, unknown>;
    if (choice.kind === 'none' || choice.kind === 'full') return { kind: choice.kind };
    if (choice.kind === 'percentage') {
      const percentage = Number(choice.percentage);
      if (!Number.isFinite(percentage) || percentage < 1 || percentage > 100)
        throw new BadRequestException('The refund percentage must be between 1 and 100.');
      return { kind: 'percentage', percentage };
    }
    if (choice.kind === 'fixed') {
      const amount = choice.amount as Record<string, unknown> | undefined;
      if (typeof amount?.amount !== 'string' || typeof amount.currency !== 'string')
        throw new BadRequestException('A refund amount with a currency is required.');
      return { kind: 'fixed', amount: { amount: amount.amount, currency: amount.currency } };
    }
    throw new BadRequestException('The refund must be none, full, percentage or fixed.');
  }

  private input(body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    const guest = (value.guest ?? {}) as Record<string, unknown>;
    return {
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
      roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
      ratePlanId: typeof value.ratePlanId === 'string' ? value.ratePlanId : '',
      startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
      endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
      adults: typeof value.adults === 'number' ? value.adults : undefined,
      children: typeof value.children === 'number' ? value.children : undefined,
      guestCount: typeof value.guestCount === 'number' ? value.guestCount : undefined,
      paymentMethod:
        value.paymentMethod === 'stripe' ||
        value.paymentMethod === 'pokpay' ||
        value.paymentMethod === 'pay_at_hotel'
          ? value.paymentMethod
          : (undefined as GuestPaymentMethod | undefined),
      guest: {
        email: typeof guest.email === 'string' ? guest.email : '',
        firstName: typeof guest.firstName === 'string' ? guest.firstName : '',
        lastName: typeof guest.lastName === 'string' ? guest.lastName : '',
        phone: typeof guest.phone === 'string' ? guest.phone : null,
        streetAddress: this.optionalNullableString(guest.streetAddress),
        addressLine2: this.optionalNullableString(guest.addressLine2),
        city: this.optionalNullableString(guest.city),
        county: this.optionalNullableString(guest.county),
        postcode: this.optionalNullableString(guest.postcode),
        specialRequests: typeof guest.specialRequests === 'string' ? guest.specialRequests : undefined,
      },
    };
  }

  // Left undefined when the client doesn't supply one — LocalPmsProvider generates a
  // human-readable reference itself, exactly once, inside the idempotency-gated section.
  private externalReference(body: unknown): string | undefined {
    const value = (body ?? {}) as Record<string, unknown>;
    if (value.externalReference === undefined) return undefined;
    if (typeof value.externalReference !== 'string' || !value.externalReference.trim())
      throw new BadRequestException('externalReference must be a non-empty string.');
    return value.externalReference;
  }

  private optionalNullableString(value: unknown): string | null | undefined {
    if (typeof value === 'string') return value;
    if (value === null) return null;
    return undefined;
  }

  private idempotencyKey(value: string | undefined): string {
    if (!value?.trim()) throw new BadRequestException('Idempotency-Key header is required.');
    return value;
  }
}
