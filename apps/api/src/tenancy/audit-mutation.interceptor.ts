import {
  Injectable,
  Inject,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  HttpException,
} from '@nestjs/common';
import { from, throwError, type Observable } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { randomUUID, createHash } from 'node:crypto';
import { AuditLogService } from './audit-log.service';
import { currentAuditContext } from './audit-request-context';
/** Records request failures, not an assertion that an external business action did not happen. */
@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  constructor(@Inject(AuditLogService) private readonly audit: AuditLogService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      headers?: Record<string, unknown>;
      route?: { path?: string };
      tenantContext?: { tenantId: string; propertyId?: string; userId?: string };
    }>();
    const scope = req.tenantContext;
    if (
      !scope?.tenantId ||
      !scope.propertyId ||
      !scope.userId ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    )
      return next.handle();
    const record = async (status: number, code: unknown) => {
      const key = req.headers?.['idempotency-key'];
      const operationId =
        typeof key === 'string' && key.length <= 200
          ? 'request:' +
            createHash('sha256')
              .update(JSON.stringify([scope.tenantId, scope.propertyId, req.route?.path, key]))
              .digest('hex')
          : undefined;
      try {
        await this.audit.record({
          tenantId: scope.tenantId,
          propertyId: scope.propertyId,
          actorUserId: scope.userId!,
          action: 'request.mutation_failed',
          result: status === 403 || status === 401 ? 'denied' : 'failed',
          source: 'MUST_STAFF',
          operationId,
          targetType: 'request',
          targetId: currentAuditContext()?.requestId ?? randomUUID(),
          details: {
            status,
            errorCode:
              typeof code === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(code)
                ? code
                : 'REQUEST_REJECTED',
            reason:
              'The request did not complete successfully. This does not prove that a provider action was reversed or did not happen.',
          },
        });
      } catch {
        /* The logger reports its own failure; preserve the original response. */
      }
    };
    return next.handle().pipe(
      mergeMap(async (value: unknown) => {
        if (value && typeof value === 'object' && (value as { ok?: boolean }).ok === false)
          await record(400, (value as { error?: { code?: unknown } }).error?.code);
        return value;
      }),
      catchError((error) =>
        from(
          record(error instanceof HttpException ? error.getStatus() : 500, 'REQUEST_FAILED'),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }
}
