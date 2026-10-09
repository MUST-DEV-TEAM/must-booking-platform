import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { EmailActivityService } from './email-activity.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type RequestContext = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

/** Every email this property sent, and "send again" for failed ones (email plan Step 4). */
@Controller('tenants/:tenantId/properties/:propertyId/email-activity')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailActivityController {
  constructor(@Inject(EmailActivityService) private readonly activity: EmailActivityService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  list(@Query() query: Record<string, unknown>, @Req() request: RequestContext) {
    return this.activity.list(this.context(request), query ?? {});
  }

  @Post(':messageId/resend')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  resend(@Param('messageId') messageId: string, @Req() request: RequestContext) {
    return this.activity.resend(this.context(request), request.tenantContext.userId, messageId);
  }

  private context(request: RequestContext) {
    return {
      tenantId: request.tenantContext.tenantId,
      propertyId: request.tenantContext.propertyId,
    };
  }
}

/** Who this property's emails come from (email plan Step 4; own domains come in Step 5). */
@Controller('tenants/:tenantId/properties/:propertyId/email-sender')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailSenderController {
  constructor(@Inject(EmailActivityService) private readonly activity: EmailActivityService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() request: RequestContext) {
    return this.activity.sender({
      tenantId: request.tenantContext.tenantId,
      propertyId: request.tenantContext.propertyId,
    });
  }
}
