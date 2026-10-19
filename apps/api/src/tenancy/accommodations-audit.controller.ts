import { Controller, Get, Inject, Req } from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { Role, Roles } from './roles.decorator';
import { AuditLogService } from './audit-log.service';
import { CapabilitiesService } from './capabilities.service';
import { safeAuditValue } from './audit-workspace';

@Controller('tenants/:tenantId/properties/:propertyId/audit-logs')
export class AccommodationsAuditController {
  constructor(
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  async list(
    @Req() request: { tenantContext: { tenantId: string; propertyId: string; userId: string } },
  ) {
    const actors = (await this.capabilities.effective(request.tenantContext)).includes(
      'staff.view',
    );
    const rows = await this.audit.listAccommodationsForProperty(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
    return rows.map((row) => ({
      ...row,
      actorUserId: actors ? row.actorUserId : null,
      actorName: actors ? row.actorName : row.actorUserId ? 'Hidden (requires staff.view)' : null,
      details: safeAuditValue(
        row.details,
        actors,
        actors
          ? []
          : [row.actorName ?? '', ...(row.actorName ?? '').split(' '), row.actorUserId ?? ''],
      ),
    }));
  }
}
