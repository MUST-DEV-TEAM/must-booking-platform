import { Body, Controller, Get, HttpCode, Inject, Put, Query, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { AvailabilityService } from './availability.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId')
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}

  @Get('availability')
  @TenantScoped({ propertyParam: 'propertyId' })
  getAvailability(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    return this.availability.getAvailability(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }

  @Put('inventory-units')
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin)
  @RequiresVerifiedEmail()
  setInventory(
    @Body() body: unknown,
    @Req() request: TenantPropertyRequest & { tenantContext: { userId: string } },
  ) {
    return this.availability.setInventory(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }
}
