import { Body, Controller, Get, Headers, Inject, Put, Req } from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { EmailSendingProfileService } from './email-sending-profile.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
/** Store a hotel's pending sender setup; only verified sender activation can change delivery. */
@Controller('tenants/:tenantId/properties/:propertyId/email-configuration/sending')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailSendingProfileController {
  constructor(
    @Inject(EmailSendingProfileService) private readonly profiles: EmailSendingProfileService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() request: Request) {
    return this.profiles.get(request.tenantContext);
  }
  @Put()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  update(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.profiles.update(
      request.tenantContext,
      request.tenantContext.userId,
      body ?? {},
      key,
    );
  }
}
