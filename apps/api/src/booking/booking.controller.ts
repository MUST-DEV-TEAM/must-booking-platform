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
  UseGuards,
} from '@nestjs/common';
import type { GuestPaymentMethod } from '@must/domain-contracts';

import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { PublicRateLimitGuard } from '../tenancy/public-rate-limit.guard';
import {
  PUBLIC_BOOKING_MUTATION_RATE_LIMIT,
  PublicRateLimit,
} from '../tenancy/public-rate-limit.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { LocalPmsProvider } from './local-pms.provider';
import { BookingProjectionService } from './booking-projection.service';
import { CancellationLinkService } from './cancellation-link.service';
import { PmsProviderRegistry } from './pms-provider-registry';

type GuestBookingRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class BookingController {
  constructor(
    // create() deliberately stays on LocalPmsProvider directly — see
    // PmsProviderRegistry's own doc comment for why creation can't safely
    // dispatch yet. update()/cancel() resolve per property via the registry.
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(PmsProviderRegistry) private readonly providers: PmsProviderRegistry,
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
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
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
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  async update(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    const provider = await this.providers.forProperty(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
    return this.noConflict(
      await provider.updateBooking(request.tenantContext, {
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
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_BOOKING_MUTATION_RATE_LIMIT)
  async cancel(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Query('cancellationToken') queryToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    // Milestone 11.5 Task 6: cancellation always goes through LocalPmsProvider
    // directly (not the registry) — it owns the refund policy and the
    // self-service cancellation window, and internally calls Clock's real
    // cancellation as a sub-step when the property is Clock-connected.
    // Dispatching through the registry here would bypass that entirely for
    // Clock-connected properties (ClockBookingService.cancelBooking alone
    // knows nothing about refunds or the cancellation window).
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
        typeof value.externalReference === 'string' ? value.externalReference : undefined,
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
        specialRequests: this.optionalSpecialRequests(guest.specialRequests),
      },
      total: this.money(value.total) ?? { amount: '', currency: '' },
      guestCount: typeof value.guestCount === 'number' ? value.guestCount : undefined,
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

  private optionalSpecialRequests(value: unknown): string | null | undefined {
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    if (value.length > 2000)
      throw new BadRequestException('Special requests must be 2,000 characters or fewer.');
    const specialRequests = value.trim();
    return specialRequests || null;
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
