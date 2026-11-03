import { BadRequestException, Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';

import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { BookingProjectionService } from './booking-projection.service';
import { BookingStayStatusService } from './booking-stay-status.service';

type Request = { tenantContext: { tenantId: string; propertyId: string } };

/** Read side of the front desk: the day's arrivals and departures, and the history of one stay. */
@Controller('tenants/:tenantId/properties/:propertyId')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
@RequiresCapability('bookings.view')
export class BookingFrontDeskController {
  constructor(
    @Inject(BookingProjectionService) private readonly projections: BookingProjectionService,
    @Inject(BookingStayStatusService) private readonly stayStatus: BookingStayStatusService,
  ) {}

  @Get('front-desk')
  @TenantScoped({ propertyParam: 'propertyId' })
  day(@Req() req: Request, @Query('date') date: string | undefined) {
    return this.projections.frontDesk(
      req.tenantContext.tenantId,
      req.tenantContext.propertyId,
      date ?? new Date().toISOString().slice(0, 10),
    );
  }

  @Get('bookings/:bookingId/stay-events')
  @TenantScoped({ propertyParam: 'propertyId' })
  async events(@Req() req: Request, @Param('bookingId') bookingId: string) {
    if (!NOTIFICATION_UUID.test(bookingId)) throw new BadRequestException('Choose a reservation.');
    return { events: await this.stayStatus.events(req.tenantContext, bookingId) };
  }
}
