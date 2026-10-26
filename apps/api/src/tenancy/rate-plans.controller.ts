import { pricingKey, pricingVersion, pricingReason } from './pricing-writes.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { RatePlansService } from './rate-plans.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/rate-plans')
export class RatePlansController {
  constructor(@Inject(RatePlansService) private readonly ratePlans: RatePlansService) {}

  @Get()
  @RequiresCapability('calendar.view')
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() request: TenantPropertyRequest) {
    return this.ratePlans.list(request.tenantContext.tenantId, request.tenantContext.propertyId);
  }

  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  create(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.create(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
      { key: pricingKey(key), version: pricingVersion(body, false) },
    );
  }

  @Patch(':ratePlanId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  update(
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.update(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      request.tenantContext.userId,
      body,
      { key: pricingKey(key), version: pricingVersion(body, true) },
    );
  }

  @Delete(':ratePlanId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  remove(
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.remove(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      request.tenantContext.userId,
      { key: pricingKey(key), version: pricingVersion(body, true) },
    );
  }

  @Get(':ratePlanId/room-price-overrides')
  @RequiresCapability('calendar.view')
  @TenantScoped({ propertyParam: 'propertyId' })
  listRoomPriceOverrides(
    @Param('ratePlanId') ratePlanId: string,
    @Req() request: TenantPropertyRequest,
  ) {
    return this.ratePlans.listRoomPriceOverrides(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
    );
  }

  @Patch(':ratePlanId/rooms/:roomId/price-override')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  setRoomPriceOverride(
    @Param('ratePlanId') ratePlanId: string,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.setRoomPriceOverride(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      roomId,
      request.tenantContext.userId,
      body,
      { key: pricingKey(key), version: pricingVersion(body, true), reason: pricingReason(body) },
    );
  }

  @Delete(':ratePlanId/rooms/:roomId/price-override')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  removeRoomPriceOverride(
    @Param('ratePlanId') ratePlanId: string,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.removeRoomPriceOverride(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      roomId,
      request.tenantContext.userId,
      { key: pricingKey(key), version: pricingVersion(body, true), reason: pricingReason(body) },
    );
  }

  @Get(':ratePlanId/rules')
  @RequiresCapability('calendar.view')
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
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  createRule(
    @Param('ratePlanId') ratePlanId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.createRule(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      request.tenantContext.userId,
      body,
      { key: pricingKey(key), version: pricingVersion(body, false) },
    );
  }

  @Patch(':ratePlanId/rules/:rateRuleId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  updateRule(
    @Param('ratePlanId') ratePlanId: string,
    @Param('rateRuleId') rateRuleId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.updateRule(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      rateRuleId,
      request.tenantContext.userId,
      body,
      { key: pricingKey(key), version: pricingVersion(body, true) },
    );
  }

  @Delete(':ratePlanId/rules/:rateRuleId')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  @RequiresVerifiedEmail()
  removeRule(
    @Param('ratePlanId') ratePlanId: string,
    @Param('rateRuleId') rateRuleId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.ratePlans.removeRule(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      ratePlanId,
      rateRuleId,
      request.tenantContext.userId,
      { key: pricingKey(key), version: pricingVersion(body, true) },
    );
  }
}
