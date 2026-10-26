import { Controller, Get, Inject, Req } from '@nestjs/common';

import { RequiresCapability } from './capabilities.decorator';
import { PropertyCurrencyService } from './property-currency.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type TenantRequest = { tenantContext: { tenantId: string; propertyId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/currency')
export class PropertyCurrencyController {
  constructor(
    @Inject(PropertyCurrencyService) private readonly currencies: PropertyCurrencyService,
  ) {}

  /** The hotel's money currency and where it comes from, for the settings page. */
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('settings.manage')
  get(@Req() request: TenantRequest) {
    return this.currencies.resolve(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }
}
