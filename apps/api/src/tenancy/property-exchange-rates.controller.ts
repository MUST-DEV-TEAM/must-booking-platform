import { Body, Controller, Delete, Get, Inject, Param, Patch, Put, Req } from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { PropertyExchangeRatesService } from './property-exchange-rates.service';

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/exchange-rates')
@Roles(Role.TenantOwner, Role.TenantAdmin)
@RequiresCapability('settings.manage')
export class PropertyExchangeRatesController {
  constructor(
    @Inject(PropertyExchangeRatesService) private readonly rates: PropertyExchangeRatesService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  list(@Req() request: Request) {
    const { tenantId, propertyId } = request.tenantContext;
    return this.rates.snapshot(tenantId, propertyId);
  }
  @Put(':currency')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  set(@Param('currency') currency: string, @Body() body: unknown, @Req() request: Request) {
    const { tenantId, propertyId, userId } = request.tenantContext;
    return this.rates.set(
      tenantId,
      propertyId,
      userId,
      currency,
      (body as { rate?: unknown } | null)?.rate ?? undefined,
    );
  }
  @Delete(':currency')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  remove(@Param('currency') currency: string, @Req() request: Request) {
    const { tenantId, propertyId, userId } = request.tenantContext;
    return this.rates.set(tenantId, propertyId, userId, currency, null);
  }
  @Patch()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresVerifiedEmail()
  select(@Body() body: unknown, @Req() request: Request) {
    const { tenantId, propertyId } = request.tenantContext;
    return this.rates.select(
      tenantId,
      propertyId,
      (body as { currencies?: unknown } | null)?.currencies,
    );
  }
}
