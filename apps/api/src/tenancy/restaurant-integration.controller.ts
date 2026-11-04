import { Controller, Get, Inject, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RestaurantIntegrationService } from './restaurant-integration.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type HotelRequest = {
  tenantContext: { tenantId: string; propertyId: string; userId: string };
};

/** Settings -> Integrations -> Restaurant, for one hotel. */
@Controller('tenants/:tenantId/properties/:propertyId/restaurant')
export class RestaurantIntegrationController {
  constructor(
    @Inject(RestaurantIntegrationService)
    private readonly integration: RestaurantIntegrationService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  status(@Req() request: HotelRequest) {
    return this.integration.status(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }

  @Post('activate')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  activate(@Req() request: HotelRequest) {
    return this.integration.activate(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
    );
  }

  @Post('deactivate')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  deactivate(@Req() request: HotelRequest) {
    return this.integration.deactivate(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
    );
  }
}
