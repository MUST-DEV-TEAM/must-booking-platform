import { Controller, ForbiddenException, Get, Inject, Req } from '@nestjs/common';

import { AuditLogService } from './audit-log.service';
import { CapabilitiesService } from './capabilities.service';
import { safeAuditValue } from './audit-workspace';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

@Controller('tenants/:tenantId/audit-logs')
export class AuditLogController {
  constructor(
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  @Get()
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('staff.manage_permissions')
  async list(@Req() request: { tenantContext: { tenantId: string; userId: string } }) {
    if (!(await this.capabilities.effective(request.tenantContext)).includes('staff.view'))
      throw new ForbiddenException('staff.view is required for the legacy tenant-wide audit list.');
    return (await this.auditLogs.list(request.tenantContext.tenantId)).map((row) => ({
      ...row,
      details: safeAuditValue(row.details, true),
    }));
  }
}
