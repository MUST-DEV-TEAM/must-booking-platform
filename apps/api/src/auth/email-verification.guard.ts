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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(VERIFIED_EMAIL_REQUIRED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const userId = context.switchToHttp().getRequest<{ tenantContext?: { userId: string } }>()
      .tenantContext?.userId;
    if (!userId || !(await this.auth.isEmailVerified(userId))) {
      throw new ForbiddenException('Verify your email before performing this action.');
    }
    return true;
  }
}
