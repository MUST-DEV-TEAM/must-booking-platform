import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

import { AuthService } from '../auth/auth.service';
import { PUBLIC_TENANT_SCOPE, type TenantScopeOptions } from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';

type RequestWithContext = {
  headers: { cookie?: string };
  params: Record<string, string | undefined>;
  tenantContext?: { userId?: string; tenantId: string; propertyId?: string };
  guestSessionId?: string;
  res: { cookie(name: string, value: string, options: Record<string, unknown>): void };
};

@Injectable()
export class PublicTenantScopedGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<TenantScopeOptions>(PUBLIC_TENANT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const tenantId = request.params[scope.tenantParam ?? 'tenantId'];
    const propertyId = scope.propertyParam ? request.params[scope.propertyParam] : undefined;
    if (!tenantId || (scope.propertyParam && !propertyId))
      throw new ForbiddenException('Invalid tenant scope.');

    const exists = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        if (!propertyId) return true;
        const properties = await tx.$queryRaw<Array<{ allowed: number }>>`
        SELECT 1 AS allowed FROM "properties"
        WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${propertyId}::uuid
      `;
        return properties.length === 1;
      },
    );
    if (!exists) throw new ForbiddenException('Invalid tenant scope.');

    const staffSessionId = this.cookie(request.headers.cookie, 'must_session');
    const userId = await this.auth.getSessionUserId(staffSessionId);
    if (userId) {
      const member = await this.database.withTenantTransaction(
        { tenantId, propertyId },
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ allowed: number }>>`
          SELECT 1 AS allowed FROM "tenant_memberships"
          WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
        `;
          return rows.length === 1;
        },
      );
      if (member) {
        request.tenantContext = { userId, tenantId, propertyId };
        request.guestSessionId = staffSessionId;
        return true;
      }
    }

    const guestSessionId =
      this.cookie(request.headers.cookie, 'must_guest_session') ?? randomUUID();
    if (!this.cookie(request.headers.cookie, 'must_guest_session')) {
      request.res.cookie('must_guest_session', guestSessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    request.tenantContext = { tenantId, propertyId };
    request.guestSessionId = guestSessionId;
    return true;
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === name)?.[1];
  }
}
