import { CapabilitiesService } from '../../tenancy/capabilities.service';
import { ForbiddenException, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/clock-catalog')
export class ClockCatalogSyncController {
  constructor(
    @Inject(ClockCatalogSyncService) private readonly catalogSync: ClockCatalogSyncService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  @Get('room-counts')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  async counts(@Param('propertyId') propertyId: string, @Req() req: TenantRequest) {
    const caps = await this.capabilities.effective(req.tenantContext);
    if (
      !['bookings.view', 'calendar.view', 'rooms.manage', 'settings.manage'].some((c) =>
        caps.includes(c),
      )
    )
      throw new ForbiddenException('Room counts are not available to this role.');
    return this.catalogSync.roomCounts(req.tenantContext.tenantId, propertyId);
  }

  @Post('sync')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  sync(@Param('propertyId') propertyId: string, @Req() request: TenantRequest) {
    return this.catalogSync.sync(
      request.tenantContext.tenantId,
      propertyId,
      request.tenantContext.userId,
    );
  }

  @Post('confirm-all')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  confirmAll(@Param('propertyId') propertyId: string, @Req() request: TenantRequest) {
    return this.catalogSync.confirmAll(
      request.tenantContext.tenantId,
      propertyId,
      request.tenantContext.userId,
    );
  }

  @Get('mappings')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  listMappings(@Param('propertyId') propertyId: string, @Req() request: TenantRequest) {
    return this.catalogSync.listMappings(request.tenantContext.tenantId, propertyId);
  }

  @Post('mappings/:mappingId/confirm')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  confirm(
    @Param('propertyId') propertyId: string,
    @Param('mappingId') mappingId: string,
    @Req() request: TenantRequest,
  ) {
    return this.catalogSync.confirm(
      request.tenantContext.tenantId,
      propertyId,
      request.tenantContext.userId,
      mappingId,
    );
  }

  @Post('mappings/:mappingId/reject')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  reject(
    @Param('propertyId') propertyId: string,
    @Param('mappingId') mappingId: string,
    @Req() request: TenantRequest,
  ) {
    return this.catalogSync.reject(
      request.tenantContext.tenantId,
      propertyId,
      request.tenantContext.userId,
      mappingId,
    );
  }
}
