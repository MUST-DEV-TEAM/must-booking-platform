import { Inject, Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { AuditLogService } from '../../tenancy/audit-log.service';

export type ClockRatePairs = Record<string, string>;

@Injectable()
export class ClockRatePairsService {
  private readonly remembered = new Map<string, { pairs: ClockRatePairs; expiresAt: number }>();

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async pairs(tenantId: string, propertyId: string): Promise<ClockRatePairs> {
    const key = `${tenantId}:${propertyId}`;
    const known = this.remembered.get(key);
    if (known && known.expiresAt > Date.now()) return known.pairs;
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ promoRateId: string; compareRateId: string }>>(
        `SELECT promo_rate_id AS "promoRateId", compare_rate_id AS "compareRateId"
         FROM clock_rate_pairs WHERE tenant_id=$1::uuid AND property_id=$2::uuid`,
        tenantId,
        propertyId,
      ),
    );
    const pairs = Object.fromEntries(rows.map((row) => [row.promoRateId, row.compareRateId]));
    this.remembered.set(key, { pairs, expiresAt: Date.now() + 30_000 });
    return pairs;
  }

  async setPair(
    tenantId: string,
    propertyId: string,
    promoRateId: string,
    compareRateId: string | null,
    userId: string,
  ): Promise<boolean> {
    const changed = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const count =
          compareRateId === null
            ? await tx.$executeRawUnsafe(
                `DELETE FROM clock_rate_pairs WHERE tenant_id=$1::uuid AND property_id=$2::uuid AND promo_rate_id=$3`,
                tenantId,
                propertyId,
                promoRateId,
              )
            : await tx.$executeRawUnsafe(
                `INSERT INTO clock_rate_pairs (tenant_id,property_id,promo_rate_id,compare_rate_id,created_by_user_id)
             VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid)
             ON CONFLICT (tenant_id,property_id,promo_rate_id) DO UPDATE
             SET compare_rate_id=EXCLUDED.compare_rate_id, created_by_user_id=EXCLUDED.created_by_user_id, created_at=CURRENT_TIMESTAMP
             WHERE clock_rate_pairs.compare_rate_id IS DISTINCT FROM EXCLUDED.compare_rate_id`,
                tenantId,
                propertyId,
                promoRateId,
                compareRateId,
                userId,
              );
        if (count > 0)
          await this.audit.recordInTransaction(tx, {
            tenantId,
            propertyId,
            actorUserId: userId,
            action: 'rates.pair_changed',
            targetType: 'clock_rate',
            targetId: promoRateId,
            details: { promoRateId, compareRateId },
          });
        return count > 0;
      },
    );
    this.remembered.delete(`${tenantId}:${propertyId}`);
    return changed;
  }
}
