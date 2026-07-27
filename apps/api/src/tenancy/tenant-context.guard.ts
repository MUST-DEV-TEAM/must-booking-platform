import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthService } from '../auth/auth.service';
import { PUBLIC_ROUTE, TENANT_SCOPE, type TenantScopeOptions } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';

type RequestWithContext = {
  headers: { cookie?: string };
  params: Record<string, string | undefined>;
  tenantContext?: { userId: string; tenantId: string; propertyId?: string };
};

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const userId = await this.auth.getSessionUserId(
      this.cookie(request.headers.cookie, 'must_session'),
    );
    if (!userId) throw new UnauthorizedException('A valid session is required.');

    const scope = this.reflector.getAllAndOverride<TenantScopeOptions>(TENANT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) throw new ForbiddenException('Authenticated routes must declare a tenant scope.');

    const tenantId = request.params[scope.tenantParam ?? 'tenantId'];
    const propertyId = scope.propertyParam ? request.params[scope.propertyParam] : undefined;
    if (!tenantId || (scope.propertyParam && !propertyId))
      throw new ForbiddenException('Invalid tenant scope.');

    const isAuthorized = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const memberships = await tx.$queryRaw<Array<{ allowed: number }>>`
        SELECT 1 AS allowed FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
        if (memberships.length === 0) return false;
        if (!propertyId) return true;
        const properties = await tx.$queryRaw<Array<{ allowed: number }>>`
        SELECT 1 AS allowed FROM "properties" WHERE "id" = ${propertyId}::uuid
      `;
        return properties.length === 1;
      },
    );
    if (!isAuthorized)
      throw new ForbiddenException(
        'The requested tenant or property is outside this session scope.',
      );

    request.tenantContext = { userId, tenantId, propertyId };
    return true;
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === name)?.[1];
  }
}
