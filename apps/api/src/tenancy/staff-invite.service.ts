import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { NotificationsService } from './notifications.service';

export interface StaffInvite {
  tenantId: string;
  email: string;
  assignments: Array<{ propertyId: string; roleTemplateId: string; capabilityKeys?: string[] }>;
}

@Injectable()
export class StaffInviteService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private connection?: Promise<RedisClientType>;
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
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
    return token;
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
        await tx.$executeRaw`
          INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at")
          VALUES (${userId}::uuid, ${email.toLowerCase()}, ${await bcrypt.hash(password, 12)}, CURRENT_TIMESTAMP)
        `;
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
    await this.ensureTenantMembershipAllowed(tx, userId);
    await tx.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES (${invite.tenantId}::uuid, ${userId}::uuid, 'STAFF')
      ON CONFLICT ("tenant_id", "user_id") DO NOTHING
    `;
    for (const assignment of invite.assignments) {
      await tx.$executeRaw`
        INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id") VALUES (${invite.tenantId}::uuid, ${assignment.propertyId}::uuid, ${userId}::uuid, ${assignment.roleTemplateId}::uuid)
        ON CONFLICT ("tenant_id", "property_id", "user_id") DO UPDATE SET "role_template_id" = EXCLUDED."role_template_id"
      `;
      for (const key of assignment.capabilityKeys ?? []) {
        await tx.$executeRaw`
          INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
          SELECT ${invite.tenantId}::uuid, ${assignment.propertyId}::uuid, ${userId}::uuid, "id", true FROM "capabilities" WHERE "tenant_id" = ${invite.tenantId}::uuid AND "key" = ${key}
          ON CONFLICT ("tenant_id", "property_id", "user_id", "capability_id") DO UPDATE SET "granted" = true
        `;
      }
    }
    await this.auditLogs.recordInTransaction(tx, {
      tenantId: invite.tenantId,
      actorUserId: userId,
      action: 'staff.invite_accepted',
      targetType: 'user',
      targetId: userId,
      details: { propertyIds: invite.assignments.map((assignment) => assignment.propertyId) },
    });
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
      WHERE "tenant_id" = ${tenantId}::uuid
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
