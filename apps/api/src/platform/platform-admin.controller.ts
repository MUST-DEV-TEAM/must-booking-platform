import { Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';

import { Role, Roles } from '../tenancy/roles.decorator';
import { PlatformAdminService } from './platform-admin.service';

type PlatformRequest = { platformContext: { userId: string } };

@Controller('platform')
@Roles(Role.PlatformAdmin)
export class PlatformAdminController {
  constructor(@Inject(PlatformAdminService) private readonly platformAdmin: PlatformAdminService) {}

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
