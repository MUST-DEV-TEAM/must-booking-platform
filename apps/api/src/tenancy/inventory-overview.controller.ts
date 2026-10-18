import { Body, Controller, Get, Inject, Post, Req } from '@nestjs/common';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { InventoryOverviewService } from './inventory-overview.service';
type Request = { tenantContext: { tenantId: string; propertyId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/inventory')
export class InventoryOverviewController {
  constructor(
    @Inject(InventoryOverviewService) private readonly inventory: InventoryOverviewService,
  ) {}
  @Get('overview')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  overview(@Req() r: Request) {
    return this.inventory.overview(r.tenantContext.tenantId, r.tenantContext.propertyId);
  }
  @Post('preview')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  preview(@Req() r: Request, @Body() body: unknown) {
    return this.inventory.preview(r.tenantContext.tenantId, r.tenantContext.propertyId, body);
  }
  @Get('conflicts')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  conflicts(@Req() r: Request) {
    return this.inventory.conflicts(r.tenantContext.tenantId, r.tenantContext.propertyId);
  }
}
