import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { currentAuditContext } from '../../tenancy/audit-request-context';
import { PlatformAuditService } from './platform-audit.service';
import {
  PLATFORM_AUTHENTICATED,
  PLATFORM_CAPABILITY,
  PLATFORM_CONSOLE,
  PLATFORM_PUBLIC,
  type PlatformRequestContext,
} from './platform-console.decorators';
import { PLATFORM_COOKIE, PlatformSessionService } from './platform-session.service';

type ConsoleRequest = {
  method: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  platformCtx?: PlatformRequestContext;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((part) => part.trim().split('=', 2))
    .find(([key]) => key === name)?.[1];
}

export function clientIp(request: ConsoleRequest): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return (first || request.ip || request.socket?.remoteAddress || null)?.slice(0, 64) ?? null;
}

/**
 * Guards every route of a @PlatformConsole() controller. Fails closed: a route that is neither
 * public nor authenticated-only must declare a capability, and the caller must hold it.
 */
@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PlatformSessionService) private readonly sessions: PlatformSessionService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (!this.reflector.get<boolean>(PLATFORM_CONSOLE, context.getClass())) return true;

    const request = context.switchToHttp().getRequest<ConsoleRequest>();
    this.requireSameSiteIntent(request);

    const ctx: PlatformRequestContext = {
      actor: null,
      ip: clientIp(request),
      userAgent: this.header(request, 'user-agent')?.slice(0, 300) ?? null,
      requestId: currentAuditContext()?.requestId ?? null,
      audited: false,
      hint: {},
    };
    request.platformCtx = ctx;

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_PUBLIC, targets)) return true;

    ctx.actor = await this.sessions.authenticate(
      readCookie(this.header(request, 'cookie'), PLATFORM_COOKIE),
    );
    if (!ctx.actor) throw new UnauthorizedException('A valid platform session is required.');

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_AUTHENTICATED, targets)) return true;

    const required = this.reflector.getAllAndOverride<string>(PLATFORM_CAPABILITY, targets);
    if (!required || !ctx.actor.capabilities.includes(required)) {
      await this.audit.record(ctx, {
        action: 'platform.access.denied',
        result: 'denied',
        details: {
          method: request.method,
          route: currentAuditContext()?.route ?? null,
          requiredCapability: required ?? null,
        },
      });
      throw new ForbiddenException('Your platform role does not allow this.');
    }
    return true;
  }

  /** Cheap CSRF defence on top of SameSite=Strict: a custom header and a matching Origin. */
  private requireSameSiteIntent(request: ConsoleRequest): void {
    if (SAFE_METHODS.has(request.method.toUpperCase())) return;
    if (this.header(request, 'x-platform-console') !== '1')
      throw new ForbiddenException('Missing console request header.');
    const origin = this.header(request, 'origin');
    const allowed = process.env.WEB_APP_URL?.trim();
    if (origin && allowed) {
      let expected: string;
      try {
        expected = new URL(allowed).origin;
      } catch {
        expected = allowed;
      }
      if (origin !== expected) throw new ForbiddenException('Request origin is not allowed.');
    }
  }

  private header(request: ConsoleRequest, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
