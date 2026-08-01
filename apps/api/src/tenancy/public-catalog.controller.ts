import { Controller, Get, Inject, Req } from '@nestjs/common';

import { PublicTenantScoped } from './tenant-context.decorator';
import { PublicCatalogService } from './public-catalog.service';

@Controller('tenants/:tenantId/properties/:propertyId/public')
export class PublicCatalogController {
  constructor(@Inject(PublicCatalogService) private readonly catalog: PublicCatalogService) {}

  @Get('catalog')
  @PublicTenantScoped({ propertyParam: 'propertyId' })
  getCatalog(@Req() request: { tenantContext: { tenantId: string; propertyId: string } }) {
    return this.catalog.getCatalog(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
    );
  }
}
