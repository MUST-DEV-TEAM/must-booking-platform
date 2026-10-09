import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { EmailTemplatesService } from './email-templates.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type RequestContext = { tenantContext: { tenantId: string; propertyId: string; userId: string } };

/** A property's own wording for its guest emails (email plan Step 3). */
@Controller('tenants/:tenantId/properties/:propertyId/email-templates')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailTemplatesController {
  constructor(@Inject(EmailTemplatesService) private readonly templates: EmailTemplatesService) {}

  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  list(@Req() request: RequestContext) {
    return this.templates.list(this.context(request));
  }

  @Put(':key')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  update(@Param('key') key: string, @Body() body: object, @Req() request: RequestContext) {
    return this.templates.update(
      this.context(request),
      request.tenantContext.userId,
      key,
      body ?? {},
    );
  }

  @Delete(':key')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  reset(@Param('key') key: string, @Req() request: RequestContext) {
    return this.templates.reset(this.context(request), request.tenantContext.userId, key);
  }

  @Post(':key/preview')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  preview(@Param('key') key: string, @Body() body: object, @Req() request: RequestContext) {
    return this.templates.preview(this.context(request), key, body ?? {});
  }

  @Post(':key/test')
  @HttpCode(200)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  sendTest(@Param('key') key: string, @Body() body: object, @Req() request: RequestContext) {
    return this.templates.sendTest(
      this.context(request),
      request.tenantContext.userId,
      key,
      body ?? {},
    );
  }

  private context(request: RequestContext) {
    return {
      tenantId: request.tenantContext.tenantId,
      propertyId: request.tenantContext.propertyId,
    };
  }
}
