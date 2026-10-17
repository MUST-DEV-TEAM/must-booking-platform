import { Controller, Get, Inject, Req } from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { Role, Roles } from './roles.decorator';
import { AuditLogService } from './audit-log.service';

@Controller('tenants/:tenantId/properties/:propertyId/audit-logs')
export class AccommodationsAuditController {
  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  list(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.audit.listAccommodationsForProperty(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }
}
