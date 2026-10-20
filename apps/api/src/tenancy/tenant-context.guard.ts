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
import { REQUIRED_CAPABILITY } from './capabilities.decorator';
import { annotateAuditContext, currentAuditContext } from './audit-request-context';
import { hotelDashboardAccess, type LifecycleState } from '../platform/console/hotel-lifecycle';
import { ACT_AS_ALLOWED_HOTEL_CAPABILITIES } from '../platform/console/platform-capabilities';
import { PLATFORM_CONSOLE } from '../platform/console/platform-console.decorators';
import {
  PlatformSupportService,
  SUPPORT_COOKIE,
} from '../platform/console/platform-support.service';

type RequestWithContext = {
  method: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined> & { cookie?: string };
  params: Record<string, string | undefined>;
  route?: { path?: string };
  tenantContext?: {
    userId: string;
    tenantId: string;
    propertyId?: string;
    /** Present when a platform support session, not a hotel membership, authorised the request. */
    support?: { sessionId: string; kind: 'VIEW' | 'ACT'; accountId: string; accountEmail: string };
  };
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PlatformSupportService) private readonly support: PlatformSupportService,
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
    if (!userId) {
      // A hotel session is the normal way in; a platform support session is the only other.
      if (scope && this.cookie(request.headers.cookie, SUPPORT_COOKIE)) {
        if (await this.authorizeSupport(context, request, scope)) return true;
      }
      throw new UnauthorizedException('A valid session is required.');
    }

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
    if (!access) {
      // Not a member of this hotel: a platform support session for exactly this hotel may apply.
      if (
        this.cookie(request.headers.cookie, SUPPORT_COOKIE) &&
        (await this.authorizeSupport(context, request, scope))
      )
        return true;
      throw new ForbiddenException(
        'The requested tenant or property is outside this session scope.',
      );
    }
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

  /**
   * Authorises a request through a platform support session. The hotel id always comes from the URL
   * and must equal the session's own hotel, so a session cannot reach another tenant. View-as is
   * read-only; act-as may only use handlers whose capability is on a fixed allow-list, never DELETE,
   * and never a handler that declares no capability. Every request is written to the platform audit
   * log, and audit rows made while handling it carry the platform account that acted.
   */
  private async authorizeSupport(
    context: ExecutionContext,
    request: RequestWithContext,
    scope: TenantScopeOptions,
  ): Promise<boolean> {
    const tenantId = request.params[scope.tenantParam ?? 'tenantId'];
    const propertyId = scope.propertyParam ? request.params[scope.propertyParam] : undefined;
    if (!tenantId || (scope.propertyParam && !propertyId)) return false;
    const access = await this.support.resolveForTenant(
      this.cookie(request.headers.cookie, SUPPORT_COOKIE),
      tenantId,
    );
    if (!access) return false;

    if (propertyId) {
      const found = await this.database.withTenantTransaction(
        { tenantId, propertyId },
        (tx) =>
          tx.$queryRaw<Array<{ allowed: number }>>`
          SELECT 1 AS allowed FROM "properties" WHERE "id" = ${propertyId}::uuid
        `,
      );
      if (found.length !== 1) return false;
    }

    const method = request.method.toUpperCase();
    const audit = currentAuditContext();
    const userAgent = request.headers['user-agent'];
    const meta = {
      method,
      route: audit?.route ?? request.route?.path ?? 'unknown',
      requestId: audit?.requestId ?? null,
      ip: request.ip ?? null,
      userAgent: (Array.isArray(userAgent) ? userAgent[0] : userAgent)?.slice(0, 300) ?? null,
    };
    const refuse = async (reason: string, message: string): Promise<never> => {
      await this.support.recordRequest(access, { ...meta, result: 'denied', reason });
      throw new ForbiddenException({ message, code: 'SUPPORT_ACCESS_LIMITED' });
    };

    if (access.direct) {
      // TEMPORARY Super admin shortcut: full owner-level access, no allow-list and no lifecycle
      // limits. Every request is still written to the platform log below.
    } else if (access.kind === 'VIEW') {
      if (!SAFE_METHODS.has(method))
        return refuse('view-only session', 'This is a view-only support session.');
    } else {
      if (hotelDashboardAccess(access.lifecycleState, method) !== 'allowed')
        return refuse(
          'hotel not in service',
          'Act-as access is not available for this hotel right now.',
        );
      if (!SAFE_METHODS.has(method)) {
        const capability = this.reflector.getAllAndOverride<string | undefined>(
          REQUIRED_CAPABILITY,
          [context.getHandler(), context.getClass()],
        );
        if (
          method === 'DELETE' ||
          !capability ||
          !ACT_AS_ALLOWED_HOTEL_CAPABILITIES.includes(capability)
        )
          return refuse(
            'outside the act-as allow-list',
            'This action is not available in a support session.',
          );
      }
    }

    annotateAuditContext({
      supportSessionId: access.sessionId,
      platformAccountId: access.accountId,
      performedBy: access.accountEmail,
      mode: access.kind,
      hidden: access.direct,
    });
    await this.support.recordRequest(access, { ...meta, result: 'succeeded' });
    request.tenantContext = {
      userId: access.ownerUserId,
      tenantId,
      propertyId,
      support: {
        sessionId: access.sessionId,
        kind: access.kind,
        accountId: access.accountId,
        accountEmail: access.accountEmail,
      },
    };
    return true;
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === name)?.[1];
  }
}
