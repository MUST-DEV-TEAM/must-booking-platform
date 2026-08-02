import { Controller, Get, Inject, Req } from '@nestjs/common';

import { OverviewService } from './overview.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/overview')
export class OverviewController {
  constructor(@Inject(OverviewService) private readonly overview: OverviewService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  get(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.overview.get(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }
}
