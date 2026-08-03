import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { ReportsService } from './reports.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('reports.view')
  get(
    @Query() query: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.reports.get(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }
}
