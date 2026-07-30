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
import { TenantScoped } from './tenant-context.decorator';
import { Role, Roles } from './roles.decorator';
import { RatePlansService } from './rate-plans.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/rate-plans')
export class RatePlansController {
  constructor(@Inject(RatePlansService) private readonly ratePlans: RatePlansService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() request: TenantPropertyRequest) {
    return this.ratePlans.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  create(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch(':ratePlanId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  update(
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.update(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':ratePlanId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  remove(
    @Param('ratePlanId') ratePlanId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.remove(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      request.tenantContext.userId,
    );
  }

  @Get(':ratePlanId/rules')
  @TenantScoped({ propertyParam: 'propertyId' })
  listRules(@Param('ratePlanId') ratePlanId: string, @Req() request: TenantPropertyRequest) {
    return this.ratePlans.listRules(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
    );
  }

  @Post(':ratePlanId/rules')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  createRule(
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.createRule(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      request.tenantContext.userId,
      body,
    );
  }

  @Patch(':ratePlanId/rules/:rateRuleId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  updateRule(
    @Param('ratePlanId') ratePlanId: string,
    @Param('rateRuleId') rateRuleId: string,
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.updateRule(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      rateRuleId,
      request.tenantContext.userId,
      body,
    );
  }

  @Delete(':ratePlanId/rules/:rateRuleId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  removeRule(
    @Param('ratePlanId') ratePlanId: string,
    @Param('rateRuleId') rateRuleId: string,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.removeRule(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      rateRuleId,
      request.tenantContext.userId,
    );
  }
}
