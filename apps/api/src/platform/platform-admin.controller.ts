import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';

import { Role, Roles } from '../tenancy/roles.decorator';
import { PlatformAdminService, type OrganizationStatus } from './platform-admin.service';
import { ProviderHealthService } from './provider-health.service';

type PlatformRequest = { platformContext: { userId: string } };

@Controller('platform')
@Roles(Role.PlatformAdmin)
export class PlatformAdminController {
  constructor(
    @Inject(PlatformAdminService) private readonly platformAdmin: PlatformAdminService,
    @Inject(ProviderHealthService) private readonly providerHealth: ProviderHealthService,
  ) {}

  @Get('provider-health')
  providerHealthStatus() {
    return this.providerHealth.getHealth();
  }

  @Get('dashboard')
  dashboard(@Req() request: PlatformRequest) {
    return this.platformAdmin.dashboardHome(request.platformContext.userId);
  }

  @Get('tenants')
  tenants(@Req() request: PlatformRequest & { query?: { search?: string; status?: string } }) {
    const status = request.query?.status;
    return this.platformAdmin.listTenants(
      request.query?.search,
      status === 'ACTIVE' || status === 'SUSPENDED' ? (status as OrganizationStatus) : undefined,
      request.platformContext.userId,
    );
  }

  @Post('tenants/:tenantId/suspend')
  suspend(@Param('tenantId') tenantId: string, @Req() request: PlatformRequest) {
    return this.platformAdmin.suspendTenant(tenantId, request.platformContext.userId);
  }

  @Post('tenants/:tenantId/reactivate')
  reactivate(@Param('tenantId') tenantId: string, @Req() request: PlatformRequest) {
    return this.platformAdmin.reactivateTenant(tenantId, request.platformContext.userId);
  }

  @Post('tenants/:tenantId/users/:userId/reset-password')
  @HttpCode(202)
  async resetPassword(
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Req() request: PlatformRequest,
  ) {
    await this.platformAdmin.triggerPasswordReset(tenantId, userId, request.platformContext.userId);
    return { accepted: true };
  }
}
