import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { GuestPaymentMethod } from '@must/domain-contracts';

import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { LocalPmsProvider } from './local-pms.provider';
import { BookingProjectionService } from './booking-projection.service';
import { CancellationLinkService } from './cancellation-link.service';

type GuestBookingRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class BookingController {
  constructor(
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(BookingProjectionService) private readonly projections: BookingProjectionService,
    @Inject(CancellationLinkService) private readonly cancellations: CancellationLinkService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.manage')
  list(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.projections.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post()
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    const result = this.noConflict(
      await this.provider.createBooking(request.tenantContext, {
        ...this.createInput(body),
        idempotencyKey: this.idempotencyKey(idempotencyKey),
        quoteSessionId: request.guestSessionId,
      }),
    );
    if (result.ok) {
      return {
        ...result,
        value: {
          ...result.value,
          cancellationToken: this.cancellations.create(
            {
              tenantId: request.tenantContext.tenantId,
              propertyId: request.tenantContext.propertyId,
              bookingId: result.value.id,
              guestSessionId: request.guestSessionId,
            },
            30 * 24 * 60 * 60,
            new Date(
              new Date(result.value.createdAt).valueOf() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          ),
        },
      };
    }
    return result;
  }

  @Patch(':bookingId')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  async update(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    return this.noConflict(
      await this.provider.updateBooking(request.tenantContext, {
        idempotencyKey: this.idempotencyKey(idempotencyKey),
        bookingId,
        guestSessionId: request.guestSessionId,
        expectedVersion: typeof value.expectedVersion === 'number' ? value.expectedVersion : NaN,
        total: this.money(value.total),
      }),
    );
  }

  @Delete(':bookingId')
  @HttpCode(200)
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  async cancel(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Query('cancellationToken') queryToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    return this.noConflict(
      await this.provider.cancelBooking(request.tenantContext, {
        idempotencyKey: this.idempotencyKey(idempotencyKey),
        bookingId,
        guestSessionId: this.cancellationSession(body, queryToken, request, bookingId),
        expectedVersion: typeof value.expectedVersion === 'number' ? value.expectedVersion : NaN,
        reason: typeof value.reason === 'string' ? value.reason : null,
      }),
    );
  }

  private createInput(body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    const guest = (value.guest ?? {}) as Record<string, unknown>;
    return {
      externalReference:
        typeof value.externalReference === 'string'
          ? value.externalReference
          : `must-${randomUUID()}`,
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
      roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
      ratePlanId: typeof value.ratePlanId === 'string' ? value.ratePlanId : '',
      startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
      endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
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
      },
      total: this.money(value.total) ?? { amount: '', currency: '' },
      paymentMethod:
        value.paymentMethod === 'stripe' ||
        value.paymentMethod === 'pokpay' ||
        value.paymentMethod === 'pay_at_hotel'
          ? value.paymentMethod
          : (undefined as GuestPaymentMethod | undefined),
      payAtHotel: typeof value.payAtHotel === 'boolean' ? value.payAtHotel : undefined,
      quoteToken: typeof value.quoteToken === 'string' ? value.quoteToken : '',
      returnUrl: typeof value.returnUrl === 'string' ? value.returnUrl : undefined,
    };
  }

  /**
   * Distinguishes an absent/non-string field (undefined — leave the guest's existing value
   * untouched) from an explicit `null` (clear it) from a real string (set it).
   */
  private optionalNullableString(value: unknown): string | null | undefined {
    if (typeof value === 'string') return value;
    if (value === null) return null;
    return undefined;
  }

  private money(value: unknown): { amount: string; currency: string } | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const money = value as Record<string, unknown>;
    if (typeof money.amount !== 'string' || typeof money.currency !== 'string') return undefined;
    return { amount: money.amount, currency: money.currency };
  }

  private cancellationSession(
    body: unknown,
    queryToken: string | undefined,
    request: GuestBookingRequest,
    bookingId: string,
  ): string {
    const value = (body ?? {}) as Record<string, unknown>;
    const token =
      typeof value.cancellationToken === 'string' ? value.cancellationToken : queryToken;
    if (!token) return request.guestSessionId;
    return this.cancellations.verify(token, {
      tenantId: request.tenantContext.tenantId,
      propertyId: request.tenantContext.propertyId,
      bookingId,
    }).guestSessionId;
  }

  private idempotencyKey(value: string | undefined): string {
    if (!value?.trim()) throw new BadRequestException('Idempotency-Key header is required.');
    return value;
  }

  private noConflict<T extends { ok: boolean; error?: { code: string } }>(result: T): T {
    if (!result.ok && result.error?.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    return result;
  }
}
