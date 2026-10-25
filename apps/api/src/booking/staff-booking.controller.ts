import { StaffAvailabilityService } from './staff-availability.service';
import { BookingRequestsService, type CancellationInput } from './booking-requests.service';
import { countryCode } from '@must/domain-contracts';
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
import { LocalPmsProvider } from './local-pms.provider';
import { QuoteService } from './quote.service';

@Controller('tenants/:tenantId/properties/:propertyId/staff-bookings')
export class StaffBookingController {
  constructor(
    @Inject(BookingRequestsService) private readonly requests: BookingRequestsService,
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(QuoteService) private readonly quotes: QuoteService,
    @Inject(StaffAvailabilityService) private readonly availability: StaffAvailabilityService,
  ) {}

  @Post('offers')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.create')
  offers(
    @Req() req: { tenantContext: { tenantId: string; propertyId: string } },
    @Body() body: Record<string, unknown>,
  ) {
    return this.availability.search(req.tenantContext, body ?? {});
  }

  @Post('rate-offers')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.create')
  rateOffers(
    @Req() req: { tenantContext: { tenantId: string; propertyId: string } },
    @Body() body: Record<string, unknown>,
  ) {
    return this.availability.rateOffers(req.tenantContext, body ?? {});
  }

  @Delete(':bookingId')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.cancel')
  @RequiresVerifiedEmail()
  async cancel(
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    return this.requests.submit(request.tenantContext, bookingId, body as CancellationInput);
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
  private validateGuest(guest: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  }) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guest.email.trim()) || guest.email.length > 254)
      throw new BadRequestException('A valid guest email address is required.');
    if (!guest.firstName.trim() || guest.firstName.length > 100)
      throw new BadRequestException('A guest first name of up to 100 characters is required.');
    if (!guest.lastName.trim() || guest.lastName.length > 100)
      throw new BadRequestException('A guest last name of up to 100 characters is required.');
    if (guest.phone && !/^\+?[0-9][0-9 ]{4,19}$/.test(guest.phone.trim()))
      throw new BadRequestException(
        'The guest phone number may contain only digits and a country prefix.',
      );
  }

  private input(body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    const guest = (value.guest ?? {}) as Record<string, unknown>;
    return {
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
      roomId: typeof value.roomId === 'string' ? value.roomId : undefined,
      ratePlanId: typeof value.ratePlanId === 'string' ? value.ratePlanId : '',
      clockRateId:
        typeof value.clockRateId === 'string' && value.clockRateId ? value.clockRateId : undefined,
      startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
      endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
      adults: typeof value.adults === 'number' ? value.adults : undefined,
      children: typeof value.children === 'number' ? value.children : undefined,
      childrenAges: value.childrenAges as number[] | undefined,
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
        countryCode: this.country(guest.countryCode),
        specialRequests:
          typeof guest.specialRequests === 'string' ? guest.specialRequests : undefined,
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
  private country(value: unknown) {
    try {
      return countryCode(value);
    } catch {
      throw new BadRequestException('Choose an assigned ISO country code.');
    }
  }
}
