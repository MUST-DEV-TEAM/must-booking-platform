import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { PricingService, type PricingKind } from './pricing.service';
type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/pricing')
@RequiresCapability('rates.manage')
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}
  @Get() @TenantScoped({ propertyParam: 'propertyId' }) workspace(@Req() r: Request) {
    return this.pricing.workspace(r.tenantContext.tenantId, r.tenantContext.propertyId);
  }
  @Get('calendar') @TenantScoped({ propertyParam: 'propertyId' }) calendar(
    @Query() q: unknown,
    @Req() r: Request,
  ) {
    return this.pricing.calendar(r.tenantContext.tenantId, r.tenantContext.propertyId, q);
  }
  @Get('issues') @TenantScoped({ propertyParam: 'propertyId' }) async issues(@Req() r: Request) {
    return (await this.pricing.workspace(r.tenantContext.tenantId, r.tenantContext.propertyId))
      .issues;
  }
  @Get('history/:kind/:id') @TenantScoped({ propertyParam: 'propertyId' }) history(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Req() r: Request,
  ) {
    return this.pricing.history(r.tenantContext.tenantId, r.tenantContext.propertyId, kind, id);
  }
  @Post('preview') @TenantScoped({ propertyParam: 'propertyId' }) preview(
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.pricing.preview(r.tenantContext.tenantId, r.tenantContext.propertyId, b);
  }
  @Post('base-prices/preview')
  @RequiresVerifiedEmail()
  @TenantScoped({ propertyParam: 'propertyId' })
  previewBase(@Body() b: unknown, @Req() r: Request) {
    return this.pricing.previewBase(r.tenantContext.tenantId, r.tenantContext.propertyId, b);
  }
  @Put('base-prices')
  @RequiresVerifiedEmail()
  @TenantScoped({ propertyParam: 'propertyId' })
  applyBase(
    @Body() b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.pricing.applyBase(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      r.tenantContext.userId,
      key,
      b,
    );
  }
  @Post(':kind') @RequiresVerifiedEmail() @TenantScoped({ propertyParam: 'propertyId' }) create(
    @Param('kind') kind: PricingKind,
    @Body() b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.pricing.change(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      r.tenantContext.userId,
      key,
      kind,
      undefined,
      'create',
      b,
    );
  }
  @Patch(':kind/:id') @RequiresVerifiedEmail() @TenantScoped({ propertyParam: 'propertyId' }) edit(
    @Param('kind') kind: PricingKind,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.pricing.change(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      r.tenantContext.userId,
      key,
      kind,
      id,
      'edit',
      b,
    );
  }
  @Post(':kind/:id/:action')
  @RequiresVerifiedEmail()
  @TenantScoped({ propertyParam: 'propertyId' })
  action(
    @Param('kind') kind: PricingKind,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() b: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Req() r: Request,
  ) {
    return this.pricing.change(
      r.tenantContext.tenantId,
      r.tenantContext.propertyId,
      r.tenantContext.userId,
      key,
      kind,
      id,
      action,
      b,
    );
  }
}
