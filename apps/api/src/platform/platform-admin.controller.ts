import { Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';

import { Role, Roles } from '../tenancy/roles.decorator';
import { PlatformAdminService } from './platform-admin.service';

@Controller('platform')
@Roles(Role.PlatformAdmin)
export class PlatformAdminController {
  constructor(@Inject(PlatformAdminService) private readonly platformAdmin: PlatformAdminService) {}

  @Post('tenants/:tenantId/suspend')
  suspend(@Param('tenantId') tenantId: string) {
    return this.platformAdmin.suspendTenant(tenantId);
  }

  @Post('tenants/:tenantId/reactivate')
  reactivate(@Param('tenantId') tenantId: string) {
    return this.platformAdmin.reactivateTenant(tenantId);
  }

  @Post('tenants/:tenantId/users/:userId/reset-password')
  @HttpCode(202)
  async resetPassword(@Param('tenantId') tenantId: string, @Param('userId') userId: string) {
    await this.platformAdmin.triggerPasswordReset(tenantId, userId);
    return { accepted: true };
  }
}
