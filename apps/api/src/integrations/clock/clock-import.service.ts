import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Injectable,
  Post,
  Req,
} from '@nestjs/common';
import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { AuditLogService } from '../../tenancy/audit-log.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockBookingConsistencyService } from './clock-booking-consistency.service';
import { ClockBookingHydrationService } from './clock-booking-hydration.service';
import { parseClockCredentials } from './clock-credentials';

type Scope = { tenantId: string; propertyId: string; userId: string };
const day = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const plus = (v: string, n: number) =>
  new Date(Date.parse(v) + n * 86400000).toISOString().slice(0, 10);
/** Bounded, resumable read from Clock; local upserts reuse the fenced webhook hydrator.
 * No provider writes, payment recreation or historical notification delivery.
 */
@Injectable()
export class ClockImportService {
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingConsistencyService) private readonly reader: ClockBookingConsistencyService,
    @Inject(ClockBookingHydrationService) private readonly hydration: ClockBookingHydrationService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  async batch(scope: Scope, body: Record<string, unknown>) {
    const { startsOn, endsOn } = body;
    const windowStart = body.windowStart ?? startsOn;
    const cursor = body.cursor ?? '0';
    if (
      !day(startsOn) ||
      !day(endsOn) ||
      !day(windowStart) ||
      startsOn >= endsOn ||
      endsOn > plus(startsOn, 366) ||
      windowStart < startsOn ||
      windowStart >= endsOn ||
      typeof cursor !== 'string' ||
      !/^\d{1,20}$/.test(cursor)
    )
      throw new BadRequestException(
        'Choose a valid import range of up to 366 days and its current progress.',
      );
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new BadRequestException('Import is available only for a connected Clock hotel.');
    const credentials = parseClockCredentials(connection.credentials);
    if (!credentials.ok) throw new BadRequestException('The Clock connection needs attention.');
    const windowEnd = plus(windowStart, 31) < endsOn ? plus(windowStart, 31) : endsOn;
    const ids = [
      ...new Set(
        await this.reader.listBookingIds(credentials.value, {
          startsOn: windowStart,
          endsOn: windowEnd,
        }),
      ),
    ]
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
      .filter((id) => BigInt(id) > BigInt(cursor));
    const batch = ids.slice(0, 5);
    const outcomes: Array<{ clockBookingId: string; outcome: string }> = [];
    for (const id of batch) {
      const result = await this.hydration.hydrateBooking(
        scope.tenantId,
        scope.propertyId,
        connection.connectionId,
        id,
        undefined,
        { notify: false },
      );
      outcomes.push({ clockBookingId: id, outcome: result.outcome });
      if (!['created', 'updated'].includes(result.outcome)) break; // never silently skip a mapping or unknown status
    }
    const blocked = outcomes.some((r) => !['created', 'updated'].includes(r.outcome));
    const completed = !blocked && batch.length === ids.length && windowEnd === endsOn;
    const next = blocked
      ? { windowStart, cursor }
      : batch.length < ids.length
        ? { windowStart, cursor: batch[batch.length - 1]! }
        : { windowStart: windowEnd, cursor: '0' };
    await this.audit.record({
      tenantId: scope.tenantId,
      propertyId: scope.propertyId,
      actorUserId: scope.userId,
      action: 'clock.import_batch',
      targetType: 'property',
      targetId: scope.propertyId,
      details: { startsOn, endsOn, windowStart, processed: outcomes.length, blocked, completed },
    });
    return { outcomes, blocked, completed, next, checkedAt: new Date().toISOString() };
  }
}
@Controller('tenants/:tenantId/properties/:propertyId/clock-import')
@Roles(Role.TenantOwner, Role.TenantAdmin)
export class ClockImportController {
  constructor(@Inject(ClockImportService) private readonly imports: ClockImportService) {}
  @Post()
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  batch(@Req() req: { tenantContext: Scope }, @Body() body: Record<string, unknown>) {
    return this.imports.batch(req.tenantContext, body ?? {});
  }
}
