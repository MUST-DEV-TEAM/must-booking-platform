import { Body, Controller, Get, Inject, Param, Put, Req } from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { NotificationSettingsService } from './notification-settings.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type RequestContext = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

@Controller('tenants/:tenantId/properties/:propertyId/notification-settings')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class NotificationSettingsController {
  constructor(
    @Inject(NotificationSettingsService) private readonly settings: NotificationSettingsService,
  ) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() request: RequestContext) {
    const c = request.tenantContext;
    return this.settings.get(c.tenantId, c.propertyId);
  }

  @Put(':topic')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  update(@Param('topic') topic: string, @Body() body: unknown, @Req() request: RequestContext) {
    const c = request.tenantContext;
    return this.settings.update(c.tenantId, c.propertyId, c.userId, topic, body);
  }
}

/** Each member's own email preferences: mute the non-urgent staff emails. */
@Controller('tenants/:tenantId/my-email-preferences')
export class EmailPreferencesController {
  constructor(
    @Inject(NotificationSettingsService) private readonly settings: NotificationSettingsService,
  ) {}

  @Get()
  @TenantScoped()
  get(@Req() request: { tenantContext: { tenantId: string; userId: string } }) {
    const c = request.tenantContext;
    return this.settings.getPreferences(c.tenantId, c.userId);
  }

  @Put()
  @TenantScoped()
  update(
    @Body() body: object,
    @Req() request: { tenantContext: { tenantId: string; userId: string } },
  ) {
    const c = request.tenantContext;
    return this.settings.updatePreferences(c.tenantId, c.userId, body ?? {});
  }
}
