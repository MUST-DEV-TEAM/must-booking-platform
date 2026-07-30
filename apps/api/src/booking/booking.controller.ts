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
  Req,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PublicTenantScoped } from '../tenancy/tenant-context.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { LocalPmsProvider } from './local-pms.provider';
import { BookingProjectionService } from './booking-projection.service';

type GuestBookingRequest = {
  tenantContext: { tenantId: string; propertyId: string };
  guestSessionId: string;
};

@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class BookingController {
  constructor(
    @Inject(LocalPmsProvider) private readonly provider: LocalPmsProvider,
    @Inject(BookingProjectionService) private readonly projections: BookingProjectionService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
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
    return this.noConflict(
      await this.provider.createBooking(request.tenantContext, {
        ...this.createInput(body),
        idempotencyKey: this.idempotencyKey(idempotencyKey),
        quoteSessionId: request.guestSessionId,
      }),
    );
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
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: GuestBookingRequest,
  ) {
    const value = (body ?? {}) as Record<string, unknown>;
    return this.noConflict(
      await this.provider.cancelBooking(request.tenantContext, {
        idempotencyKey: this.idempotencyKey(idempotencyKey),
        bookingId,
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
      ratePlanId: typeof value.ratePlanId === 'string' ? value.ratePlanId : '',
      startsOn: typeof value.startsOn === 'string' ? value.startsOn : '',
      endsOn: typeof value.endsOn === 'string' ? value.endsOn : '',
      guest: {
        email: typeof guest.email === 'string' ? guest.email : '',
        firstName: typeof guest.firstName === 'string' ? guest.firstName : '',
        lastName: typeof guest.lastName === 'string' ? guest.lastName : '',
        phone: typeof guest.phone === 'string' ? guest.phone : null,
      },
      total: this.money(value.total) ?? { amount: '', currency: '' },
      quoteToken: typeof value.quoteToken === 'string' ? value.quoteToken : '',
    };
  }

  private money(value: unknown): { amount: string; currency: string } | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const money = value as Record<string, unknown>;
    if (typeof money.amount !== 'string' || typeof money.currency !== 'string') return undefined;
    return { amount: money.amount, currency: money.currency };
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
