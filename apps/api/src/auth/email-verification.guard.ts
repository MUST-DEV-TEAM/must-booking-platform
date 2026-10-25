import { AuditLogService } from '../tenancy/audit-log.service';
import { auditDenial } from '../tenancy/audit-denial';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthService } from './auth.service';
import { VERIFIED_EMAIL_REQUIRED } from './requires-verified-email.decorator';

@Injectable()
export class EmailVerificationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(VERIFIED_EMAIL_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const scope = context.switchToHttp().getRequest<{
      tenantContext?: { tenantId: string; propertyId?: string; userId: string };
    }>().tenantContext;
    if (!scope?.userId || !(await this.auth.isEmailVerified(scope.userId))) {
      await auditDenial(this.audit, scope, 'VERIFIED_EMAIL_REQUIRED');
      throw new ForbiddenException('Verify your email before performing this action.');
    }
    return true;
  }
}
