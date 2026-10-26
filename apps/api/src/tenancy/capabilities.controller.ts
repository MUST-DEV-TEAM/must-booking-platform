import { Controller, Get, Inject, Req } from '@nestjs/common';
import { RequiresCapability } from './capabilities.decorator';
import { CAPABILITY_CATALOG } from './capability-catalog';
import { CapabilitiesService } from './capabilities.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
@Controller('tenants/:tenantId/properties/:propertyId/capabilities')
export class CapabilitiesController {
  constructor(@Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService) {}
  @Get('mine')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  mine(@Req() r: { tenantContext: { tenantId: string; propertyId: string; userId: string } }) {
    return this.capabilities.effective(r.tenantContext);
  }
  @Get('catalog')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  @RequiresCapability('staff.view')
  catalog() {
    return CAPABILITY_CATALOG;
  }
}
