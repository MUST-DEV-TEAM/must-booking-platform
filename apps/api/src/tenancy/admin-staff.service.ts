import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';

type MembershipRole = 'OWNER' | 'ADMIN' | 'STAFF';

@Injectable()
export class AdminStaffService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
  ) {}

  async listMemberships(
    tenantId: string,
  ): Promise<Array<{ userId: string; email: string; role: MembershipRole }>> {
    return this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Array<{ userId: string; email: string; role: MembershipRole }>>`
        SELECT tm."user_id" AS "userId", u."email", tm."role"
        FROM "tenant_memberships" tm
        JOIN "users" u ON u."id" = tm."user_id"
        WHERE tm."tenant_id" = ${tenantId}::uuid
        ORDER BY u."email"
      `,
    );
  }

  async changeMembershipRole(
    tenantId: string,
    userId: string,
    role: string,
    actorUserId: string,
  ): Promise<void> {
    if (role !== 'ADMIN' && role !== 'STAFF')
      throw new BadRequestException('Membership role must be ADMIN or STAFF.');
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const memberships = await tx.$queryRaw<Array<{ role: MembershipRole }>>`
        SELECT "role" FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
      if (!memberships[0]) throw new NotFoundException('Tenant membership not found.');
      if (memberships[0].role === 'OWNER')
        throw new ForbiddenException('The Tenant Owner role cannot be changed.');
      await tx.$executeRaw`
        UPDATE "tenant_memberships" SET "role" = ${role}::"TenantMembershipRole", "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'membership.role_changed',
        targetType: 'user',
        targetId: userId,
        details: { previousRole: memberships[0].role, role },
      });
    });
  }

  async removeMembership(tenantId: string, userId: string, actorUserId: string): Promise<void> {
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const memberships = await tx.$queryRaw<Array<{ role: MembershipRole }>>`
        SELECT "role" FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
      if (!memberships[0]) throw new NotFoundException('Tenant membership not found.');
      if (memberships[0].role === 'OWNER')
        throw new ForbiddenException('The Tenant Owner cannot be removed.');
      await tx.$executeRaw`
        DELETE FROM "property_staff_capability_overrides"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'membership.removed',
        targetType: 'user',
        targetId: userId,
        details: { role: memberships[0].role },
      });
      await tx.$executeRaw`
        DELETE FROM "property_staff_assignments"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
      await tx.$executeRaw`
        DELETE FROM "tenant_memberships"
        WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
      `;
    });
  }

  async listPropertyStaff(
    tenantId: string,
    propertyId: string,
  ): Promise<
    Array<{ userId: string; email: string; roleTemplateId: string; roleTemplateName: string }>
  > {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<
          Array<{ userId: string; email: string; roleTemplateId: string; roleTemplateName: string }>
        >`
        SELECT psa."user_id" AS "userId", u."email", psa."role_template_id" AS "roleTemplateId", prt."name" AS "roleTemplateName"
        FROM "property_staff_assignments" psa
        JOIN "users" u ON u."id" = psa."user_id"
        JOIN "property_role_templates" prt
          ON prt."tenant_id" = psa."tenant_id" AND prt."property_id" = psa."property_id" AND prt."id" = psa."role_template_id"
        WHERE psa."tenant_id" = ${tenantId}::uuid AND psa."property_id" = ${propertyId}::uuid
        ORDER BY u."email"
      `,
    );
  }

  async assignPropertyStaff(
    tenantId: string,
    propertyId: string,
    userId: string,
    roleTemplateId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireStaffAndTemplate(tx, tenantId, propertyId, userId, roleTemplateId);
      await tx.$executeRaw`
        INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id")
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${userId}::uuid, ${roleTemplateId}::uuid)
        ON CONFLICT ("tenant_id", "property_id", "user_id")
        DO UPDATE SET "role_template_id" = EXCLUDED."role_template_id", "updated_at" = CURRENT_TIMESTAMP
      `;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'property_staff.assigned',
        targetType: 'user',
        targetId: userId,
        details: { roleTemplateId },
      });
    });
  }

  async setCapabilityOverride(
    tenantId: string,
    propertyId: string,
    userId: string,
    capabilityKey: string,
    granted: boolean,
    actorUserId: string,
  ): Promise<void> {
    if (!capabilityKey.trim()) throw new BadRequestException('Capability key is required.');
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const assignment = await tx.$queryRaw<Array<{ found: number }>>`
        SELECT 1 AS found FROM "property_staff_assignments"
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "user_id" = ${userId}::uuid
      `;
      if (!assignment[0]) throw new NotFoundException('Property staff assignment not found.');
      const capability = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "capabilities"
        WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${capabilityKey}
      `;
      if (!capability[0]) throw new NotFoundException('Capability not found.');
      await tx.$executeRaw`
        INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${userId}::uuid, ${capability[0].id}::uuid, ${granted})
        ON CONFLICT ("tenant_id", "property_id", "user_id", "capability_id")
        DO UPDATE SET "granted" = EXCLUDED."granted", "updated_at" = CURRENT_TIMESTAMP
      `;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: granted ? 'capability.override_granted' : 'capability.override_revoked',
        targetType: 'user',
        targetId: userId,
        details: { capabilityKey },
      });
    });
  }

  private async requireStaffAndTemplate(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    userId: string,
    roleTemplateId: string,
  ): Promise<void> {
    const membership = await tx.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found FROM "tenant_memberships"
      WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${userId}::uuid
    `;
    if (!membership[0]) throw new NotFoundException('Tenant membership not found.');
    const template = await tx.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found FROM "property_role_templates"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "id" = ${roleTemplateId}::uuid
    `;
    if (!template[0]) throw new NotFoundException('Property role template not found.');
  }
}
