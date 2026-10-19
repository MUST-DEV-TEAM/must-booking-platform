import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { EmailTemplateVersionsService } from './email-template-versions.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/email-template-versions')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailTemplateVersionsController {
  constructor(
    @Inject(EmailTemplateVersionsService) private readonly templates: EmailTemplateVersionsService,
  ) {}
  @Get(':key')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  list(@Req() request: Request, @Param('key') key: string, @Query('language') language?: string) {
    return this.templates.list(request.tenantContext, key, language);
  }
  @Put(':key/draft')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  draft(
    @Req() request: Request,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.templates.mutate(
      request.tenantContext,
      request.tenantContext.userId,
      key,
      'draft',
      body ?? {},
      idempotencyKey,
    );
  }
  @Post(':key/publish')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  publish(
    @Req() request: Request,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.templates.mutate(
      request.tenantContext,
      request.tenantContext.userId,
      key,
      'publish',
      body ?? {},
      idempotencyKey,
    );
  }
  @Post(':key/restore')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  restore(
    @Req() request: Request,
    @Param('key') key: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.templates.mutate(
      request.tenantContext,
      request.tenantContext.userId,
      key,
      'restore',
      body ?? {},
      idempotencyKey,
    );
  }
}
