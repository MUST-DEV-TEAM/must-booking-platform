import { BadRequestException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';

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
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async invite(command: StaffInvite, actorUserId: string): Promise<string> {
    if (!command.assignments.length)
      throw new BadRequestException('At least one property assignment is required.');
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
    const value = await this.client().then((redis) =>
      redis.getDel(`auth:staff-invite:${this.hash(token)}`),
    );
    if (!value) throw new BadRequestException('Invalid or expired staff invitation.');
    const invite = JSON.parse(value) as StaffInvite;
    await this.database.withTenantTransaction({ tenantId: invite.tenantId }, async (tx) => {
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
    });
  }

  async activate(token: string, email: string, password: string): Promise<void> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      throw new BadRequestException(
        'A valid email and a password of at least 12 characters are required.',
      );
    }
    const userId = randomUUID();
    try {
      await this.database.$executeRaw`
        INSERT INTO "users" ("id", "email", "password_hash") VALUES (${userId}::uuid, ${email.toLowerCase()}, ${await bcrypt.hash(password, 12)})
      `;
    } catch (error: unknown) {
      if (this.isUniqueEmailViolation(error)) {
        throw new BadRequestException('This invitation requires a new user account.');
      }
      throw error;
    }
    await this.accept(token, userId);
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
}
