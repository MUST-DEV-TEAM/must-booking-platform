import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { reportOperationalFailure } from '../observability/error-tracking';

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

/**
 * `<category>:<kind>:<referenceType>:<referenceId>`, plus `:<operationKey>` when the caller names one;
 * no key (always a new item) without a reference id. Resolvers close items by `context.operationKey`,
 * so two operations on one booking must never share an item.
 */
function buildDedupeKey(input: RecordManualReviewInput): string | null {
  if (!input.referenceId) return null;
  const context =
    typeof input.context === 'object' && input.context !== null
      ? (input.context as { kind?: unknown; operationKey?: unknown })
      : {};
  const kind = typeof context.kind === 'string' ? context.kind : '';
  const operation =
    typeof context.operationKey === 'string' && context.operationKey
      ? `:${context.operationKey}`
      : '';
  return `${input.category}:${kind}:${input.referenceType}:${input.referenceId}${operation}`;
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
    const context = input.context === undefined ? null : JSON.stringify(input.context);
    const dedupeKey = buildDedupeKey(input);
    if (dedupeKey !== null) {
      // Two writers for the same thing must not both insert: serialise them on the key.
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `${input.tenantId}:${input.propertyId}:${dedupeKey}`,
      );
      const updated = await tx.$executeRawUnsafe(
        `UPDATE manual_review_items
         SET occurrences = occurrences + 1, last_seen_at = now(), message = $4, context = $5::jsonb,
             updated_at = now()
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND dedupe_key = $3 AND status = 'OPEN'`,
        input.tenantId,
        input.propertyId,
        dedupeKey,
        input.message,
        context,
      );
      // A repeat of an item a person has not dealt with yet: counted, not alerted again.
      if (updated > 0) return;
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO manual_review_items (
         tenant_id, property_id, connection_id, category, reference_type, reference_id, message, context,
         dedupe_key, occurrences, last_seen_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"ManualReviewCategory", $5, $6, $7, $8::jsonb,
         $9, 1, now())`,
      input.tenantId,
      input.propertyId,
      input.connectionId ?? null,
      input.category,
      input.referenceType,
      input.referenceId ?? null,
      input.message,
      context,
      dedupeKey,
    );
    // Every category here means something needs a human to look — Clock
    // certification gap (docs/CLOCK_CERTIFICATION_GAPS_PLAN.md): the row was
    // always recorded for real, but until now nothing surfaced it in real
    // time, only a manual check of the list. One hook here covers every
    // category (schema mismatches, unmapped catalog entries, unknown
    // results, etc.) rather than alerting at each of the many call sites
    // individually.
    reportOperationalFailure(new Error(`Manual review required: ${input.message}`), {
      component: 'clock',
      operation: `manual-review.${input.category.toLowerCase()}`,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
    });
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
