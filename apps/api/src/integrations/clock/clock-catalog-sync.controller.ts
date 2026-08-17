import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { RatePlansService } from '../../tenancy/rate-plans.service';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/clock-catalog')
export class ClockCatalogSyncController {
  constructor(
    @Inject(ClockCatalogSyncService) private readonly catalogSync: ClockCatalogSyncService,
    @Inject(RatePlansService) private readonly ratePlans: RatePlansService,
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

  @Get('cancellation-policies')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  listCancellationPolicies(@Param('propertyId') propertyId: string, @Req() request: TenantRequest) {
    return this.ratePlans.listClockShadowCancellationPolicies(
      request.tenantContext.tenantId,
      propertyId,
    );
  }

  @Patch('cancellation-policies/:ratePlanId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  updateCancellationPolicy(
    @Param('propertyId') propertyId: string,
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Req() request: TenantRequest,
  ) {
    return this.ratePlans.updateClockShadowCancellationPolicy(
      request.tenantContext.tenantId,
      propertyId,
      ratePlanId,
      request.tenantContext.userId,
      body,
    );
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
