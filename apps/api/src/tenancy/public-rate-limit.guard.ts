import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { PUBLIC_RATE_LIMIT, type PublicRateLimitOptions } from './public-rate-limit.decorator';
import { PublicRateLimiterService } from './public-rate-limiter.service';
import { HOTEL_CEILING_FACTOR, trustedVisitorAddress } from './public-website-client';

type PublicRequest = IncomingMessage & {
  params: Record<string, string | undefined>;
  tenantContext?: { tenantId: string; propertyId?: string };
  socket: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
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
    const tenantId = request.tenantContext?.tenantId ?? request.params.tenantId;
    const propertyId = request.tenantContext?.propertyId ?? request.params.propertyId;
    // The hotel's own website may name its visitor; everyone else is counted by the address we see.
    const visitor = options.scopeParam ? null : trustedVisitorAddress(request.headers, propertyId);
    let result = await this.limiter.consume(
      options,
      options.scopeParam
        ? `${options.scopeParam}:${request.params[options.scopeParam] ?? ''}`
        : visitor
          ? `visitor:${visitor}`
          : (request.socket.remoteAddress ?? 'unknown'),
      tenantId,
      propertyId,
    );
    // Only requests a visitor was allowed to make count towards the hotel's ceiling.
    if (result.allowed && visitor)
      result = await this.limiter.consume(
        {
          ...options,
          name: `${options.name}:website`,
          maximum: options.maximum * HOTEL_CEILING_FACTOR,
        },
        'website',
        tenantId,
        propertyId,
      );
    if (result.allowed) return true;

    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException(
      'Too many requests. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
