import { Body, Controller, Get, Headers, Inject, Param, Patch, Query, Req } from '@nestjs/common';
import { NotificationInboxService, type InboxContext } from './notification-inbox.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
type Request = { tenantContext: InboxContext };
@Controller('tenants/:tenantId/properties/:propertyId/notifications')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class NotificationsController {
  constructor(@Inject(NotificationInboxService) private readonly inbox: NotificationInboxService) {}
  @TenantScoped({ propertyParam: 'propertyId' }) @Get() list(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.inbox.list(req.tenantContext, query);
  }
  @TenantScoped({ propertyParam: 'propertyId' }) @Get(':notificationId') detail(
    @Param('notificationId') id: string,
    @Req() req: Request,
  ) {
    return this.inbox.detail(req.tenantContext, id);
  }
  @TenantScoped({ propertyParam: 'propertyId' })
  @Patch('mark-all-read')
  @RequiresVerifiedEmail()
  all(
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
  ) {
    return this.inbox.mark(req.tenantContext, 'all', body, key);
  }
  @TenantScoped({ propertyParam: 'propertyId' })
  @Patch('mark-visible-read')
  @RequiresVerifiedEmail()
  visible(
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
  ) {
    return this.inbox.mark(req.tenantContext, 'visible', body, key);
  }
  @TenantScoped({ propertyParam: 'propertyId' })
  @Patch(':notificationId')
  @RequiresVerifiedEmail()
  one(
    @Param('notificationId') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: Request,
  ) {
    return this.inbox.mark(req.tenantContext, 'single', body, key, id);
  }
}
