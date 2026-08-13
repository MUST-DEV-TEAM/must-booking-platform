import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';

import { PublicTenantScoped } from './tenant-context.decorator';
import { PublicCatalogService } from './public-catalog.service';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { PUBLIC_READ_RATE_LIMIT, PublicRateLimit } from './public-rate-limit.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/public')
export class PublicCatalogController {
  constructor(@Inject(PublicCatalogService) private readonly catalog: PublicCatalogService) {}

  @Get('catalog')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  @UseGuards(PublicRateLimitGuard)
  @PublicRateLimit(PUBLIC_READ_RATE_LIMIT)
  getCatalog(
    @Query() query: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.catalog.getCatalog(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }
}
