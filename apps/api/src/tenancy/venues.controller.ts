import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { VenuesService } from './venues.service';

type VenueRequest = { tenantContext: { tenantId: string; userId: string; venueId?: string } };

@Controller('tenants/:tenantId/venues')
export class VenuesController {
  constructor(@Inject(VenuesService) private readonly venues: VenuesService) {}

  /** Every workspace member may ask; the service returns only the venues they can reach. */
  @Get()
  @TenantScoped()
  list(@Req() request: VenueRequest) {
    return this.venues.list(request.tenantContext.tenantId, request.tenantContext.userId);
  }

  @Post()
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  create(@Body() body: unknown, @Req() request: VenueRequest) {
    return this.venues.create(request.tenantContext.tenantId, request.tenantContext.userId, body);
  }

  @Get(':venueId')
  @TenantScoped({ venueParam: 'venueId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
  @RequiresCapability('venue.view')
  get(@Param('venueId') venueId: string, @Req() request: VenueRequest) {
    return this.venues.get(request.tenantContext.tenantId, venueId);
  }

  @Patch(':venueId')
  @TenantScoped({ venueParam: 'venueId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  update(@Param('venueId') venueId: string, @Body() body: unknown, @Req() request: VenueRequest) {
    return this.venues.update(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
      body,
    );
  }

  @Post(':venueId/activate')
  @TenantScoped({ venueParam: 'venueId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  activate(@Param('venueId') venueId: string, @Req() request: VenueRequest) {
    return this.venues.activate(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
    );
  }

  @Post(':venueId/complete-setup')
  @TenantScoped({ venueParam: 'venueId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  completeSetup(@Param('venueId') venueId: string, @Req() request: VenueRequest) {
    return this.venues.completeSetup(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
    );
  }

  @Post(':venueId/deactivate')
  @TenantScoped({ venueParam: 'venueId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)
  @RequiresCapability('venue.manage')
  @RequiresVerifiedEmail()
  deactivate(@Param('venueId') venueId: string, @Req() request: VenueRequest) {
    return this.venues.deactivate(
      request.tenantContext.tenantId,
      venueId,
      request.tenantContext.userId,
    );
  }
}
