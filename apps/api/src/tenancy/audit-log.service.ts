import { currentAuditContext } from './audit-request-context';
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
      await this.database.$transaction(async (tx) => {
        await this.recordAccountEventInTransaction(tx, entry);
      });
      return;
    }
    await this.database.withTenantTransaction(
      { tenantId: entry.tenantId, propertyId: entry.propertyId },
      (tx) => this.recordInTransaction(tx, entry),
    );
  }

  async recordInTransaction(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "audit_logs" ("tenant_id", "property_id", "actor_user_id", "actor_type", "action", "target_type", "target_id", "details", "request_context")
      VALUES (${entry.tenantId ?? null}::uuid, ${entry.propertyId ?? null}::uuid, ${entry.actorUserId}::uuid, ${entry.actorType ?? 'TENANT_USER'}::"AuditActorType", ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${JSON.stringify(entry.details ?? {})}::jsonb, ${JSON.stringify(currentAuditContext())}::jsonb)
    `;
  }

  /** Copy new successful account observations only to the properties accessible at occurrence. */
  async recordAccountEventInTransaction(tx: TenantTransaction, entry: AuditEntry): Promise<void> {
    await this.recordInTransaction(tx, entry);
    if (
      !entry.actorUserId ||
      !['auth.login', 'auth.logout', 'auth.password_changed', 'auth.session_revoked'].includes(
        entry.action,
      )
    )
      return;
    const memberships = await tx.$queryRaw<
      { tenantId: string; role: string }[]
    >`SELECT "tenantId",role FROM auth_list_user_tenants(${entry.actorUserId}::uuid)`;
    for (const membership of memberships) {
      await tx.$executeRaw`SELECT set_config('app.tenant_id',${membership.tenantId},true),set_config('app.property_id','',true)`;
      const properties = await tx.$queryRaw<
        { id: string }[]
      >`SELECT p.id FROM properties p WHERE p.tenant_id=${membership.tenantId}::uuid AND (${['OWNER', 'ADMIN'].includes(membership.role)} OR EXISTS(SELECT 1 FROM property_staff_assignments s WHERE s.tenant_id=${membership.tenantId}::uuid AND s.property_id=p.id AND s.user_id=${entry.actorUserId}::uuid AND s.suspended_at IS NULL))`;
      for (const property of properties) {
        await tx.$executeRaw`SELECT set_config('app.property_id',${property.id},true)`;
        await this.recordInTransaction(tx, {
          ...entry,
          tenantId: membership.tenantId,
          propertyId: property.id,
          details: {
            ...entry.details,
            result: 'succeeded',
            scope: 'Account event; property access existed at occurrence',
          },
        });
      }
    }
    await tx.$executeRaw`SELECT set_config('app.tenant_id','',true),set_config('app.property_id','',true)`;
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
      targetName: string | null;
      details: Record<string, unknown>;
      createdAt: Date;
    }>
  > {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw`
        SELECT a.id, a.actor_user_id AS "actorUserId",
          COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS "actorName",
          a.action, a.target_type AS "targetType", a.target_id AS "targetId",
          COALESCE(
            NULLIF(a.details->>'targetName', ''),
            room_type.name, room.name, category.name,
            CASE a.target_type WHEN 'accommodation_import' THEN
              CASE a.details->>'kind' WHEN 'room-types' THEN 'room types' WHEN 'rooms' THEN 'rooms' ELSE 'accommodation data' END
            END
          ) AS "targetName",
          CASE WHEN a.action IN ('room_type.status_changed', 'room.active_changed')
            THEN jsonb_build_object('to', a.details->'to') ELSE '{}'::jsonb END AS "details",
          a.created_at AS "createdAt"
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        LEFT JOIN room_type_images type_image ON type_image.tenant_id = a.tenant_id
          AND type_image.property_id = a.property_id AND type_image.id::text = a.target_id
        LEFT JOIN room_images room_image ON room_image.tenant_id = a.tenant_id
          AND room_image.property_id = a.property_id AND room_image.id::text = a.target_id
        LEFT JOIN room_types room_type ON room_type.tenant_id = a.tenant_id
          AND room_type.property_id = a.property_id AND room_type.id::text = CASE
            WHEN a.target_type = 'room_type' THEN a.target_id
            WHEN a.target_type = 'room_type_image' THEN COALESCE(type_image.room_type_id::text, a.details->>'roomTypeId')
          END
        LEFT JOIN rooms room ON room.tenant_id = a.tenant_id
          AND room.property_id = a.property_id AND room.id::text = CASE
            WHEN a.target_type = 'room' THEN a.target_id
            WHEN a.target_type = 'room_image' THEN COALESCE(room_image.room_id::text, a.details->>'roomId')
          END
        LEFT JOIN room_categories category ON a.target_type = 'room_category'
          AND category.tenant_id = a.tenant_id
          AND category.property_id = a.property_id AND category.id::text = a.target_id
        WHERE a.tenant_id = ${tenantId}::uuid AND a.property_id = ${propertyId}::uuid
          AND (a.action LIKE 'room_type.%' OR a.action LIKE 'room_type_image.%'
            OR a.action LIKE 'room_type_images.%' OR a.action LIKE 'room_category.%' OR a.action LIKE 'room.%'
            OR a.action = 'accommodation.imported')
        ORDER BY a.created_at DESC
        LIMIT 100
      `,
    );
  }
}
