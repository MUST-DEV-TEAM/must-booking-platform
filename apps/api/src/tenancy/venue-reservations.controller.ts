import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { VenueReservationsService } from './venue-reservations.service';
import { VenueDepositPaymentsService } from '../payments/venue-deposit-payments.service';

type ReservationsRequest = { tenantContext: { tenantId: string; userId: string } };

/** Table reservations of one restaurant: availability, bookings and the live floor plan. */
@Controller('tenants/:tenantId/venues/:venueId')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
export class VenueReservationsController {
  constructor(
    @Inject(VenueReservationsService) private readonly reservations: VenueReservationsService,
    @Inject(VenueDepositPaymentsService) private readonly deposits: VenueDepositPaymentsService,
  ) {}

  @Get('availability')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.view')
  availability(
    @Param('venueId') venueId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.availability(request.tenantContext.tenantId, venueId, query);
  }

  @Get('floor')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.view')
  floor(
    @Param('venueId') venueId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.floor(request.tenantContext.tenantId, venueId, query);
  }

  @Get('guests')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.manage')
  guests(
    @Param('venueId') venueId: string,
    @Query('search') search: string,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.searchGuests(request.tenantContext.tenantId, venueId, search);
  }

  @Get('reservations')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.view')
  list(
    @Param('venueId') venueId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.list(request.tenantContext.tenantId, venueId, query);
  }

  @Post('reservations')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.manage')
  @RequiresVerifiedEmail()
  create(
    @Param('venueId') venueId: string,
    @Body() body: unknown,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.create(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
      body,
    );
  }

  @Get('reservations/:reservationId')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.view')
  get(
    @Param('venueId') venueId: string,
    @Param('reservationId') reservationId: string,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.get(request.tenantContext.tenantId, venueId, reservationId);
  }

  @Post('reservations/:reservationId/send-payment-link')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.manage')
  @RequiresVerifiedEmail()
  sendLink(
    @Param('venueId') venueId: string,
    @Param('reservationId') reservationId: string,
    @Req() request: ReservationsRequest,
  ) {
    return this.deposits.sendLink(request.tenantContext.tenantId, venueId, reservationId);
  }

  @Post('reservations/:reservationId/refund-deposit')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  refund(
    @Param('venueId') venueId: string,
    @Param('reservationId') reservationId: string,
    @Req() request: ReservationsRequest,
  ) {
    return this.deposits.refund(request.tenantContext.tenantId, venueId, reservationId);
  }

  @Patch('reservations/:reservationId')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.manage')
  @RequiresVerifiedEmail()
  update(
    @Param('venueId') venueId: string,
    @Param('reservationId') reservationId: string,
    @Body() body: unknown,
    @Req() request: ReservationsRequest,
  ) {
    return this.reservations.update(
      request.tenantContext.tenantId,
      venueId,
      reservationId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post('reservations/:reservationId/status')
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('reservations.manage')
  @RequiresVerifiedEmail()
  async setStatus(
    @Param('venueId') venueId: string,
    @Param('reservationId') reservationId: string,
    @Body() body: unknown,
    @Req() request: ReservationsRequest,
  ) {
    const result = await this.reservations.setStatus(
      request.tenantContext.tenantId,
      venueId,
      reservationId,
      request.tenantContext.userId,
      body,
    );
    if (result.status === 'cancelled')
      await this.deposits.refund(request.tenantContext.tenantId, venueId, reservationId);
    return result;
  }
}
