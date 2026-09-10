import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';

export type ClockRateRankingRow = { externalRateId: string; rank: number };

/**
 * Milestone 21 Task 13: staff-defined priority order among a Clock room
 * type's `wbe: true` rates. Stores only Clock's own rate ids and an order —
 * never the rate data itself, which stays live in Clock (mirrors the
 * read-only spirit of `clock_catalog_mappings`). Read here by
 * `ClockAvailabilityService.selectBestOffer()` (Task 12) as an override to
 * its cheapest-wins default; written by staff through
 * `ClockRateRankingController`, which is also responsible for validating
 * submitted ids against Clock's real current rates before they ever reach
 * `setRanking`.
 */
@Injectable()
export class ClockRateRankingService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async getRanking(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<ClockRateRankingRow[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<ClockRateRankingRow[]>(
        `SELECT external_rate_id AS "externalRateId", rank FROM clock_rate_rankings
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND room_type_id = $3::uuid
         ORDER BY rank ASC`,
        tenantId,
        propertyId,
        roomTypeId,
      ),
    );
  }

  /** Just the ordered rate ids — what `selectBestOffer()` needs, without the
   * DB row shape. Empty when the room type has no ranking configured yet. */
  async rankOrder(tenantId: string, propertyId: string, roomTypeId: string): Promise<string[]> {
    const rows = await this.getRanking(tenantId, propertyId, roomTypeId);
    return rows.map((row) => row.externalRateId);
  }

  /**
   * Replaces the entire ranking for a room type in one transaction — staff
   * always submits the full reordered list (rank = array index), never a
   * partial shuffle, so there is no "insert at rank 3" conflict to resolve.
   */
  async setRanking(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    externalRateIds: string[],
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM clock_rate_rankings
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND room_type_id = $3::uuid`,
        tenantId,
        propertyId,
        roomTypeId,
      );
      for (const [index, externalRateId] of externalRateIds.entries()) {
        await tx.$executeRawUnsafe(
          `INSERT INTO clock_rate_rankings
             (tenant_id, property_id, room_type_id, external_rate_id, rank)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
          tenantId,
          propertyId,
          roomTypeId,
          externalRateId,
          index,
        );
      }
    });
  }
}
