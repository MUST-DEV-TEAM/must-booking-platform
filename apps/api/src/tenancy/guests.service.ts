import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';

export type GuestDirectoryEntry = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  bookingCount: number;
  mostRecentStartsOn: string;
  mostRecentEndsOn: string;
};

@Injectable()
export class GuestsService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  list(
    tenantId: string,
    propertyId: string,
    search: string | undefined,
  ): Promise<GuestDirectoryEntry[]> {
    const normalizedSearch = search?.trim() ?? '';
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<GuestDirectoryEntry[]>`
        SELECT g.id, g.email, g.first_name AS "firstName", g.last_name AS "lastName", g.phone,
          COUNT(b.id)::int AS "bookingCount",
          recent.starts_on::text AS "mostRecentStartsOn",
          recent.ends_on::text AS "mostRecentEndsOn"
        FROM guests g
        JOIN bookings b
          ON b.tenant_id = g.tenant_id AND b.guest_id = g.id
          AND b.property_id = ${propertyId}::uuid
        JOIN LATERAL (
          SELECT latest.starts_on, latest.ends_on
          FROM bookings latest
          WHERE latest.tenant_id = g.tenant_id AND latest.property_id = ${propertyId}::uuid
            AND latest.guest_id = g.id
          ORDER BY latest.starts_on DESC, latest.created_at DESC, latest.id DESC
          LIMIT 1
        ) recent ON true
        WHERE g.tenant_id = ${tenantId}::uuid
          AND (${normalizedSearch} = ''
            OR CONCAT_WS(' ', g.first_name, g.last_name) ILIKE ${`%${normalizedSearch}%`}
            OR g.email ILIKE ${`%${normalizedSearch}%`}
            OR COALESCE(g.phone, '') ILIKE ${`%${normalizedSearch}%`})
        GROUP BY g.id, g.email, g.first_name, g.last_name, g.phone, recent.starts_on, recent.ends_on
        ORDER BY recent.starts_on DESC, g.email ASC
      `,
    );
  }
}
