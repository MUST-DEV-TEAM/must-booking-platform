import { OVERVIEW_TYPES } from './overview-widgets';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditLogService } from './audit-log.service';
import { CAPABILITY_CATALOG, CAPABILITY_KEYS } from './capability-catalog';
import { StaffInviteService } from './staff-invite.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type RoleView = {
  id: string;
  name: string;
  kind: 'BUILT_IN' | 'CUSTOM';
  description: string | null;
  overviewType: string;
  capabilities: string[];
  memberCount: number;
};

export type EffectiveCapability = {
  key: string;
  granted: boolean;
  source: 'role' | 'extra' | 'denied' | 'none';
};

export type RoleInput = {
  name?: string;
  description?: string | null;
  overviewType?: string;
  capabilities?: string[];
  copyFromId?: string;
};

export type CreateStaffInput = {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  roleTemplateId: string;
  extraCapabilities: string[];
  deniedCapabilities: string[];
};

@Injectable()
export class StaffAccessService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
    @Inject(StaffInviteService) private readonly invites: StaffInviteService,
  ) {}

  /** Nobody can hand out a permission they do not hold themselves. */
  assertCanGrant(actor: ReadonlySet<string>, keys: readonly string[]): void {
    const missing = keys.filter((key) => !actor.has(key));
    if (missing.length)
      throw new ForbiddenException(
        `You cannot give permissions you do not have yourself: ${missing.join(', ')}.`,
      );
  }

  // ---------------------------------------------------------------- roles

  async listRoles(tenantId: string, propertyId: string): Promise<RoleView[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      this.listRolesInTransaction(tx, tenantId, propertyId),
    );
  }

  async createRole(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    actor: ReadonlySet<string>,
    input: RoleInput,
  ): Promise<RoleView> {
    const name = this.roleName(input.name);
    const description = this.roleDescription(input.description);
    const overviewType = this.overviewType(input.overviewType, 'auto');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      let capabilities = input.capabilities;
      if (input.copyFromId) {
        const source = (await this.listRolesInTransaction(tx, tenantId, propertyId)).find(
          (role) => role.id === input.copyFromId,
        );
        if (!source) throw new NotFoundException('The role to copy was not found.');
        capabilities ??= source.capabilities;
      }
      const keys = this.capabilityKeys(capabilities ?? []);
      this.assertCanGrant(actor, keys);
      const existing = await tx.$queryRaw<Array<{ found: number }>>`
        SELECT 1 AS found FROM "property_role_templates"
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND lower("name") = lower(${name})
      `;
      if (existing[0]) throw new ConflictException('A role with this name already exists.');
      const created = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "property_role_templates" ("tenant_id", "property_id", "name", "kind", "description", "overview_type")
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${name}, 'CUSTOM', ${description}, ${overviewType})
        RETURNING "id"
      `;
      await this.replaceRoleCapabilities(tx, tenantId, propertyId, created[0]!.id, keys);
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'role.created',
        targetType: 'role',
        targetId: created[0]!.id,
        details: { name, capabilityCount: keys.length },
      });
      return (await this.listRolesInTransaction(tx, tenantId, propertyId)).find(
        (role) => role.id === created[0]!.id,
      )!;
    });
  }

  async updateRole(
    tenantId: string,
    propertyId: string,
    roleId: string,
    actorUserId: string,
    actor: ReadonlySet<string>,
    input: RoleInput,
  ): Promise<RoleView> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const role = (await this.listRolesInTransaction(tx, tenantId, propertyId)).find(
        (entry) => entry.id === roleId,
      );
      if (!role) throw new NotFoundException('Role not found.');
      if (role.kind === 'BUILT_IN')
        throw new ConflictException('Built-in roles cannot be changed. Copy it as a custom role.');
      const keys = input.capabilities ? this.capabilityKeys(input.capabilities) : role.capabilities;
      // You may only edit a role that is no more powerful than you, and not make it so.
      this.assertCanGrant(actor, [...new Set([...role.capabilities, ...keys])]);
      const name = input.name !== undefined ? this.roleName(input.name) : role.name;
      const description =
        input.description !== undefined
          ? this.roleDescription(input.description)
          : role.description;
      const overviewType =
        input.overviewType !== undefined
          ? this.overviewType(input.overviewType, role.overviewType)
          : role.overviewType;
      if (name.toLowerCase() !== role.name.toLowerCase()) {
        const clash = await tx.$queryRaw<Array<{ found: number }>>`
          SELECT 1 AS found FROM "property_role_templates"
          WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
            AND lower("name") = lower(${name}) AND "id" <> ${roleId}::uuid
        `;
        if (clash[0]) throw new ConflictException('A role with this name already exists.');
      }
      await tx.$executeRaw`
        UPDATE "property_role_templates" SET "name" = ${name}, "description" = ${description}, "overview_type" = ${overviewType}, "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "id" = ${roleId}::uuid
      `;
      if (input.capabilities)
        await this.replaceRoleCapabilities(tx, tenantId, propertyId, roleId, keys);
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'role.updated',
        targetType: 'role',
        targetId: roleId,
        details: { name, capabilityCount: keys.length, overviewType },
      });
      return (await this.listRolesInTransaction(tx, tenantId, propertyId)).find(
        (entry) => entry.id === roleId,
      )!;
    });
  }

  async deleteRole(
    tenantId: string,
    propertyId: string,
    roleId: string,
    actorUserId: string,
    actor: ReadonlySet<string>,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const role = (await this.listRolesInTransaction(tx, tenantId, propertyId)).find(
        (entry) => entry.id === roleId,
      );
      if (!role) throw new NotFoundException('Role not found.');
      if (role.kind === 'BUILT_IN')
        throw new ConflictException('Built-in roles cannot be deleted.');
      if (role.memberCount > 0)
        throw new ConflictException(
          `This role is used by ${role.memberCount} staff member${role.memberCount === 1 ? '' : 's'}. Move them to another role first.`,
        );
      this.assertCanGrant(actor, role.capabilities);
      await tx.$executeRaw`
        DELETE FROM "property_role_template_capabilities"
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "role_template_id" = ${roleId}::uuid
      `;
      await tx.$executeRaw`
        DELETE FROM "property_role_templates"
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "id" = ${roleId}::uuid
      `;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'role.deleted',
        targetType: 'role',
        targetId: roleId,
        details: { name: role.name },
      });
    });
  }

  // ---------------------------------------------------------------- people

  /** The account is created straight away with the password the person in charge chose. */
  async createStaff(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    actor: ReadonlySet<string>,
    input: CreateStaffInput,
  ): Promise<{ userId: string }> {
    const firstName = input.firstName.trim();
    const lastName = input.lastName?.trim() || null;
    const email = input.email.trim().toLowerCase();
    if (!firstName || firstName.length > 100)
      throw new BadRequestException('A first name is required.');
    if (lastName && lastName.length > 100)
      throw new BadRequestException('The last name is too long.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
      throw new BadRequestException('A valid email is required.');
    this.assertPasswordPolicy(input.password);
    const extras = this.capabilityKeys(input.extraCapabilities);
    const denied = this.capabilityKeys(input.deniedCapabilities);
    if (extras.some((key) => denied.includes(key)))
      throw new BadRequestException('A permission cannot be both added and removed.');

    const roles = await this.listRoles(tenantId, propertyId);
    const role = roles.find((entry) => entry.id === input.roleTemplateId);
    if (!role) throw new NotFoundException('Role not found.');
    this.assertCanGrant(actor, [...role.capabilities, ...extras]);

    return this.invites.createDirect({
      tenantId,
      propertyId,
      actorUserId,
      firstName,
      lastName,
      email,
      password: input.password,
      roleTemplateId: role.id,
      extraCapabilities: extras,
      deniedCapabilities: denied,
    });
  }

  async setStatus(
    tenantId: string,
    propertyId: string,
    userId: string,
    status: unknown,
    actorUserId: string,
    actor: ReadonlySet<string>,
  ): Promise<void> {
    if (status !== 'ACTIVE' && status !== 'SUSPENDED')
      throw new BadRequestException('status must be ACTIVE or SUSPENDED.');
    if (userId === actorUserId) throw new ForbiddenException('You cannot suspend your own access.');
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const target = await this.effectiveInTransaction(tx, tenantId, propertyId, userId);
      this.assertCanGrant(
        actor,
        target.filter((entry) => entry.granted).map((entry) => entry.key),
      );
      await tx.$executeRaw`
        UPDATE "property_staff_assignments"
        SET "suspended_at" = ${status === 'SUSPENDED' ? new Date() : null}, "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "user_id" = ${userId}::uuid
      `;
      await this.auditLogs.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: status === 'SUSPENDED' ? 'staff.suspended' : 'staff.reactivated',
        targetType: 'user',
        targetId: userId,
        details: {},
      });
    });
  }

  /** Stops a change to a person who holds more than the person changing them. */
  async assertCanManageTarget(
    tenantId: string,
    propertyId: string,
    userId: string,
    actor: ReadonlySet<string>,
    extraKeysBeingGiven: readonly string[] = [],
  ): Promise<void> {
    // A person who has no assignment here yet holds nothing to protect.
    const target = await this.effectiveCapabilities(tenantId, propertyId, userId).catch((error) => {
      if (error instanceof NotFoundException) return [] as EffectiveCapability[];
      throw error;
    });
    this.assertCanGrant(actor, [
      ...target.filter((entry) => entry.granted).map((entry) => entry.key),
      ...extraKeysBeingGiven,
    ]);
  }

  async effectiveCapabilities(
    tenantId: string,
    propertyId: string,
    userId: string,
  ): Promise<EffectiveCapability[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      this.effectiveInTransaction(tx, tenantId, propertyId, userId),
    );
  }

  // ---------------------------------------------------------------- helpers

  private async effectiveInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    userId: string,
  ): Promise<EffectiveCapability[]> {
    const assignment = await tx.$queryRaw<Array<{ roleTemplateId: string }>>`
      SELECT "role_template_id" AS "roleTemplateId" FROM "property_staff_assignments"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "user_id" = ${userId}::uuid
    `;
    if (!assignment[0]) throw new NotFoundException('Property staff assignment not found.');
    const fromRole = await tx.$queryRaw<Array<{ key: string }>>`
      SELECT c."key" FROM "property_role_template_capabilities" rtc
      JOIN "capabilities" c ON c."tenant_id" = rtc."tenant_id" AND c."id" = rtc."capability_id"
      WHERE rtc."tenant_id" = ${tenantId}::uuid AND rtc."property_id" = ${propertyId}::uuid
        AND rtc."role_template_id" = ${assignment[0].roleTemplateId}::uuid
    `;
    const overrides = await tx.$queryRaw<Array<{ key: string; granted: boolean }>>`
      SELECT c."key", o."granted" FROM "property_staff_capability_overrides" o
      JOIN "capabilities" c ON c."tenant_id" = o."tenant_id" AND c."id" = o."capability_id"
      WHERE o."tenant_id" = ${tenantId}::uuid AND o."property_id" = ${propertyId}::uuid AND o."user_id" = ${userId}::uuid
    `;
    const role = new Set(fromRole.map((row) => row.key));
    const byKey = new Map(overrides.map((row) => [row.key, row.granted]));
    return CAPABILITY_CATALOG.map((entry): EffectiveCapability => {
      const inRole = role.has(entry.key);
      const override = byKey.get(entry.key);
      if (override === true)
        return { key: entry.key, granted: true, source: inRole ? 'role' : 'extra' };
      if (override === false)
        return { key: entry.key, granted: false, source: inRole ? 'denied' : 'none' };
      return { key: entry.key, granted: inRole, source: inRole ? 'role' : 'none' };
    });
  }

  private async listRolesInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
  ): Promise<RoleView[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        kind: 'BUILT_IN' | 'CUSTOM';
        description: string | null;
        overviewType: string;
        capabilities: string[];
        memberCount: number;
      }>
    >`
      SELECT prt."id", prt."name", prt."kind"::text AS "kind", prt."description", prt."overview_type" AS "overviewType",
        COALESCE(array_agg(c."key" ORDER BY c."key") FILTER (WHERE c."key" IS NOT NULL), ARRAY[]::text[]) AS "capabilities",
        (SELECT COUNT(*)::int FROM "property_staff_assignments" psa
          WHERE psa."tenant_id" = prt."tenant_id" AND psa."property_id" = prt."property_id" AND psa."role_template_id" = prt."id") AS "memberCount"
      FROM "property_role_templates" prt
      LEFT JOIN "property_role_template_capabilities" rtc
        ON rtc."tenant_id" = prt."tenant_id" AND rtc."property_id" = prt."property_id" AND rtc."role_template_id" = prt."id"
      LEFT JOIN "capabilities" c ON c."tenant_id" = rtc."tenant_id" AND c."id" = rtc."capability_id"
      WHERE prt."tenant_id" = ${tenantId}::uuid AND prt."property_id" = ${propertyId}::uuid
      GROUP BY prt."id"
      ORDER BY prt."kind", prt."name"
    `;
    return rows;
  }

  private async replaceRoleCapabilities(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roleId: string,
    keys: readonly string[],
  ): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "property_role_template_capabilities"
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "role_template_id" = ${roleId}::uuid
    `;
    for (const key of keys) {
      await tx.$executeRaw`
        INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
        SELECT ${tenantId}::uuid, ${propertyId}::uuid, ${roleId}::uuid, "id" FROM "capabilities"
        WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${key}
      `;
    }
  }

  private capabilityKeys(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((key) => typeof key === 'string'))
      throw new BadRequestException('Permissions must be a list of keys.');
    const keys = value.map((key) => key.trim());
    if (new Set(keys).size !== keys.length)
      throw new BadRequestException('Permissions must not repeat.');
    const unknown = keys.filter((key) => !CAPABILITY_KEYS.includes(key));
    if (unknown.length)
      throw new BadRequestException(`Unknown permission(s): ${unknown.join(', ')}.`);
    return keys;
  }

  private roleName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException('A role name is required.');
    if (value.trim().length > 100) throw new BadRequestException('The role name is too long.');
    return value.trim();
  }

  private overviewType(value: unknown, fallback: string): string {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string' || !(OVERVIEW_TYPES as readonly string[]).includes(value))
      throw new BadRequestException('Choose a valid Overview type.');
    return value;
  }

  private roleDescription(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > 300)
      throw new BadRequestException('The description must be text of up to 300 characters.');
    return value.trim();
  }

  private assertPasswordPolicy(password: unknown): void {
    if (
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 128 ||
      !/[a-z]/i.test(password) ||
      !/\d/.test(password)
    )
      throw new BadRequestException(
        'The password must be 12 to 128 characters with at least one letter and one digit.',
      );
  }
}
