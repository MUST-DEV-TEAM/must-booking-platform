import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/clock-catalog')
export class ClockCatalogSyncController {
  constructor(
    @Inject(ClockCatalogSyncService) private readonly catalogSync: ClockCatalogSyncService,
  ) {}

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
