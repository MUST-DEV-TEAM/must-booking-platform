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
import {
  PUBLIC_ROUTE,
  PUBLIC_TENANT_SCOPE,
  TENANT_SCOPE,
  type TenantScopeOptions,
} from './tenant-context.decorator';
import { TenantDatabaseService } from './tenant-database.service';
import { REQUIRED_ROLES, Role } from './roles.decorator';
import { hotelDashboardAccess, type LifecycleState } from '../platform/console/hotel-lifecycle';
import { PLATFORM_CONSOLE } from '../platform/console/platform-console.decorators';

type RequestWithContext = {
  method: string;
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
    // Platform console controllers authenticate through PlatformAccessGuard, never a hotel session.
    if (this.reflector.get<boolean>(PLATFORM_CONSOLE, context.getClass())) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    if (
      this.reflector.getAllAndOverride<TenantScopeOptions>(PUBLIC_TENANT_SCOPE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const scope = this.reflector.getAllAndOverride<TenantScopeOptions>(TENANT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Platform routes deliberately have no tenant context. RolesGuard resolves
    // their session and verifies the platform role before the handler runs.
    if (!scope && requiredRoles?.includes(Role.PlatformAdmin)) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const userId = await this.auth.getSessionUserId(
      this.cookie(request.headers.cookie, 'must_session'),
    );
    if (!userId) throw new UnauthorizedException('A valid session is required.');

    if (!scope) throw new ForbiddenException('Authenticated routes must declare a tenant scope.');

    const tenantId = request.params[scope.tenantParam ?? 'tenantId'];
    const propertyId = scope.propertyParam ? request.params[scope.propertyParam] : undefined;
    if (!tenantId || (scope.propertyParam && !propertyId))
      throw new ForbiddenException('Invalid tenant scope.');

    const access = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const memberships = await tx.$queryRaw<Array<{ allowed: number }>>`
        SELECT 1 AS allowed FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
        if (memberships.length === 0) return null;
        if (propertyId) {
          const properties = await tx.$queryRaw<Array<{ allowed: number }>>`
        SELECT 1 AS allowed FROM "properties" WHERE "id" = ${propertyId}::uuid
      `;
          if (properties.length !== 1) return null;
        }
        const organization = await tx.$queryRaw<Array<{ state: LifecycleState }>>`
          SELECT "lifecycle_state"::text AS "state" FROM "organizations" WHERE "id" = ${tenantId}::uuid
        `;
        return { state: organization[0]?.state ?? ('ACTIVE' as LifecycleState) };
      },
    );
    if (!access)
      throw new ForbiddenException(
        'The requested tenant or property is outside this session scope.',
      );
    // Lifecycle effects (Milestone 24 platform console): a suspended or cancelled hotel is closed to
    // its staff, and an archived one is read-only. The session stays valid for the hotel's other
    // tenants.
    const verdict = hotelDashboardAccess(access.state, request.method);
    if (verdict === 'blocked')
      throw new ForbiddenException({
        message: 'This hotel account is not active. Contact MUST support.',
        code: 'HOTEL_SUSPENDED',
      });
    if (verdict === 'read_only')
      throw new ForbiddenException({
        message: 'This hotel is archived and read-only.',
        code: 'HOTEL_ARCHIVED',
      });

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
