import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';

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

  /** Every known Clock request with what the last check found, for the Clock permissions panel. */
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  report(@Req() request: TenantRequest) {
    return this.permissions.report(request.tenantContext);
  }

  /** Re-tests the given requests (up to 12) with harmless reads; nothing is created or changed in Clock. */
  @Post('check')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  check(@Req() request: TenantRequest, @Body() body: { ids?: unknown }) {
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : [];
    return this.permissions.check(request.tenantContext, request.tenantContext.userId ?? null, ids);
  }
}
