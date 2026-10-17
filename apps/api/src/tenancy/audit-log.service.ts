import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export type AuditActorType = 'TENANT_USER' | 'PLATFORM_ADMIN';

export interface AuditEntry {
  actorUserId: string | null;
  actorType?: AuditActorType;
  action: string;
  targetType: string;
  targetId: string;
  tenantId?: string;
  propertyId?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async record(entry: AuditEntry): Promise<void> {
    if (!entry.tenantId) {
      await this.database.$executeRaw`
        INSERT INTO "audit_logs" ("actor_user_id", "actor_type", "action", "target_type", "target_id", "details")
        VALUES (${entry.actorUserId}::uuid, ${entry.actorType ?? 'TENANT_USER'}::"AuditActorType", ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${JSON.stringify(entry.details ?? {})}::jsonb)
      `;
      return;
    }
    await this.database.withTenantTransaction(
      { tenantId: entry.tenantId, propertyId: entry.propertyId },
      (tx) => this.recordInTransaction(tx, entry),
    );
  }

  async recordInTransaction(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "audit_logs" ("tenant_id", "property_id", "actor_user_id", "actor_type", "action", "target_type", "target_id", "details")
      VALUES (${entry.tenantId ?? null}::uuid, ${entry.propertyId ?? null}::uuid, ${entry.actorUserId}::uuid, ${entry.actorType ?? 'TENANT_USER'}::"AuditActorType", ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${JSON.stringify(entry.details ?? {})}::jsonb)
    `;
  }

  async list(tenantId: string): Promise<
    Array<{
      id: string;
      actorUserId: string | null;
      actorType: AuditActorType;
      action: string;
      targetType: string;
      targetId: string;
      propertyId: string | null;
      details: Record<string, unknown>;
      createdAt: Date;
    }>
  > {
    return this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Array<{
            id: string;
            actorUserId: string | null;
            actorType: AuditActorType;
            action: string;
            targetType: string;
            targetId: string;
            propertyId: string | null;
            details: Record<string, unknown>;
            createdAt: Date;
          }>
        >`
        SELECT "id", "actor_user_id" AS "actorUserId", "actor_type" AS "actorType", "action", "target_type" AS "targetType",
          "target_id" AS "targetId", "property_id" AS "propertyId", "details", "created_at" AS "createdAt"
        FROM "audit_logs"
        WHERE "tenant_id" = ${tenantId}::uuid
        ORDER BY "created_at" DESC
        LIMIT 100
      `,
    );
  }

  async listForProperty(
    tenantId: string,
    propertyId: string,
  ): Promise<Awaited<ReturnType<AuditLogService['list']>>> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<Awaited<ReturnType<AuditLogService['list']>>>`
        SELECT "id", "actor_user_id" AS "actorUserId", "actor_type" AS "actorType", "action", "target_type" AS "targetType",
          "target_id" AS "targetId", "property_id" AS "propertyId", "details", "created_at" AS "createdAt"
        FROM "audit_logs"
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
        ORDER BY "created_at" DESC
        LIMIT 10
      `,
    );
  }

  async listAccommodationsForProperty(
    tenantId: string,
    propertyId: string,
  ): Promise<
    Array<{
      id: string;
      actorUserId: string | null;
      actorName: string | null;
      action: string;
      targetType: string;
      targetId: string;
      createdAt: Date;
    }>
  > {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw`
        SELECT a.id, a.actor_user_id AS "actorUserId",
          COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS "actorName",
          a.action, a.target_type AS "targetType", a.target_id AS "targetId", a.created_at AS "createdAt"
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.tenant_id = ${tenantId}::uuid AND a.property_id = ${propertyId}::uuid
          AND (a.action LIKE 'room_type.%' OR a.action LIKE 'room_type_image.%'
            OR a.action LIKE 'room_type_images.%' OR a.action LIKE 'room_category.%' OR a.action LIKE 'room.%'
            OR a.action = 'accommodation.imported')
        ORDER BY a.created_at DESC
        LIMIT 20
      `,
    );
  }
}
