import { Controller, Get, Inject, Query, Req } from '@nestjs/common';

import { PublicTenantScoped } from './tenant-context.decorator';
import { AvailabilityService } from './availability.service';

type TenantPropertyRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/public')
export class PublicAvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly availability: AvailabilityService) {}

  @Get('availability')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  getAvailability(@Query() query: unknown, @Req() request: TenantPropertyRequest) {
    return this.availability.getAvailability(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }
}
