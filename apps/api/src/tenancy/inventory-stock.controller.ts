import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { InventoryStockService } from './inventory-stock.service';
type Request = { tenantContext: { tenantId: string; propertyId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/inventory/stock')
export class InventoryStockController {
  constructor(@Inject(InventoryStockService) private readonly stock: InventoryStockService) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  grid(@Query() query: unknown, @Req() r: Request) {
    return this.stock.grid(r.tenantContext.tenantId, r.tenantContext.propertyId, query);
  }
  @Post('preview')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  preview(@Body() body: unknown, @Req() r: Request) {
    return this.stock.preview(r.tenantContext.tenantId, r.tenantContext.propertyId, body);
  }
}
