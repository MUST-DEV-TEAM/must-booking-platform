import { Body, Controller, Headers, Inject, Param, Patch, Req } from '@nestjs/common';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { BookingDetailsService } from './booking-details.service';
@Controller('tenants/:tenantId/properties/:propertyId/bookings')
export class BookingDetailsController {
  constructor(@Inject(BookingDetailsService) private readonly details: BookingDetailsService) {}
  @Patch(':bookingId/details')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('bookings.edit')
  @RequiresVerifiedEmail()
  edit(
    @Req() r: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
    @Param('bookingId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.details.edit(r.tenantContext, id, body, key);
  }
}
