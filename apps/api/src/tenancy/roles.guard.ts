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
import { REQUIRED_ROLES, Role } from './roles.decorator';
import { TenantDatabaseService } from './tenant-database.service';

type ContextRequest = {
  headers: { cookie?: string };
  tenantContext?: { userId: string; tenantId: string; propertyId?: string };
  platformContext?: { userId: string };
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<ContextRequest>();
    if (required.includes(Role.PlatformAdmin)) {
      const user = await this.auth.getSessionUser(
        this.cookie(request.headers.cookie, 'must_session'),
      );
      if (!user) throw new UnauthorizedException('A valid session is required.');
      if (!user.isPlatformAdmin) throw new ForbiddenException('Insufficient role.');
      request.platformContext = { userId: user.id };
      return true;
    }

    const tenantContext = request.tenantContext;
    if (!tenantContext)
      throw new ForbiddenException('A tenant context is required for role checks.');

    const roles = await this.effectiveRoles(tenantContext);
    if (!required.some((role) => roles.has(role)))
      throw new ForbiddenException('Insufficient role.');
    return true;
  }

  private async effectiveRoles(
    context: NonNullable<ContextRequest['tenantContext']>,
  ): Promise<Set<Role>> {
    return this.database.withTenantTransaction(context, async (tx) => {
      const memberships = await tx.$queryRaw<Array<{ role: 'OWNER' | 'ADMIN' | 'STAFF' }>>`
        SELECT "role" FROM "tenant_memberships"
        WHERE "tenant_id" = ${context.tenantId}::uuid AND "user_id" = ${context.userId}::uuid
      `;
      const roles = new Set<Role>();
      if (memberships[0]?.role === 'OWNER') roles.add(Role.TenantOwner);
      if (memberships[0]?.role === 'ADMIN') roles.add(Role.TenantAdmin);

      if (context.propertyId) {
        const staff = await tx.$queryRaw<Array<{ assigned: number }>>`
          SELECT 1 AS assigned FROM "property_staff_assignments"
          WHERE "tenant_id" = ${context.tenantId}::uuid
            AND "property_id" = ${context.propertyId}::uuid
            AND "user_id" = ${context.userId}::uuid
        `;
        if (staff.length > 0) roles.add(Role.PropertyStaff);
      }
      return roles;
    });
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    return header
      ?.split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === name)?.[1];
  }
}
