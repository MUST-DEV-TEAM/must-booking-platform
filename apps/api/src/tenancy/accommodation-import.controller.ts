import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { AccommodationImportService } from './accommodation-import.service';
import { Role, Roles } from './roles.decorator';

type TenantPropertyRequest = {
  tenantContext: { tenantId: string; propertyId: string; userId: string };
};

/** Property-scoped dry-run and confirmation routes for accommodation CSV imports. */
@Controller('tenants/:tenantId/properties/:propertyId/accommodations/import')
export class AccommodationImportController {
  constructor(
    @Inject(AccommodationImportService) private readonly imports: AccommodationImportService,
  ) {}

  @Post('preview')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  @RequiresVerifiedEmail()
  preview(@Body() body: unknown, @Req() request: TenantPropertyRequest) {
    return this.imports.preview(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      body,
    );
  }

  @Post('confirm')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('accommodations.manage')
  @RequiresVerifiedEmail()
  confirm(@Body() body: unknown, @Req() request: TenantPropertyRequest) {
    return this.imports.confirm(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      request.tenantContext.userId,
      body,
    );
  }
}
