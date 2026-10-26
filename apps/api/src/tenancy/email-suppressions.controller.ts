import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { AuditLogService } from './audit-log.service';
import { RequiresCapability } from './capabilities.decorator';
import { emailWrite, type EmailContext } from './email-workspace-writes';
import { Role, Roles } from './roles.decorator';
import { TenantScoped } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';
type Request = { tenantContext: EmailContext & { userId: string } };
export type Suppression = {
  recipient: string;
  reason: string;
  version: number;
  active: boolean;
  updatedAt: Date;
};
@Injectable()
export class EmailSuppressionsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  list(c: EmailContext) {
    return this.database.withTenantTransaction(
      c,
      (tx) =>
        tx.$queryRaw<
          Suppression[]
        >`SELECT recipient,reason,version,active,updated_at AS "updatedAt" FROM email_suppressions WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND active ORDER BY updated_at DESC LIMIT 1000`,
    );
  }
  clear(c: EmailContext, userId: string, body: Record<string, unknown>, key?: string) {
    const recipient = typeof body.recipient === 'string' ? body.recipient.trim().toLowerCase() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (
      !recipient ||
      recipient.length > 254 ||
      reason.length < 3 ||
      reason.length > 300 ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 1
    )
      throw new BadRequestException(
        'Recipient, positive version and a reason of 3-300 characters are required.',
      );
    return emailWrite(
      this.database,
      this.audit,
      c,
      userId,
      key,
      'email.suppression.cleared',
      recipient,
      { recipient, reason, version: body.version },
      async (tx) => {
        const rows = await tx.$queryRaw<
          Suppression[]
        >`SELECT recipient,reason,version,active,updated_at AS "updatedAt" FROM email_suppressions WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND recipient=${recipient} FOR UPDATE`;
        const before = rows[0];
        if (!before) throw new NotFoundException('Suppression was not found.');
        if (before.version !== body.version || !before.active)
          throw new ConflictException('Suppression changed. Reload before clearing.');
        await tx.$executeRaw`UPDATE email_suppressions SET active=false,version=version+1,cleared_at=now(),updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND recipient=${recipient}`;
        const after = { recipient, active: false, version: before.version + 1 };
        return { response: after, details: { before, after, reason } };
      },
    );
  }
}
@Controller('tenants/:tenantId/properties/:propertyId/email-suppressions')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class EmailSuppressionsController {
  constructor(
    @Inject(EmailSuppressionsService) private readonly service: EmailSuppressionsService,
  ) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  get(@Req() r: Request) {
    return this.service.list(r.tenantContext);
  }
  @Post('clear')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  clear(
    @Req() r: Request,
    @Body() b: Record<string, unknown>,
    @Headers('idempotency-key') k?: string,
  ) {
    return this.service.clear(r.tenantContext, r.tenantContext.userId, b ?? {}, k);
  }
}
