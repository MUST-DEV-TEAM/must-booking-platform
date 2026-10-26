import {
  Body,
  NotFoundException,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { InventoryRestrictionsService } from './inventory-restrictions.service';
type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/inventory/restrictions')
export class InventoryRestrictionsController {
  constructor(
    @Inject(InventoryRestrictionsService)
    private readonly restrictions: InventoryRestrictionsService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  list(@Req() r: Request) {
    return this.restrictions.list(r.tenantContext.tenantId, r.tenantContext.propertyId);
  }
  @Get(':id')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  get(@Param('id') id: string, @Req() r: Request) {
    return this.restrictions.get(r.tenantContext.tenantId, r.tenantContext.propertyId, id);
  }
  @Get(':id/history')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.view')
  history(@Param('id') id: string, @Req() r: Request) {
    return this.restrictions.history(r.tenantContext.tenantId, r.tenantContext.propertyId, id);
  }
  @Post('validate')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  validate(@Body() body: unknown, @Req() r: Request) {
    return this.restrictions.validate(r.tenantContext.tenantId, r.tenantContext.propertyId, body);
  }
  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  create(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.change(r, key, 'create', undefined, body);
  }
  @Patch(':id')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.change(r, key, 'edit', id, body);
  }
  @Post(':id/:action')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  action(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    if (!['activate', 'pause', 'archive', 'duplicate'].includes(action)) return this.unsupported();
    return this.change(r, key, action as 'activate' | 'pause' | 'archive' | 'duplicate', id, body);
  }
  @Delete(':id')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('calendar.block')
  @RequiresVerifiedEmail()
  delete(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.change(r, key, 'delete', id, body);
  }
  private change(
    r: Request,
    key: string | undefined,
    action: Parameters<InventoryRestrictionsService['mutate']>[4],
    id: string | undefined,
    body: unknown,
  ) {
    return this.restrictions.mutate(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      r.tenantContext.userId,
      key,
      action,
      id,
      body,
    );
  }
  private unsupported(): never {
    throw new NotFoundException('Restriction action was not found.');
  }
}
