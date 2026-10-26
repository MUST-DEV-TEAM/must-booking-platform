import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { Role, Roles } from '../tenancy/roles.decorator';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { PromoCodeAdminService } from './promo-code-admin.service';

type TenantRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/promo-codes')
@RequiresCapability('rates.manage')
export class PromoCodesController {
  constructor(@Inject(PromoCodeAdminService) private readonly promos: PromoCodeAdminService) {}

  /** The hotel's own promo codes, plus the bonus codes Clock already has. */
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  list(@Req() request: TenantRequest) {
    return this.promos.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post()
  @HttpCode(201)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresVerifiedEmail()
  create(@Body() body: unknown, @Req() request: TenantRequest) {
    return this.promos.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      body,
    );
  }

  @Put(':id')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresVerifiedEmail()
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: TenantRequest) {
    return this.promos.update(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      id,
      body,
    );
  }
}
