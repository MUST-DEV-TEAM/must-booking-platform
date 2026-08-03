import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { GuestsService } from './guests.service';
import { RequiresCapability } from './capabilities.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/guests')
export class GuestsController {
  constructor(@Inject(GuestsService) private readonly guests: GuestsService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('guests.manage')
  list(
    @Query('search') search: string | undefined,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.guests.list(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      search,
    );
  }
}
