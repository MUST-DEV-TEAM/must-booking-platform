import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';

import { PlatformAuditService } from './platform-audit.service';
import {
  PLATFORM_AUDIT,
  PLATFORM_CONSOLE,
  PLATFORM_NO_IDEMPOTENCY,
  PLATFORM_PUBLIC,
  type PlatformAuditOptions,
  type PlatformRequestContext,
} from './platform-console.decorators';
import { PlatformIdempotencyService, requestHash } from './platform-idempotency.service';

type RouteRequest = {
  method: string;
  originalUrl?: string;
  params: Record<string, string | undefined>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  platformCtx?: PlatformRequestContext;
  route?: { path?: string };
};
type RouteResponse = { statusCode: number; status(code: number): unknown };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * For every mutating console route: the route must declare an audit action (otherwise it is
 * refused, fail closed), an Idempotency-Key is honoured, and an audit row is guaranteed. Services
 * normally write a richer audit row inside their own transaction; the row written here is the
 * fallback, and the only one for failed requests.
 */
@Injectable()
export class PlatformRouteInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(PlatformIdempotencyService) private readonly idempotency: PlatformIdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(PLATFORM_CONSOLE, context.getClass())) return next.handle();
    const request = context.switchToHttp().getRequest<RouteRequest>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return next.handle();
    return from(this.mutating(context, next, request));
  }

  private async mutating(
    context: ExecutionContext,
    next: CallHandler,
    request: RouteRequest,
  ): Promise<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = this.reflector.get<PlatformAuditOptions | undefined>(
      PLATFORM_AUDIT,
      context.getHandler(),
    );
    if (!meta) throw new InternalServerErrorException('This console route is not audited.');
    const ctx = request.platformCtx;
    if (!ctx) throw new InternalServerErrorException('Platform context is missing.');

    const isPublic = this.reflector.getAllAndOverride<boolean>(PLATFORM_PUBLIC, targets);
    const skipIdempotency = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_NO_IDEMPOTENCY,
      targets,
    );
    const response = context.switchToHttp().getResponse<RouteResponse>();
    let key: string | null = null;

    if (!isPublic && !skipIdempotency && ctx.actor) {
      const header = request.headers['idempotency-key'];
      key = (Array.isArray(header) ? header[0] : header)?.trim() ?? null;
      if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key))
        throw new BadRequestException('A valid Idempotency-Key header is required.');
      const route = `${request.method.toUpperCase()} ${request.route?.path ?? request.originalUrl ?? ''}`;
      const claim = await this.idempotency.begin(
        ctx.actor.accountId,
        key,
        route,
        requestHash(route + JSON.stringify(request.params), request.body),
      );
      if (claim.state === 'replay') {
        response.status(claim.statusCode);
        return claim.body ?? undefined;
      }
    }

    const tenantId = this.tenantFromParams(request, meta);
    try {
      const value = await lastValueFrom(next.handle(), { defaultValue: undefined });
      if (!ctx.audited)
        await this.audit.record(ctx, {
          action: meta.action,
          tenantId: ctx.hint.tenantId ?? tenantId,
          propertyId: ctx.hint.propertyId,
          targetType: ctx.hint.targetType ?? meta.targetType,
          targetId: ctx.hint.targetId,
          before: ctx.hint.before,
          after: ctx.hint.after,
          reason: ctx.hint.reason,
          details: ctx.hint.details,
        });
      if (key && ctx.actor)
        await this.idempotency.complete(ctx.actor.accountId, key, response.statusCode, value);
      return value;
    } catch (error) {
      if (key && ctx.actor) await this.idempotency.release(ctx.actor.accountId, key);
      const status = error instanceof HttpException ? error.getStatus() : 500;
      await this.audit
        .record(ctx, {
          action: meta.action,
          result: 'failed',
          tenantId: ctx.hint.tenantId ?? tenantId,
          targetType: ctx.hint.targetType ?? meta.targetType,
          targetId: ctx.hint.targetId,
          reason: ctx.hint.reason,
          details: {
            status,
            error: error instanceof Error ? error.message.slice(0, 300) : 'error',
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  private tenantFromParams(request: RouteRequest, meta: PlatformAuditOptions): string | undefined {
    const value = meta.tenantParam ? request.params[meta.tenantParam] : undefined;
    return value && uuidPattern.test(value) ? value : undefined;
  }
}
