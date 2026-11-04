import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';
import { loadVenuePlan } from './venue-plan';
import { VenuesService, type VenueView } from './venues.service';

export type RestaurantIntegrationStatus = {
  /** Restaurants are currently available on every plan. */
  available: boolean;
  /** The restaurant of this hotel, if it has ever been switched on. */
  venue: Pick<VenueView, 'id' | 'name' | 'active' | 'setupCompletedAt'> | null;
};

/**
 * The Restaurant integration of a hotel: off until an owner or admin switches it on, and switching
 * it off hides it but keeps everything that was set up. A hotel has one restaurant this way.
 */
@Injectable()
export class RestaurantIntegrationService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(VenuesService) private readonly venues: VenuesService,
  ) {}

  async status(tenantId: string, propertyId: string): Promise<RestaurantIntegrationStatus> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const plan = await loadVenuePlan(tx, tenantId);
      const rows = await tx.$queryRaw<NonNullable<RestaurantIntegrationStatus['venue']>[]>`
        SELECT "id", "name", "active", "setup_completed_at" AS "setupCompletedAt"
        FROM "venues"
        WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
        ORDER BY "created_at" LIMIT 1
      `;
      return { available: plan.diningEnabled, venue: rows[0] ?? null };
    });
  }

  async activate(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
  ): Promise<RestaurantIntegrationStatus> {
    const existing = (await this.status(tenantId, propertyId)).venue;
    if (existing) await this.venues.activate(tenantId, existing.id, actorUserId);
    else {
      const property = await this.database.withTenantTransaction(
        { tenantId },
        (tx) =>
          tx.$queryRaw<
            Array<{
              name: string;
              timezone: string | null;
              currency: string | null;
              phone: string | null;
            }>
          >`
          SELECT "name", "timezone", "default_currency" AS "currency", "phone" FROM "properties"
          WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${propertyId}::uuid
        `,
      );
      if (!property[0]) throw new NotFoundException('Hotel was not found.');
      await this.venues.create(tenantId, actorUserId, {
        name: `${property[0].name} Restaurant`,
        timezone: property[0].timezone ?? undefined,
        currency: property[0].currency ?? undefined,
        phone: property[0].phone ?? undefined,
        propertyId,
      });
    }
    return this.status(tenantId, propertyId);
  }

  async deactivate(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
  ): Promise<RestaurantIntegrationStatus> {
    const existing = (await this.status(tenantId, propertyId)).venue;
    if (existing?.active) await this.venues.deactivate(tenantId, existing.id, actorUserId);
    return this.status(tenantId, propertyId);
  }
}
