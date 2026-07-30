import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantDatabaseService } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';

type Property = { id: string; name: string; address: string; timezone: string };
@Injectable()
export class PropertiesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  list(tenantId: string): Promise<Property[]> {
    return this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Property[]
        >`SELECT id, name, address, timezone FROM properties ORDER BY created_at`,
    );
  }
  async create(tenantId: string, actorUserId: string, body: unknown): Promise<Property> {
    const input = this.input(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const limit = await tx.$queryRaw<
        Array<{ maxProperties: number }>
      >`SELECT p.max_properties AS "maxProperties" FROM organizations o JOIN plans p ON p.id=o.plan_id WHERE o.id=${tenantId}::uuid FOR UPDATE OF o`;
      const count = await tx.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*) AS count FROM properties`;
      if (!limit[0] || Number(count[0].count) >= limit[0].maxProperties)
        throw new ConflictException('Property limit reached. Upgrade to unlock more properties.');
      const slug = `${
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 90) || 'property'
      }-${id.slice(0, 8)}`;
      const rows = await tx.$queryRaw<
        Property[]
      >`INSERT INTO properties (id, tenant_id, name, slug, address, timezone) VALUES (${id}::uuid, ${tenantId}::uuid, ${input.name}, ${slug}, ${input.address}, ${input.timezone}) RETURNING id, name, address, timezone`;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId: id,
        actorUserId,
        action: 'property.created',
        targetType: 'property',
        targetId: id,
      });
      return rows[0];
    });
  }
  private input(body: unknown): { name: string; address: string; timezone: string } {
    const v = body as Record<string, unknown>;
    const field = (k: string) => (typeof v?.[k] === 'string' && v[k].trim() ? v[k].trim() : null);
    const name = field('name'),
      address = field('address'),
      timezone = field('timezone');
    if (!name || !address || !timezone)
      throw new BadRequestException('name, address, and timezone are required.');
    if (name.length > 200 || address.length > 500 || timezone.length > 100)
      throw new BadRequestException('Invalid property details.');
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new BadRequestException('timezone must be a valid IANA timezone.');
    }
    return { name, address, timezone };
  }
}
