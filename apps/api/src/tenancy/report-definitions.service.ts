import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { REPORT_METRICS } from './report-metrics';
import { TenantDatabaseService } from './tenant-database.service';

@Injectable()
export class ReportDefinitionsService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async get(tenantId: string, propertyId: string, canViewMoney: boolean) {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ timezone: string; clock: boolean }>>`
        SELECT p.timezone, EXISTS (
          SELECT 1 FROM property_integration_connections pc
          JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id
          WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid
            AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'
        ) AS clock FROM properties p
        WHERE p.tenant_id=${tenantId}::uuid AND p.id=${propertyId}::uuid
      `;
      const property = rows[0];
      if (!property) throw new NotFoundException('Property not found.');
      return {
        timezone: property.timezone,
        source: property.clock ? 'CLOCK' : 'LOCAL',
        basis: property.clock
          ? 'Synced from Clock — locally stored records; inventory Unknown'
          : 'MUST locally stored records',
        definitions: REPORT_METRICS.filter((metric) => canViewMoney || !metric.money),
      };
    });
  }
}
