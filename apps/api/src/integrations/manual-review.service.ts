import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';

export type ManualReviewCategory =
  | 'UNKNOWN_RESULT'
  | 'DUPLICATE'
  | 'MISSING_MAPPING'
  | 'SIMULTANEOUS_CHANGE'
  | 'PAYMENT_BOOKING_MISMATCH'
  | 'UNKNOWN_STATUS'
  | 'SCHEMA_MISMATCH';

export interface ManualReviewItem {
  id: string;
  category: ManualReviewCategory;
  referenceType: string;
  referenceId: string | null;
  message: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
}

export interface RecordManualReviewInput {
  tenantId: string;
  propertyId: string;
  connectionId?: string | null;
  category: ManualReviewCategory;
  referenceType: string;
  referenceId?: string | null;
  message: string;
  context?: unknown;
}

// Source brief section 26: an unknown/ambiguous Clock result must never be
// silently treated as success — this is where it lands instead. Generic
// naming (not Clock-specific) to match provider_events.
@Injectable()
export class ManualReviewService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async record(input: RecordManualReviewInput): Promise<void> {
    await this.database.withTenantTransaction(
      { tenantId: input.tenantId, propertyId: input.propertyId },
      (tx) => this.recordInTransaction(tx, input),
    );
  }

  async recordInTransaction(tx: TenantTransaction, input: RecordManualReviewInput): Promise<void> {
    await tx.$executeRawUnsafe(
      `INSERT INTO manual_review_items (
         tenant_id, property_id, connection_id, category, reference_type, reference_id, message, context
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"ManualReviewCategory", $5, $6, $7, $8::jsonb)`,
      input.tenantId,
      input.propertyId,
      input.connectionId ?? null,
      input.category,
      input.referenceType,
      input.referenceId ?? null,
      input.message,
      input.context === undefined ? null : JSON.stringify(input.context),
    );
  }

  list(tenantId: string, propertyId?: string): Promise<ManualReviewItem[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<ManualReviewItem[]>`
        SELECT id, category, reference_type AS "referenceType", reference_id AS "referenceId",
          message, status, created_at AS "createdAt", resolved_at AS "resolvedAt"
        FROM manual_review_items
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY status ASC, created_at DESC
      `,
    );
  }

  async resolve(tenantId: string, itemId: string, actorUserId: string): Promise<void> {
    await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$executeRaw`
        UPDATE manual_review_items
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ${actorUserId}::uuid,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND id = ${itemId}::uuid AND status = 'OPEN'
      `,
    );
  }
}
