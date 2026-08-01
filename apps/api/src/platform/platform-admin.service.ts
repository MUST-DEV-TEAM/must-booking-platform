import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuthService } from '../auth/auth.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';

type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';

@Injectable()
export class PlatformAdminService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  suspendTenant(tenantId: string): Promise<{ id: string; status: OrganizationStatus }> {
    return this.transitionTenant(tenantId, 'ACTIVE', 'SUSPENDED');
  }

  reactivateTenant(tenantId: string): Promise<{ id: string; status: OrganizationStatus }> {
    return this.transitionTenant(tenantId, 'SUSPENDED', 'ACTIVE');
  }

  async triggerPasswordReset(tenantId: string, userId: string): Promise<void> {
    await this.requirePlatformVisibleTenantUser(tenantId, userId);

    const target = await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Array<{ id: string; email: string }>>`
        SELECT u."id", u."email"
        FROM "users" u
        JOIN "tenant_memberships" tm ON tm."user_id" = u."id"
        WHERE tm."tenant_id" = ${tenantId}::uuid AND tm."user_id" = ${userId}::uuid
      `,
    );
    if (!target[0]) throw new NotFoundException('Tenant user not found.');

    await this.auth.triggerPasswordReset(target[0]);
  }

  private async transitionTenant(
    tenantId: string,
    from: OrganizationStatus,
    to: OrganizationStatus,
  ): Promise<{ id: string; status: OrganizationStatus }> {
    const organization = await this.requirePlatformVisibleOrganization(tenantId);
    if (organization.status !== from) {
      throw new ConflictException(`Tenant cannot transition from ${organization.status} to ${to}.`);
    }

    const updated = await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Array<{ id: string; status: OrganizationStatus }>>`
        UPDATE "organizations"
        SET "status" = ${to}::"OrganizationStatus", "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${tenantId}::uuid AND "status" = ${from}::"OrganizationStatus"
        RETURNING "id", "status"::text AS "status"
      `,
    );
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
