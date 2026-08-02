import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_CAPABILITY } from './capabilities.decorator';
import { CapabilitiesService } from './capabilities.service';

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<string>(REQUIRED_CAPABILITY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!capability) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ tenantContext?: { userId: string; tenantId: string; propertyId?: string } }>();
    const tenantContext = request.tenantContext;
    if (!tenantContext)
      throw new ForbiddenException('A tenant context is required for capability checks.');
    const allowed = (await this.capabilities.effective(tenantContext)).includes(capability);
    if (!allowed) throw new ForbiddenException('Missing required capability.');
    return true;
  }
}
