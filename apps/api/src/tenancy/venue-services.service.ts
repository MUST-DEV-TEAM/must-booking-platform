import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { parseServicesInput, type ServiceInput } from './venue-services-input';
import { loadVenuePlan, requireDining } from './venue-plan';

export type ServiceView = ServiceInput & { id: string };

@Injectable()
export class VenueServicesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(tenantId: string, venueId: string): Promise<ServiceView[]> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      return this.read(tx, tenantId, venueId);
    });
  }

  /** Replaces the whole list, so the setup screen can save the hours in one go. */
  async replace(
    tenantId: string,
    venueId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<ServiceView[]> {
    const services = parseServicesInput(body);
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      requireDining(await loadVenuePlan(tx, tenantId));
      await tx.$queryRaw`SELECT id FROM venues WHERE tenant_id=${tenantId}::uuid AND id=${venueId}::uuid FOR UPDATE`;
      const previous = await this.read(tx, tenantId, venueId);
      const explicitIds = new Set(services.flatMap((service) => (service.id ? [service.id] : [])));
      const retained = new Set<string>();
      const resolved = services.map((service) => {
        if (service.id && !previous.some((row) => row.id === service.id))
          throw new BadRequestException('The service does not belong to this restaurant.');
        const match = previous.find(
          (row) =>
            row.name.toLowerCase() === service.name.toLowerCase() &&
            !explicitIds.has(row.id) &&
            !retained.has(row.id),
        );
        const id = service.id ?? match?.id ?? randomUUID();
        retained.add(id);
        return { ...service, id };
      });
      await tx.$executeRaw`DELETE FROM venue_services WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND NOT(id=ANY(${[...retained]}::uuid[]))`;
      // Names are unique per venue. Temporary names allow two retained services to swap names.
      const names = new Set([...previous, ...services].map((row) => row.name.toLowerCase()));
      for (const row of previous.filter((row) => retained.has(row.id))) {
        let temporary: string;
        do {
          temporary = `__saving_${randomUUID()}`;
        } while (names.has(temporary.toLowerCase()));
        names.add(temporary.toLowerCase());
        await tx.$executeRaw`UPDATE venue_services SET name=${temporary} WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND id=${row.id}::uuid`;
      }
      for (const service of resolved) {
        await tx.$queryRaw`
          INSERT INTO "venue_services" ("id", "tenant_id", "venue_id", "name", "days", "opens_at", "closes_at", "slot_minutes")
          VALUES (${service.id}::uuid, ${tenantId}::uuid, ${venueId}::uuid, ${service.name}, ${service.days}::smallint[],
                  ${service.opensAt}::time, ${service.closesAt}::time, ${service.slotMinutes})
          ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, days=EXCLUDED.days,
            opens_at=EXCLUDED.opens_at, closes_at=EXCLUDED.closes_at, slot_minutes=EXCLUDED.slot_minutes,updated_at=now()
        `;
      }
      await tx.$executeRaw`UPDATE venues SET deposit_rules_version=deposit_rules_version+1 WHERE tenant_id=${tenantId}::uuid AND id=${venueId}::uuid AND deposit_rules_version>0`;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        actorUserId,
        action: 'venue.hours_changed',
        targetType: 'venue',
        targetId: venueId,
        details: { services: services.length },
      });
      return this.read(tx, tenantId, venueId);
    });
  }

  private read(tx: TenantTransaction, tenantId: string, venueId: string): Promise<ServiceView[]> {
    return tx.$queryRaw<ServiceView[]>`
      SELECT "id", "name", "days"::integer[] AS "days",
             to_char("opens_at", 'HH24:MI') AS "opensAt", to_char("closes_at", 'HH24:MI') AS "closesAt",
             "slot_minutes" AS "slotMinutes"
      FROM "venue_services"
      WHERE "tenant_id" = ${tenantId}::uuid AND "venue_id" = ${venueId}::uuid
      ORDER BY "opens_at", "name"
    `;
  }
}
