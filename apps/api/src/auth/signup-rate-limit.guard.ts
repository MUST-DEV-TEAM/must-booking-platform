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

import { SIGNUP_RATE_LIMITED } from './signup-rate-limit.decorator';
import { SignupRateLimiterService } from './signup-rate-limiter.service';

type SignupRequest = IncomingMessage & {
  body?: { email?: unknown };
  socket: { remoteAddress?: string };
};

@Injectable()
export class SignupRateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SignupRateLimiterService) private readonly limiter: SignupRateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limited = this.reflector.getAllAndOverride<boolean>(SIGNUP_RATE_LIMITED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!limited) return true;

    const request = context.switchToHttp().getRequest<SignupRequest>();
    const response = context.switchToHttp().getResponse<ServerResponse>();
    const email = typeof request.body?.email === 'string' ? request.body.email : '';
    const result = await this.limiter.consume(this.clientIp(request), email);
    if (result.allowed) return true;

    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new HttpException(
      'Too many signup attempts. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private clientIp(request: SignupRequest): string {
    return request.socket.remoteAddress ?? 'unknown';
  }
}
