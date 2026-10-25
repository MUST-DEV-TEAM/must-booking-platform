import { Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockPermissionsService } from './clock-permissions.service';

type TenantRequest = { tenantContext: { tenantId: string; userId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/clock-permissions')
export class ClockPermissionsController {
  constructor(
    @Inject(ClockPermissionsService) private readonly permissions: ClockPermissionsService,
  ) {}

  /** What the last check found, for the dashboard's Clock permissions panel. */
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  latest(@Req() request: TenantRequest) {
    return this.permissions.latest(request.tenantContext);
  }

  /** Re-tests every endpoint with harmless reads (nothing is created or changed in Clock). */
  @Post('check')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  check(@Req() request: TenantRequest) {
    return this.permissions.check(request.tenantContext, request.tenantContext.userId ?? null);
  }
}
