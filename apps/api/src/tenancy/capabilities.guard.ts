import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REQUIRED_CAPABILITY } from './capabilities.decorator';
import { TenantDatabaseService } from './tenant-database.service';

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<string>(REQUIRED_CAPABILITY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!capability) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ tenantContext?: { userId: string; tenantId: string; propertyId?: string } }>();
    const tenantContext = request.tenantContext;
    if (!tenantContext)
      throw new ForbiddenException('A tenant context is required for capability checks.');
    const allowed = await this.database.withTenantTransaction(tenantContext, async (tx) => {
      const membership = await tx.$queryRaw<Array<{ role: 'OWNER' | 'ADMIN' | 'STAFF' }>>`
        SELECT "role" FROM "tenant_memberships" WHERE "tenant_id" = ${tenantContext.tenantId}::uuid AND "user_id" = ${tenantContext.userId}::uuid
      `;
      if (membership[0]?.role === 'OWNER' || membership[0]?.role === 'ADMIN') return true;
      if (!tenantContext.propertyId) return false;
      const effective = await tx.$queryRaw<Array<{ allowed: number }>>`
        SELECT 1 AS allowed FROM "property_staff_assignments" psa
        JOIN "property_role_template_capabilities" rtc ON rtc."tenant_id" = psa."tenant_id" AND rtc."property_id" = psa."property_id" AND rtc."role_template_id" = psa."role_template_id"
        JOIN "capabilities" c ON c."tenant_id" = rtc."tenant_id" AND c."id" = rtc."capability_id"
        WHERE psa."tenant_id" = ${tenantContext.tenantId}::uuid AND psa."property_id" = ${tenantContext.propertyId}::uuid AND psa."user_id" = ${tenantContext.userId}::uuid AND c."key" = ${capability}
        UNION
        SELECT 1 AS allowed FROM "property_staff_capability_overrides" o
        JOIN "capabilities" c ON c."tenant_id" = o."tenant_id" AND c."id" = o."capability_id"
        WHERE o."tenant_id" = ${tenantContext.tenantId}::uuid AND o."property_id" = ${tenantContext.propertyId}::uuid AND o."user_id" = ${tenantContext.userId}::uuid AND o."granted" = true AND c."key" = ${capability}
      `;
      return effective.length > 0;
    });
    if (!allowed) throw new ForbiddenException('Missing required capability.');
    return true;
  }
}
