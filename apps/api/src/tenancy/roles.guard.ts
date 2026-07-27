import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_ROLES, Role } from './roles.decorator';
import { TenantDatabaseService } from './tenant-database.service';

type ContextRequest = { tenantContext?: { userId: string; tenantId: string; propertyId?: string } };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const tenantContext = context.switchToHttp().getRequest<ContextRequest>().tenantContext;
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
}
