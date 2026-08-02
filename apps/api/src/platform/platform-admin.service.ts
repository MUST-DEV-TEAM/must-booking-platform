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

  async dashboardHome(actorUserId: string): Promise<PlatformDashboardHome> {
    await this.auditLogs.record({
      actorUserId,
      actorType: 'PLATFORM_ADMIN',
      action: 'platform.dashboard.viewed',
      targetType: 'platform_dashboard',
      targetId: 'home',
    });

    const inventory = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      async (tx) => {
        const [summary, plans, activity, organizations] = await Promise.all([
          tx.$queryRaw<
            [{ tenants: number; signupsThisWeek: number }]
          >`SELECT COUNT(*)::int AS "tenants",
             COUNT(*) FILTER (WHERE "created_at" >= date_trunc('week', CURRENT_TIMESTAMP))::int AS "signupsThisWeek"
           FROM "organizations"`,
          tx.$queryRaw<Array<{ plan: string; tenants: number }>>`
          SELECT p."name" AS "plan", COUNT(o.*)::int AS "tenants"
          FROM "organizations" o
          JOIN "plans" p ON p."id" = o."plan_id"
          GROUP BY p."name"
          ORDER BY p."name"
        `,
          tx.$queryRaw<PlatformActivity[]>`
          SELECT a."id", a."tenant_id" AS "tenantId", a."action", a."target_type" AS "targetType",
            a."target_id" AS "targetId", a."actor_type" AS "actorType", a."created_at" AS "createdAt",
            u."email" AS "actorEmail"
          FROM "audit_logs" a
          LEFT JOIN "users" u ON u."id" = a."actor_user_id"
          WHERE a."actor_type" = 'PLATFORM_ADMIN'::"AuditActorType"
          ORDER BY a."created_at" DESC
          LIMIT 10
        `,
          tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "organizations"`,
        ]);
        return { summary: summary[0], plans, activity, organizations };
      },
    );
    const propertyCounts = await Promise.all(
      inventory.organizations.map(({ id }) =>
        this.database.withTenantTransaction(
          { tenantId: id },
          (tx) =>
            tx.$queryRaw<[{ count: number }]>`SELECT COUNT(*)::int AS "count" FROM "properties"`,
        ),
      ),
    );
    return {
      stats: {
        tenants: inventory.summary?.tenants ?? 0,
        properties: propertyCounts.reduce((total, [{ count }]) => total + count, 0),
        signupsThisWeek: inventory.summary?.signupsThisWeek ?? 0,
        plans: Object.fromEntries(inventory.plans.map((item) => [item.plan, item.tenants])),
      },
      activity: inventory.activity,
    };
  }

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

export interface PlatformActivity {
  id: string;
  tenantId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  actorType: 'PLATFORM_ADMIN';
  actorEmail: string | null;
  createdAt: Date;
}

export interface PlatformDashboardHome {
  stats: {
    tenants: number;
    properties: number;
    signupsThisWeek: number;
    plans: Record<string, number>;
  };
  activity: PlatformActivity[];
}
