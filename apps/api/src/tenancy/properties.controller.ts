import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { PropertiesService } from './properties.service';
import { Role, Roles } from './roles.decorator';
@Controller('tenants/:tenantId/properties')
export class PropertiesController {
  constructor(@Inject(PropertiesService) private readonly properties: PropertiesService) {}
  @Get() @TenantScoped() list(@Req() r: { tenantContext: { tenantId: string } }) {
    return this.properties.list(r.tenantContext.tenantId);
  }
  @Post()
  @TenantScoped()
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  create(@Body() b: unknown, @Req() r: { tenantContext: { tenantId: string; userId: string } }) {
    return this.properties.create(r.tenantContext.tenantId, r.tenantContext.userId, b);
  }

  @Patch(':propertyId/public-website-origin')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  updatePublicWebsiteOrigin(
    @Param('propertyId') propertyId: string,
    @Body() b: unknown,
    @Req() r: { tenantContext: { tenantId: string; userId: string } },
  ) {
    return this.properties.updatePublicWebsiteOrigin(
      r.tenantContext.tenantId,
      propertyId,
      r.tenantContext.userId,
      b,
    );
  }

  @Patch(':propertyId/payment-gateways')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  updatePaymentGateways(
    @Param('propertyId') propertyId: string,
    @Body() body: unknown,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ) {
    return this.properties.updatePaymentGateways(
      request.tenantContext.tenantId,
      propertyId,
      request.tenantContext.userId,
      body,
    );
  }
}
