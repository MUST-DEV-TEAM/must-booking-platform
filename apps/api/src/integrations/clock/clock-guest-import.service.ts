import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { AuditLogService } from '../../tenancy/audit-log.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import {
  ClockBookingReadError,
  ClockBookingConsistencyService,
} from './clock-booking-consistency.service';
import { parseClockCredentials } from './clock-credentials';
type Scope = { tenantId: string; propertyId: string; userId: string | null };
const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) || null : null;
@Injectable()
export class ClockGuestImportService {
  private readonly indexes = new Map<string, { expires: number; ids: string[] }>();
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingConsistencyService) private readonly reader: ClockBookingConsistencyService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  async list(scope: Scope, search = '') {
    if (search.length > 200) throw new BadRequestException('Search is too long.');
    const term = search.trim();
    return this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<
        Array<{
          id: string;
          email: string | null;
          firstName: string | null;
          lastName: string | null;
          phone: string | null;
          syncedAt: Date;
          externalGuestId: string;
        }>
      >`
   SELECT g.id,g.email,g.first_name AS "firstName",g.last_name AS "lastName",g.phone,g.synced_at AS "syncedAt",g.external_guest_id AS "externalGuestId"
   FROM clock_guest_profiles g JOIN property_integration_connections pc ON pc.tenant_id=g.tenant_id AND pc.property_id=g.property_id AND pc.connection_id=g.connection_id AND pc.enabled AND pc.kind='PMS'
   WHERE g.tenant_id=${scope.tenantId}::uuid AND g.property_id=${scope.propertyId}::uuid AND (${term}='' OR CONCAT_WS(' ',g.first_name,g.last_name,g.email,g.phone) ILIKE ${'%' + term + '%'})
   ORDER BY lower(COALESCE(g.last_name,'')),lower(COALESCE(g.first_name,'')),g.id LIMIT 500`,
    );
  }
  async batch(scope: Scope, body: Record<string, unknown>) {
    const from = body.updatedFrom,
      until = body.updatedUntil,
      cursor = body.cursor ?? '0';
    const valid = (v: unknown): v is string =>
      typeof v === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v;
    if (
      !valid(from) ||
      !valid(until) ||
      from >= until ||
      typeof cursor !== 'string' ||
      !/^\d{1,20}$/.test(cursor)
    )
      throw new BadRequestException('Choose valid guest update dates and saved progress.');
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new BadRequestException('Connect Clock before importing guest profiles.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new BadRequestException('The Clock connection needs attention.');
    const cacheKey = [scope.tenantId, scope.propertyId, connection.connectionId, from, until].join(
      ':',
    );
    let index = this.indexes.get(cacheKey);
    if (!index || index.expires < Date.now()) {
      let ids: string[];
      try {
        ids = await this.reader.guestIds(parsed.value, from, until);
      } catch (e) {
        if (e instanceof ClockBookingReadError)
          throw new BadRequestException(
            e.classified.category === 'authorization'
              ? 'Clock requires Personal Data: Access and Personal Data: Bulk Access for guest-directory import. Enable those rights for the sandbox API user, then resume.'
              : 'Clock guest data could not be read. Check the connection, then resume the same batch.',
          );
        throw e;
      }
      if (ids.length > 100000) throw new BadRequestException('Use a smaller guest-update range.');
      index = {
        ids: ids.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0)),
        expires: Date.now() + 1200000,
      };
      if (this.indexes.size >= 100) this.indexes.clear();
      this.indexes.set(cacheKey, index);
    }
    const remaining = index.ids.filter((id) => BigInt(id) > BigInt(cursor));
    const ids = remaining.slice(0, 5);
    for (const id of ids) {
      let guest: Record<string, unknown>;
      try {
        guest = await this.reader.guestDetail(parsed.value, id);
      } catch (e) {
        if (e instanceof ClockBookingReadError) {
          await this.audit.record({
            ...scope,
            actorUserId: scope.userId,
            action: 'clock.guest_import_interrupted',
            targetType: 'property',
            targetId: scope.propertyId,
            details: { category: e.classified.category, code: e.classified.code },
          });
          throw new BadRequestException(
            e.classified.category === 'authorization'
              ? 'Clock requires Personal Data: Access for guest details. Check the sandbox API user rights, then resume.'
              : 'Clock did not finish reading this guest batch. Resume to retry it without creating duplicates.',
          );
        }
        throw e;
      }
      const family = guest.family_id;
      if (
        (typeof family !== 'number' && typeof family !== 'string') ||
        !/^\d+$/.test(String(family))
      )
        throw new BadRequestException(
          'A Clock guest profile had no stable identity. Import paused without skipping it.',
        );
      const updated =
        typeof guest.updated_at === 'string' && !Number.isNaN(Date.parse(guest.updated_at))
          ? new Date(guest.updated_at)
          : null;
      await this.db.withTenantTransaction(
        scope,
        (
          tx,
        ) => tx.$executeRaw`INSERT INTO clock_guest_profiles(tenant_id,property_id,connection_id,external_guest_id,email,first_name,last_name,phone,provider_updated_at)
    VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${connection.connectionId}::uuid,${String(family)},${text(guest.e_mail, 320)},${text(guest.first_name, 100)},${text(guest.last_name, 100)},${text(guest.phone_number, 100)},${updated})
    ON CONFLICT(tenant_id,property_id,connection_id,external_guest_id) DO UPDATE SET email=EXCLUDED.email,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=EXCLUDED.phone,provider_updated_at=EXCLUDED.provider_updated_at,synced_at=now()
    WHERE clock_guest_profiles.provider_updated_at IS NULL OR EXCLUDED.provider_updated_at>=clock_guest_profiles.provider_updated_at`,
      );
    }
    await this.audit.record({
      ...scope,
      actorUserId: scope.userId,
      action: 'clock.guest_import_batch',
      targetType: 'property',
      targetId: scope.propertyId,
      details: { updatedFrom: from, updatedUntil: until, processed: ids.length },
    });
    return {
      processed: ids.length,
      total: index.ids.length,
      completed: remaining.length <= 5,
      cursor: ids.at(-1) ?? cursor,
    };
  }
}
@Controller('tenants/:tenantId/properties/:propertyId/clock-guests')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class ClockGuestImportController {
  constructor(@Inject(ClockGuestImportService) private readonly guests: ClockGuestImportService) {}
  @Get()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('guests.view')
  list(@Req() req: { tenantContext: Scope }, @Query('search') search?: string) {
    return this.guests.list(req.tenantContext, search ?? '');
  }
  @Post('import')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  batch(@Req() req: { tenantContext: Scope }, @Body() body: Record<string, unknown>) {
    return this.guests.batch(req.tenantContext, body ?? {});
  }
}
