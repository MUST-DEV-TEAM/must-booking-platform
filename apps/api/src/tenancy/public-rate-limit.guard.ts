import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { PUBLIC_RATE_LIMIT, type PublicRateLimitOptions } from './public-rate-limit.decorator';
import { PublicRateLimiterService } from './public-rate-limiter.service';

type PublicRequest = IncomingMessage & {
  params: Record<string, string | undefined>;
  tenantContext?: { tenantId: string; propertyId?: string };
  socket: { remoteAddress?: string };
};

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PublicRateLimiterService) private readonly limiter: PublicRateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<PublicRateLimitOptions>(PUBLIC_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<PublicRequest>();
    const response = context.switchToHttp().getResponse<ServerResponse>();
    const result = await this.limiter.consume(
      options,
      request.socket.remoteAddress ?? 'unknown',
      request.tenantContext?.tenantId ?? request.params.tenantId,
      request.tenantContext?.propertyId ?? request.params.propertyId,
    );
    if (result.allowed) return true;

    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException(
      'Too many requests. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
