import { Controller, Get, Inject, Req } from '@nestjs/common';

import { TenantScoped } from './tenant-context.decorator';
import { PlanUsage, PlanUsageService } from './plan-usage.service';

@Controller('tenants/:tenantId')
export class PlanUsageController {
  constructor(@Inject(PlanUsageService) private readonly planUsage: PlanUsageService) {}

  @Get('plan-usage')
  @TenantScoped()
  get(@Req() request: { tenantContext: { tenantId: string } }): Promise<PlanUsage> {
    return this.planUsage.get(request.tenantContext.tenantId);
  }
}
