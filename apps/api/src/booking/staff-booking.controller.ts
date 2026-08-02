import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { LocalPmsProvider } from './local-pms.provider';
import { QuoteService } from './quote.service';

@Controller('tenants/:tenantId/properties/:propertyId/staff-bookings')
export class StaffBookingController {
  constructor(
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(QuoteService) private readonly quotes: QuoteService,
  ) {}

  @Post()
  @HttpCode(201)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.manage')
  @RequiresVerifiedEmail()
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const input = this.input(body);
    const key = this.idempotencyKey(idempotencyKey);
    const total = await this.quotes.price(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      input,
    );
    const result = await this.provider.createBooking(request.tenantContext, {
      ...input,
      idempotencyKey: key,
      externalReference: this.externalReference(body, key),
      total,
      paymentMethod: 'pay_at_hotel',
      payAtHotel: true,
      staffActorId: request.tenantContext.userId,
      skipQuoteValidation: true,
    });
    if (!result.ok && result.error.code === 'IDEMPOTENCY_KEY_CONFLICT')
      throw new ConflictException(
        'This idempotency key was already used with a different request.',
      );
    return result;
  }

  private input(body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    const guest = (value.guest ?? {}) as Record<string, unknown>;
    return {
      roomTypeId: typeof value.roomTypeId === 'string' ? value.roomTypeId : '',
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
    };
  }

  private externalReference(body: unknown, idempotencyKey: string): string {
    const value = (body ?? {}) as Record<string, unknown>;
    if (value.externalReference === undefined)
      return `must-staff-${createHash('sha256').update(idempotencyKey).digest('hex')}`;
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
