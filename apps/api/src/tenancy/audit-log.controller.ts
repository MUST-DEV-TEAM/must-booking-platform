import { Controller, Get, Inject, Req } from '@nestjs/common';

import { AuditLogService } from './audit-log.service';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

@Controller('tenants/:tenantId/audit-logs')
export class AuditLogController {
  constructor(@Inject(AuditLogService) private readonly auditLogs: AuditLogService) {}

  @Get()
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  list(@Req() request: { tenantContext: { tenantId: string } }) {
    return this.auditLogs.list(request.tenantContext.tenantId);
  }
}
