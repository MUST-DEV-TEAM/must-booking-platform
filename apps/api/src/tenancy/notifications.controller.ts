import { Controller, Get, Inject, Param, Patch, Query, Req } from '@nestjs/common';

import { NotificationsService } from './notifications.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

@Controller('tenants/:tenantId/properties/:propertyId/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  list(
    @Query() query: unknown,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.notifications.list(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      query,
    );
  }

  @Patch(':notificationId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
  markRead(
    @Param('notificationId') notificationId: string,
    @Req() request: { tenantContext: { tenantId: string; propertyId: string } },
  ) {
    return this.notifications.markRead(
      request.tenantContext.tenantId,
      request.tenantContext.propertyId,
      notificationId,
    );
  }
}
