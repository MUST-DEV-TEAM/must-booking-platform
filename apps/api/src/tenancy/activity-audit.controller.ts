import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { ActivityAuditService, type AuditContext } from './activity-audit.service';
import { Roles, Role } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
type Request = { tenantContext: AuditContext };
@Controller('tenants/:tenantId/properties/:propertyId/activity-audit')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class ActivityAuditController {
  constructor(@Inject(ActivityAuditService) private readonly audit: ActivityAuditService) {}
  @Get() @TenantScoped({ propertyParam: 'propertyId' }) list(
    @Req() req: Request,
    @Query() query: Record<string, unknown>,
  ) {
    return this.audit.list(req.tenantContext, query);
  }
  @Get(':eventId') @TenantScoped({ propertyParam: 'propertyId' }) detail(
    @Req() req: Request,
    @Param('eventId') id: string,
  ) {
    return this.audit.detail(req.tenantContext, id);
  }
  @Post('export') @RequiresVerifiedEmail() @TenantScoped({ propertyParam: 'propertyId' }) export(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    return this.audit.export(req.tenantContext, body, key);
  }
}
