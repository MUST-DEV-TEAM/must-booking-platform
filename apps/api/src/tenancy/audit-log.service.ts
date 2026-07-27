import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

export interface AuditEntry {
  actorUserId: string;
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
        INSERT INTO "audit_logs" ("actor_user_id", "action", "target_type", "target_id", "details")
        VALUES (${entry.actorUserId}::uuid, ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${JSON.stringify(entry.details ?? {})}::jsonb)
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
      INSERT INTO "audit_logs" ("tenant_id", "property_id", "actor_user_id", "action", "target_type", "target_id", "details")
      VALUES (${entry.tenantId ?? null}::uuid, ${entry.propertyId ?? null}::uuid, ${entry.actorUserId}::uuid, ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${JSON.stringify(entry.details ?? {})}::jsonb)
    `;
  }

  async list(tenantId: string): Promise<
    Array<{
      id: string;
      actorUserId: string;
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
            actorUserId: string;
            action: string;
            targetType: string;
            targetId: string;
            propertyId: string | null;
            details: Record<string, unknown>;
            createdAt: Date;
          }>
        >`
        SELECT "id", "actor_user_id" AS "actorUserId", "action", "target_type" AS "targetType",
          "target_id" AS "targetId", "property_id" AS "propertyId", "details", "created_at" AS "createdAt"
        FROM "audit_logs"
        WHERE "tenant_id" = ${tenantId}::uuid
        ORDER BY "created_at" DESC
        LIMIT 100
      `,
    );
  }
}
