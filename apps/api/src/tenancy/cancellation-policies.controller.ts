import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { CancellationPoliciesService } from './cancellation-policies.service';

type RequestContext = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/clock-catalog/cancellation-policies')
@Roles(Role.TenantOwner, Role.TenantAdmin)
export class CancellationPoliciesController {
  constructor(
    @Inject(CancellationPoliciesService) private readonly policies: CancellationPoliciesService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  list(@Req() request: RequestContext) {
    return this.policies.listClockCatalog(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }
  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  create(@Body() body: unknown, @Req() request: RequestContext) {
    const c = request.tenantContext;
    return this.policies.create(c.tenantId, c.propertyId, c.userId, body);
  }
  @Patch(':policyId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  update(
    @Param('policyId') policyId: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ) {
    const c = request.tenantContext;
    return this.policies.update(c.tenantId, c.propertyId, policyId, c.userId, body);
  }
  @Delete(':policyId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @HttpCode(204)
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  remove(@Param('policyId') policyId: string, @Req() request: RequestContext) {
    const c = request.tenantContext;
    return this.policies.remove(c.tenantId, c.propertyId, policyId, c.userId);
  }
  @Patch('rate-plans/:ratePlanId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  assign(
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ) {
    const c = request.tenantContext;
    return this.policies.assignToClockRatePlan(
      c.tenantId,
      c.propertyId,
      ratePlanId,
      c.userId,
      body,
    );
  }
}
