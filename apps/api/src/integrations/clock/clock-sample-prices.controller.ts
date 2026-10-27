import { Controller, Get, Inject, Param, Req } from '@nestjs/common';

import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { ClockSamplePricesService, type ClockSamplePrices } from './clock-sample-prices.service';

type TenantRequest = { tenantContext: { tenantId: string } };

/** What each Clock rate costs for one fixed sample stay, for the staff Rates & Pricing screen. */
@Controller('tenants/:tenantId/properties/:propertyId/clock-sample-prices')
export class ClockSamplePricesController {
  constructor(
    @Inject(ClockSamplePricesService) private readonly samples: ClockSamplePricesService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('rates.manage')
  get(
    @Param('propertyId') propertyId: string,
    @Req() request: TenantRequest,
  ): Promise<ClockSamplePrices> {
    return this.samples.sample(request.tenantContext.tenantId, propertyId);
  }
}
