import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuthService } from '../auth/auth.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';

type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';

@Injectable()
export class PlatformAdminService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
  ) {}

  suspendTenant(
    tenantId: string,
    actorUserId: string,
  ): Promise<{ id: string; status: OrganizationStatus }> {
    return this.transitionTenant(tenantId, actorUserId, 'ACTIVE', 'SUSPENDED');
  }

  reactivateTenant(
    tenantId: string,
    actorUserId: string,
  ): Promise<{ id: string; status: OrganizationStatus }> {
    return this.transitionTenant(tenantId, actorUserId, 'SUSPENDED', 'ACTIVE');
  }

  async triggerPasswordReset(tenantId: string, userId: string, actorUserId: string): Promise<void> {
    await this.requirePlatformVisibleTenantUser(tenantId, userId);

    const target = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; email: string }>>`
          SELECT u."id", u."email"
          FROM "users" u
          JOIN "tenant_memberships" tm ON tm."user_id" = u."id"
          WHERE tm."tenant_id" = ${tenantId}::uuid AND tm."user_id" = ${userId}::uuid
        `;
      if (!rows[0]) throw new NotFoundException('Tenant user not found.');
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        actorType: 'PLATFORM_ADMIN',
        action: 'platform.user.password_reset_requested',
        targetType: 'user',
        targetId: userId,
      });
      return rows;
    });

    await this.auth.triggerPasswordReset(target[0]);
  }

  private async transitionTenant(
    tenantId: string,
    actorUserId: string,
    from: OrganizationStatus,
    to: OrganizationStatus,
  ): Promise<{ id: string; status: OrganizationStatus }> {
    const organization = await this.requirePlatformVisibleOrganization(tenantId);
    if (organization.status !== from) {
      throw new ConflictException(`Tenant cannot transition from ${organization.status} to ${to}.`);
    }

    const updated = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: OrganizationStatus }>>`
          UPDATE "organizations"
          SET "status" = ${to}::"OrganizationStatus", "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${tenantId}::uuid AND "status" = ${from}::"OrganizationStatus"
          RETURNING "id", "status"::text AS "status"
        `;
      if (!rows[0]) return rows;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        actorType: 'PLATFORM_ADMIN',
        action: to === 'SUSPENDED' ? 'platform.tenant.suspended' : 'platform.tenant.reactivated',
        targetType: 'organization',
        targetId: tenantId,
      });
      return rows;
    });
    if (!updated[0]) throw new ConflictException(`Tenant cannot transition from ${from} to ${to}.`);
    return updated[0];
  }

  private async requirePlatformVisibleOrganization(
    tenantId: string,
  ): Promise<{ id: string; status: OrganizationStatus }> {
    const organizations = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<Array<{ id: string; status: OrganizationStatus }>>`
          SELECT "id", "status"::text AS "status"
          FROM "organizations"
          WHERE "id" = ${tenantId}::uuid
        `,
    );
    if (!organizations[0]) throw new NotFoundException('Tenant not found.');
    return organizations[0];
  }

  private async requirePlatformVisibleTenantUser(tenantId: string, userId: string): Promise<void> {
    const users = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT u."id"
          FROM "users" u
          JOIN "tenant_memberships" tm ON tm."user_id" = u."id"
          WHERE tm."tenant_id" = ${tenantId}::uuid AND tm."user_id" = ${userId}::uuid
        `,
    );
    if (!users[0]) throw new NotFoundException('Tenant user not found.');
  }
}
