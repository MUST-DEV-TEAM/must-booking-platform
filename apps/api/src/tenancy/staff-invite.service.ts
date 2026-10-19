import { savedTemplate, renderTemplate } from '../mail/email-templates';
import type { MailBrand } from '@must/domain-contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { NotificationsService } from './notifications.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';

export interface StaffInvite {
  tenantId: string;
  email: string;
  assignments: Array<{ propertyId: string; roleTemplateId: string; capabilityKeys?: string[] }>;
}

@Injectable()
export class StaffInviteService implements OnModuleDestroy {
  private readonly logger = new Logger(StaffInviteService.name);
  private readonly redis: RedisClientType;
  private connection?: Promise<RedisClientType>;
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async invite(command: StaffInvite, actorUserId: string): Promise<string> {
    if (!command.assignments.length)
      throw new BadRequestException('At least one property assignment is required.');
    try {
      await this.database.withTenantTransaction({ tenantId: command.tenantId }, (tx) =>
        this.ensureStaffSeatAvailable(tx, command.tenantId, { email: command.email }),
      );
    } catch (error) {
      if (error instanceof StaffSeatLimitReachedError) {
        await Promise.all(
          [...new Set(command.assignments.map((assignment) => assignment.propertyId))].map(
            (propertyId) =>
              this.notifications.record(command.tenantId, propertyId, 'STAFF_SEAT_CAP_REACHED', {
                maxStaffSeats: error.maxStaffSeats,
                staffSeats: error.staffSeats,
              }),
          ),
        );
      }
      throw error;
    }
    const token = randomBytes(32).toString('base64url');
    await this.client().then((redis) =>
      redis.set(`auth:staff-invite:${this.hash(token)}`, JSON.stringify(command), { EX: 604800 }),
    );
    await this.auditLogs.record({
      tenantId: command.tenantId,
      actorUserId,
      action: 'staff.invite_created',
      targetType: 'staff_invitation',
      targetId: command.email.toLowerCase(),
      details: { propertyIds: command.assignments.map((assignment) => assignment.propertyId) },
    });
    await this.sendInvitationEmailSafely(command, actorUserId, token);
    return token;
  }

  /**
   * Creates the account right away, for a hotel manager who chose the password himself. The
   * address counts as verified because the person adding the account vouches for it. An email that
   * already has an account is refused: setting someone else's password is not allowed, and a
   * person who already has an account joins another hotel through an invitation instead.
   */
  async createDirect(command: {
    tenantId: string;
    propertyId: string;
    actorUserId: string;
    firstName: string;
    lastName: string | null;
    email: string;
    password: string;
    roleTemplateId: string;
    extraCapabilities: string[];
    deniedCapabilities: string[];
  }): Promise<{ userId: string }> {
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(command.password, 12);
    try {
      await this.database.withTenantTransaction(
        { tenantId: command.tenantId, propertyId: command.propertyId },
        async (tx) => {
          await this.ensureStaffSeatAvailable(tx, command.tenantId, { email: command.email });
          const existing = await tx.$queryRaw<Array<{ found: number }>>`
            SELECT 1 AS found FROM "users" WHERE "email" = ${command.email}
          `;
          if (existing[0])
            throw new ConflictException(
              'That email already has an account. Send an invitation instead so they can join this hotel.',
            );
          await tx.$executeRaw`
            INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_auto_provisioned", "first_name", "last_name")
            VALUES (${userId}::uuid, ${command.email}, ${passwordHash}, CURRENT_TIMESTAMP, false, ${command.firstName}, ${command.lastName})
          `;
          await tx.$executeRaw`
            INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role", "is_auto_provisioned")
            VALUES (${command.tenantId}::uuid, ${userId}::uuid, 'STAFF', false)
          `;
          const template = await tx.$queryRaw<Array<{ found: number }>>`
            SELECT 1 AS found FROM "property_role_templates"
            WHERE "tenant_id" = ${command.tenantId}::uuid AND "property_id" = ${command.propertyId}::uuid
              AND "id" = ${command.roleTemplateId}::uuid
          `;
          if (!template[0]) throw new BadRequestException('The role does not exist at this hotel.');
          await tx.$executeRaw`
            INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id", "created_by_user_id")
            VALUES (${command.tenantId}::uuid, ${command.propertyId}::uuid, ${userId}::uuid, ${command.roleTemplateId}::uuid, ${command.actorUserId}::uuid)
          `;
          for (const [keys, granted] of [
            [command.extraCapabilities, true],
            [command.deniedCapabilities, false],
          ] as const) {
            for (const key of keys) {
              await tx.$executeRaw`
                INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
                SELECT ${command.tenantId}::uuid, ${command.propertyId}::uuid, ${userId}::uuid, "id", ${granted}
                FROM "capabilities" WHERE "tenant_id" = ${command.tenantId}::uuid AND "key" = ${key}
              `;
            }
          }
          await this.auditLogs.recordInTransaction(tx, {
            tenantId: command.tenantId,
            propertyId: command.propertyId,
            actorUserId: command.actorUserId,
            action: 'staff.created',
            targetType: 'user',
            targetId: userId,
            details: { email: command.email, roleTemplateId: command.roleTemplateId },
          });
        },
      );
    } catch (error) {
      if (this.isUniqueEmailViolation(error))
        throw new ConflictException(
          'That email already has an account. Send an invitation instead so they can join this hotel.',
        );
      if (error instanceof StaffSeatLimitReachedError)
        await this.notifications.record(
          command.tenantId,
          command.propertyId,
          'STAFF_SEAT_CAP_REACHED',
          {
            maxStaffSeats: error.maxStaffSeats,
            staffSeats: error.staffSeats,
          },
        );
      throw error;
    }
    return { userId };
  }

  async accept(token: string, userId: string): Promise<void> {
    const invite = await this.consumeInvite(token);
    await this.database.withTenantTransaction({ tenantId: invite.tenantId }, async (tx) => {
      await this.ensureStaffSeatAvailable(tx, invite.tenantId, { userId });
      await this.assignInvitation(tx, invite, userId);
    });
  }

  async activate(token: string, email: string, password: string): Promise<void> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      throw new BadRequestException(
        'A valid email and a password of at least 12 characters are required.',
      );
    }
    const userId = randomUUID();
    const invite = await this.consumeInvite(token);
    try {
      await this.database.withTenantTransaction({ tenantId: invite.tenantId }, async (tx) => {
        await this.ensureStaffSeatAvailable(tx, invite.tenantId, { email });
        await this.createActiveStaffInTransaction(tx, userId, email, password, false);
        await this.assignInvitation(tx, invite, userId);
      });
    } catch (error: unknown) {
      if (this.isUniqueEmailViolation(error)) {
        throw new BadRequestException('This invitation requires a new user account.');
      }
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  private async client(): Promise<RedisClientType> {
    if (!this.redis.isOpen) {
      this.connection ??= this.redis.connect();
      await this.connection;
    }
    return this.redis;
  }

  private async sendInvitationEmailSafely(
    command: StaffInvite,
    actorUserId: string,
    token: string,
  ): Promise<void> {
    try {
      const invitationUrl = new URL('/staff-invitation', process.env.WEB_APP_URL);
      invitationUrl.searchParams.set('token', token);
      const details = await this.database.withTenantTransaction(
        { tenantId: command.tenantId },
        async (tx) => {
          const organization = await tx.$queryRaw<
            Array<{ organizationName: string; invitedByEmail: string }>
          >`
            SELECT o.name AS "organizationName", u.email AS "invitedByEmail"
            FROM organizations o
            JOIN users u ON u.id = ${actorUserId}::uuid
            WHERE o.id = ${command.tenantId}::uuid
          `;
          const assignments = await Promise.all(
            command.assignments.map(
              (assignment) =>
                tx.$queryRaw<Array<{ propertyName: string; roleTemplateName: string }>>`
                SELECT p.name AS "propertyName", t.name AS "roleTemplateName"
                FROM properties p
                JOIN property_role_templates t
                  ON t.tenant_id = p.tenant_id AND t.property_id = p.id
                WHERE p.tenant_id = ${command.tenantId}::uuid
                  AND p.id = ${assignment.propertyId}::uuid
                  AND t.id = ${assignment.roleTemplateId}::uuid
              `,
            ),
          );
          if (!organization[0] || assignments.some((rows) => !rows[0]))
            throw new Error('Unable to load staff invitation email details.');
          return { organization: organization[0], assignments: assignments.map((rows) => rows[0]) };
        },
      );
      const propertyId =
        command.assignments.length === 1 ? command.assignments[0]!.propertyId : null;
      const customized = propertyId
        ? await this.database.withTenantTransaction(
            { tenantId: command.tenantId, propertyId },
            async (tx) => {
              const [brand] = await tx.$queryRaw<
                MailBrand[]
              >`SELECT name,logo_url AS "logoUrl",support_email AS "supportEmail",phone,address,public_website_origin AS "websiteUrl" FROM properties WHERE tenant_id=${command.tenantId}::uuid AND id=${propertyId}::uuid`;
              const saved = await savedTemplate(
                tx,
                { tenantId: command.tenantId, propertyId },
                'staff_invitation',
              );
              return {
                brand,
                template: renderTemplate('staff_invitation', saved, {
                  hotel_name: brand?.name ?? details.organization.organizationName,
                  staff_name: 'colleague',
                  role_name: details.assignments[0]?.roleTemplateName ?? 'staff',
                  invitation_link: invitationUrl.toString(),
                }),
              };
            },
          )
        : {};
      await this.delivery.dispatch(
        'staffInvitation',
        {
          to: command.email,
          ...customized,
          organizationName: details.organization.organizationName,
          invitedByEmail: details.organization.invitedByEmail,
          assignments: details.assignments,
          invitationUrl: invitationUrl.toString(),
        },
        { tenantId: command.tenantId, propertyId },
        { inlineFirst: true },
      );
    } catch (error) {
      this.logger.error(
        `Unable to send staff invitation email to ${command.email}; invitation remains valid.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async consumeInvite(token: string): Promise<StaffInvite> {
    const value = await this.client().then((redis) =>
      redis.getDel(`auth:staff-invite:${this.hash(token)}`),
    );
    if (!value) throw new BadRequestException('Invalid or expired staff invitation.');
    return JSON.parse(value) as StaffInvite;
  }

  private async assignInvitation(
    tx: TenantTransaction,
    invite: StaffInvite,
    userId: string,
  ): Promise<void> {
    await this.assignStaffInTransaction(tx, invite.tenantId, userId, invite.assignments, false);
    await this.auditLogs.recordInTransaction(tx, {
      tenantId: invite.tenantId,
      actorUserId: userId,
      action: 'staff.invite_accepted',
      targetType: 'user',
      targetId: userId,
      details: { propertyIds: invite.assignments.map((assignment) => assignment.propertyId) },
    });
  }

  private async createActiveStaffInTransaction(
    tx: TenantTransaction,
    userId: string,
    email: string,
    password: string,
    autoProvisioned: boolean,
  ): Promise<void> {
    await this.ensureTenantMembershipAllowed(tx, userId);
    await tx.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_auto_provisioned")
      VALUES (${userId}::uuid, ${email.toLowerCase()}, ${await bcrypt.hash(password, 12)}, CURRENT_TIMESTAMP, ${autoProvisioned})
    `;
  }

  private async assignStaffInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
    assignments: StaffInvite['assignments'],
    autoProvisioned: boolean,
  ): Promise<void> {
    await this.ensureTenantMembershipAllowed(tx, userId);
    await tx.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role", "is_auto_provisioned")
      VALUES (${tenantId}::uuid, ${userId}::uuid, 'STAFF', ${autoProvisioned})
      ON CONFLICT ("tenant_id", "user_id") DO NOTHING
    `;
    for (const assignment of assignments) {
      await tx.$executeRaw`
        INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id") VALUES (${tenantId}::uuid, ${assignment.propertyId}::uuid, ${userId}::uuid, ${assignment.roleTemplateId}::uuid)
        ON CONFLICT ("tenant_id", "property_id", "user_id") DO UPDATE SET "role_template_id" = EXCLUDED."role_template_id"
      `;
      for (const key of assignment.capabilityKeys ?? []) {
        await tx.$executeRaw`
          INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
          SELECT ${tenantId}::uuid, ${assignment.propertyId}::uuid, ${userId}::uuid, "id", true FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${key}
          ON CONFLICT ("tenant_id", "property_id", "user_id", "capability_id") DO UPDATE SET "granted" = true
        `;
      }
    }
  }

  private async ensureTenantMembershipAllowed(
    tx: TenantTransaction,
    userId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ isPlatformAdmin: boolean }>>`
      SELECT "auth_is_platform_admin"(${userId}::uuid) AS "isPlatformAdmin"
    `;
    if (rows[0]?.isPlatformAdmin === true) {
      throw new BadRequestException('Platform admin accounts cannot join a tenant.');
    }
  }

  private isUniqueEmailViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      'meta' in error &&
      typeof (error as { meta?: unknown }).meta === 'object' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    );
  }

  private async ensureStaffSeatAvailable(
    tx: TenantTransaction,
    tenantId: string,
    invitee: { email?: string; userId?: string },
  ): Promise<void> {
    const plan = await tx.$queryRaw<Array<{ maxStaffSeats: number }>>`
      SELECT p."max_staff_seats" AS "maxStaffSeats"
      FROM "organizations" o
      JOIN "plans" p ON p."id" = o."plan_id"
      WHERE o."id" = ${tenantId}::uuid
      FOR UPDATE OF o
    `;
    if (!plan[0]) throw new BadRequestException('The tenant does not have a plan.');

    const existingMembership = invitee.userId
      ? await tx.$queryRaw<Array<{ found: boolean }>>`
          SELECT EXISTS(
            SELECT 1 FROM "tenant_memberships"
            WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${invitee.userId}::uuid
          ) AS "found"
        `
      : await tx.$queryRaw<Array<{ found: boolean }>>`
          SELECT EXISTS(
            SELECT 1
            FROM "tenant_memberships" tm
            JOIN "users" u ON u."id" = tm."user_id"
            WHERE tm."tenant_id" = ${tenantId}::uuid AND u."email" = ${invitee.email!.toLowerCase()}
          ) AS "found"
        `;
    if (existingMembership[0]?.found) return;

    const memberships = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::integer AS "count"
      FROM "tenant_memberships"
      WHERE "tenant_id" = ${tenantId}::uuid AND NOT "is_auto_provisioned"
    `;
    if ((memberships[0]?.count ?? 0) >= plan[0].maxStaffSeats) {
      throw new StaffSeatLimitReachedError(plan[0].maxStaffSeats, memberships[0]?.count ?? 0);
    }
  }
}

class StaffSeatLimitReachedError extends ConflictException {
  constructor(
    readonly maxStaffSeats: number,
    readonly staffSeats: number,
  ) {
    super('The current plan has reached its staff-seat limit.');
  }
}
