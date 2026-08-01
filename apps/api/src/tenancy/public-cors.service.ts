import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';

@Injectable()
export class PublicCorsService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async allows(tenantId: string, propertyId: string, origin: string): Promise<boolean> {
    const configuredOrigin = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ publicWebsiteOrigin: string | null }>>`
        SELECT public_website_origin AS "publicWebsiteOrigin"
        FROM properties
        WHERE id = ${propertyId}::uuid
        LIMIT 1
      `;
      return rows[0]?.publicWebsiteOrigin ?? null;
    });
    return configuredOrigin === origin;
  }
}
