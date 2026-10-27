import { BadRequestException, Body, Controller, Inject, Param, Patch, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { NOTIFICATION_UUID } from '../tenancy/notification-registry';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { isStayStatus } from './booking-stay-status';
import { BookingStayStatusService } from './booking-stay-status.service';

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/bookings')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
@RequiresCapability('bookings.edit')
export class BookingStayStatusController {
  constructor(
    @Inject(BookingStayStatusService) private readonly stayStatus: BookingStayStatusService,
  ) {}

  /** Check a guest in or out, mark a no-show, or undo one of those. */
  @Patch(':bookingId/stay-status')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  set(@Req() req: Request, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    const value = (body ?? {}) as Record<string, unknown>;
    if (!NOTIFICATION_UUID.test(bookingId) || !isStayStatus(value.status))
      throw new BadRequestException('Choose a reservation and a valid arrival status.');
    return this.stayStatus.set(req.tenantContext, bookingId, value.status, value.expectedFrom);
  }
}
