import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

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

  @Get('overview')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  overview(@Req() request: RequestContext) {
    return this.activity.overview(this.context(request));
  }

  @Get(':messageId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  detail(@Param('messageId') messageId: string, @Req() request: RequestContext) {
    return this.activity.detail(this.context(request), messageId);
  }

  @Post(':messageId/retry')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  retry(
    @Param('messageId') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RequestContext,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.activity.retry(
      this.context(request),
      request.tenantContext.userId,
      id,
      body ?? {},
      key,
    );
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
