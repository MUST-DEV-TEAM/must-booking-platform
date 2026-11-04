import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { VenueServicesService } from './venue-services.service';

type ServicesRequest = { tenantContext: { tenantId: string; userId: string } };

/** Opening hours: the services (lunch, dinner, ...) a restaurant is open for. */
@Controller('tenants/:tenantId/venues/:venueId/services')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
export class VenueServicesController {
  constructor(@Inject(VenueServicesService) private readonly services: VenueServicesService) {}

  @Get()
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.view')
  list(@Param('venueId') venueId: string, @Req() request: ServicesRequest) {
    return this.services.list(request.tenantContext.tenantId, venueId);
  }

  @Put()
  @TenantScoped({ venueParam: 'venueId' })
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  replace(
    @Param('venueId') venueId: string,
    @Body() body: unknown,
    @Req() request: ServicesRequest,
  ) {
    return this.services.replace(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
      body,
    );
  }
}
