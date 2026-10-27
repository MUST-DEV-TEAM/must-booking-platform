import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';

/** How long the list of switched-off rates is remembered before it is read again. */
const HIDDEN_RATES_TTL_MS = 30_000;

/**
 * Which Clock rates staff switched off for the hotel's website. Every rate Clock publishes for online booking is
 * sold on the website by default; a rate has a row here only while it is off, so a rate added in Clock is sold as
 * soon as it is published there. Only the guest-facing website honours this list; staff booking screens always
 * see every rate. Clock stays the source of the rate and its price.
 */
@Injectable()
export class ClockWebsiteRatesService {
  private readonly remembered = new Map<string, { ids: Set<string>; expiresAt: number }>();

  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  /** The Clock rate ids switched off for the website. Empty when every rate is on. */
  async hiddenRateIds(tenantId: string, propertyId: string): Promise<Set<string>> {
    const key = `${tenantId}:${propertyId}`;
    const known = this.remembered.get(key);
    if (known && known.expiresAt > Date.now()) return known.ids;
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<Array<{ externalRateId: string }>>(
        `SELECT external_rate_id AS "externalRateId" FROM clock_website_hidden_rates
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid`,
        tenantId,
        propertyId,
      ),
    );
    const ids = new Set(rows.map((row) => row.externalRateId));
    this.remembered.set(key, { ids, expiresAt: Date.now() + HIDDEN_RATES_TTL_MS });
    return ids;
  }

  /** Switches one rate on or off for the website. Returns false when nothing changed. */
  async setOnWebsite(
    tenantId: string,
    propertyId: string,
    externalRateId: string,
    onWebsite: boolean,
    userId?: string,
  ): Promise<boolean> {
    const changed = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        if (onWebsite) {
          const removed = await tx.$executeRawUnsafe(
            `DELETE FROM clock_website_hidden_rates
           WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND external_rate_id = $3`,
            tenantId,
            propertyId,
            externalRateId,
          );
          return removed > 0;
        }
        const added = await tx.$executeRawUnsafe(
          `INSERT INTO clock_website_hidden_rates (tenant_id, property_id, external_rate_id, hidden_by_user_id)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
         ON CONFLICT (tenant_id, property_id, external_rate_id) DO NOTHING`,
          tenantId,
          propertyId,
          externalRateId,
          userId ?? null,
        );
        return added > 0;
      },
    );
    this.remembered.delete(`${tenantId}:${propertyId}`);
    return changed;
  }
}
