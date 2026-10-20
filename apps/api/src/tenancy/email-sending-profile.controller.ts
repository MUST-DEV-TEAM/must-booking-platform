import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Put,
  Req,
  Post,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { RequiresCapability } from './capabilities.decorator';
import { EmailSendingProfileService } from './email-sending-profile.service';
import { EmailSenderVerificationService } from './email-sender-verification.service';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
/** Store a hotel's pending sender setup; only verified sender activation can change delivery. */
@Controller('tenants/:tenantId/properties/:propertyId/email-configuration/sending')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailSendingProfileController {
  constructor(
    @Inject(EmailSendingProfileService) private readonly profiles: EmailSendingProfileService,
    @Inject(EmailSenderVerificationService)
    private readonly senderProofs: EmailSenderVerificationService,
  ) {}
  @Get('verify-from/:verificationId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  proof(@Req() request: Request, @Param('verificationId', new ParseUUIDPipe()) id: string) {
    return this.senderProofs.get(request.tenantContext, id);
  }
  @Post('verify-from')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  requestProof(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.senderProofs.request(
      request.tenantContext,
      request.tenantContext.userId,
      body ?? {},
      key,
    );
  }
  @Post('verify-from/confirm')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  confirmProof(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.senderProofs.confirm(
      request.tenantContext,
      request.tenantContext.userId,
      body ?? {},
      key,
    );
  }
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() request: Request) {
    return this.profiles.get(request.tenantContext);
  }
  @Get('operations/:operationId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  operation(@Req() request: Request, @Param('operationId', new ParseUUIDPipe()) id: string) {
    return this.profiles.operation(request.tenantContext, id);
  }
  @Post('check')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  check(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.profiles.check(
      request.tenantContext,
      request.tenantContext.userId,
      body ?? {},
      key,
    );
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
