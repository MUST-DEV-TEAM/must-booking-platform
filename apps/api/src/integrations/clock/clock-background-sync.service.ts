import { withClockBackgroundWork } from './clock-request-context';
import {
  BOOKINGS_IMPORT_VERSION,
  buildSyncSummary,
  type SyncCounts,
  type SyncJobRow,
} from './clock-sync-progress';
import { ClockFinancialService, ClockFinancialCurrencyError } from './clock-financial.service';
import { Param } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Post,
  Query,
  Req,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { CapabilitiesService } from '../../tenancy/capabilities.service';
import { TenantScoped } from '../../tenancy/tenant-context.decorator';
import { RequiresCapability } from '../../tenancy/capabilities.decorator';
import { RequiresVerifiedEmail } from '../../auth/requires-verified-email.decorator';
import { Role, Roles } from '../../tenancy/roles.decorator';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';
import { ClockAvailabilityService } from './clock-availability.service';
import {
  ClockBookingConsistencyService,
  ClockBookingReadError,
} from './clock-booking-consistency.service';
import { ClockBookingHydrationService } from './clock-booking-hydration.service';
import { ClockGuestImportService } from './clock-guest-import.service';
import { ClockRateRankingService } from './clock-rate-ranking.service';
import { parseClockCredentials } from './clock-credentials';
import { occupancyFromRates } from './clock-rate-occupancy';

type Scope = { tenantId: string; propertyId: string; connectionId: string };
type Job = {
  id: string;
  resource: string;
  progress: Record<string, unknown>;
  snapshot: {
    highWater?: string;
    schemaVersion?: number;
    initialTotal?: number;
    skipped?: number;
  } | null;
  processed: number;
  leaseToken: string;
};
const monthOf = (date: Date) => date.toISOString().slice(0, 7);
const enabled = () => process.env.CLOCK_BACKGROUND_SYNC_ENABLED === 'true';
/** Durable local projections only. Provider commands and financial effects are never executed here. */
/**
 * What may be logged about a failure: the kind of error, its code and the rule that refused a row. Never the
 * message itself, because a database message can quote the failing row, which holds guest details.
 */
const errorText = (error: unknown) => {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as { code?: unknown }).code;
  const dbCode = (error as { meta?: { code?: unknown } }).meta?.code;
  const constraint = /constraint "([A-Za-z0-9_]{1,80})"/.exec(error.message)?.[1];
  return [
    error.name,
    typeof code === 'string' ? `code ${code}` : null,
    typeof dbCode === 'string' ? `database code ${dbCode}` : null,
    constraint ? `rule ${constraint}` : null,
  ]
    .filter(Boolean)
    .join(', ');
};
/** The database refused the row by one of its rules (check constraint 23514), so retrying cannot help. */
const isUnsavableBooking = (error: unknown) =>
  error instanceof Error && /violates check constraint|\b23514\b/.test(error.message);

@Injectable()
export class ClockBackgroundSyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly logger = new Logger(ClockBackgroundSyncService.name);
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockCatalogSyncService) private readonly catalog: ClockCatalogSyncService,
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockBookingConsistencyService) private readonly reader: ClockBookingConsistencyService,
    @Inject(ClockBookingHydrationService) private readonly hydration: ClockBookingHydrationService,
    @Inject(ClockGuestImportService) private readonly guests: ClockGuestImportService,
    @Inject(ClockRateRankingService) private readonly rankings: ClockRateRankingService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
  ) {}
  onModuleInit() {
    if (!enabled()) return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private allowed(propertyId: string) {
    const filter = process.env.CLOCK_SYNC_ALLOWED_PROPERTY_IDS?.split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    return !filter?.length || filter.includes(propertyId);
  }
  private async scope(tenantId: string, propertyId: string): Promise<Scope | null> {
    const rows = await this.db.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<
          Array<{ connectionId: string }>
        >`SELECT pc.connection_id AS "connectionId" FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS' AND c.status='CONNECTED'`,
    );
    return rows[0] ? { tenantId, propertyId, connectionId: rows[0].connectionId } : null;
  }
  async ensure(scope: Scope, resources?: string[]) {
    const now = new Date();
    const months = Array.from({ length: 13 }, (_, i) =>
      monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))),
    );
    const keys = resources ?? [
      'catalog',
      'rooms',
      'rates',
      ...months.map((m) => 'availability:' + m),
      'bookings',
      'guests',
    ];
    await this.db.withTenantTransaction(scope, async (tx) => {
      if (!resources)
        await tx.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,next_run_at) SELECT tenant_id,property_id,${scope.connectionId}::uuid,'financial:'||id::text,now() FROM bookings WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND external_booking_id IS NOT NULL AND status='CONFIRMED' AND ends_on>=current_date-30 ON CONFLICT DO NOTHING`;
      for (const resource of keys)
        await tx.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,next_run_at) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${scope.connectionId}::uuid,${resource},date_trunc('minute',now())) ON CONFLICT(tenant_id,property_id,connection_id,resource) DO NOTHING`;
    });
  }
  async status(tenantId: string, propertyId: string) {
    const scope = await this.scope(tenantId, propertyId);
    if (!scope) return { source: 'LOCAL', enabled: false, jobs: [] };
    await this.ensure(scope);
    const jobs = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          SyncJobRow[]
        >`SELECT resource,status,processed,last_success_at AS "lastSyncedAt",last_error AS "lastError",updated_at AS "updatedAt",created_at AS "createdAt",
          CASE WHEN progress->'ids' IS NOT NULL THEN jsonb_array_length(progress->'ids') ELSE NULL END AS total,
          progress->>'startedAt' AS "startedAt",
          (progress->>'total')::int AS "progressTotal",
          COALESCE((snapshot->>'initialComplete')::boolean,false) AS "initialComplete",
          (snapshot->>'schemaVersion')::int AS "importVersion",
          COALESCE((snapshot->>'initialTotal')::int,(snapshot->>'total')::int) AS "snapshotTotal",
          COALESCE((progress->>'skipped')::int,(snapshot->>'skipped')::int,0) AS skipped
          FROM clock_sync_jobs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${scope.connectionId}::uuid ORDER BY resource`,
    );
    // What is really held, so each figure survives the small catch-up passes and says what it counts.
    const held = await this.db.withTenantTransaction(scope, async (tx) => {
      const profiles = await tx.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM clock_guest_profiles WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${scope.connectionId}::uuid`;
      const mappings = await tx.$queryRaw<
        Array<{ type: string; count: number }>
      >`SELECT entity_type::text AS type, count(*)::int AS count FROM clock_catalog_mappings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND sync_status='CONFIRMED' GROUP BY entity_type`;
      const rates = await tx.$queryRaw<
        Array<{ count: number }>
      >`SELECT COALESCE(sum(jsonb_array_length(e.value)),0)::int AS count FROM clock_sync_jobs j, jsonb_each(COALESCE(j.snapshot->'roomTypes','{}'::jsonb)) e WHERE j.tenant_id=${tenantId}::uuid AND j.property_id=${propertyId}::uuid AND j.connection_id=${scope.connectionId}::uuid AND j.resource='rates' AND jsonb_typeof(e.value)='array'`;
      const bookings = await tx.$queryRaw<
        Array<{ status: string; count: number; first: string | null }>
      >`SELECT status::text AS status, count(*)::int AS count, min(starts_on)::text AS first FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND external_booking_id IS NOT NULL GROUP BY status`;
      return { profiles, mappings, rates, bookings };
    });
    const mapped = (type: string) => held.mappings.find((m) => m.type === type)?.count ?? 0;
    const counts: SyncCounts = {
      guestProfiles: held.profiles[0]?.count ?? 0,
      roomTypes: mapped('ROOM_TYPE'),
      rooms: mapped('ROOM'),
      rates: held.rates[0]?.count ?? 0,
      bookingsByStatus: Object.fromEntries(held.bookings.map((b) => [b.status, b.count])),
      earliestStay:
        held.bookings
          .map((b) => b.first)
          .filter(Boolean)
          .sort()[0] ?? null,
    };
    return {
      source: 'CLOCK_PMS',
      enabled: enabled() && this.allowed(propertyId),
      jobs,
      ...buildSyncSummary(jobs, new Date(), counts),
    };
  }
  async read(tenantId: string, propertyId: string, resource: string) {
    const scope = await this.scope(tenantId, propertyId);
    if (!scope) return { data: null, status: 'NOT_CONNECTED', lastSyncedAt: null };
    if (!['rooms', 'rates'].includes(resource) && !/^availability:\d{4}-\d{2}$/.test(resource))
      throw new BadRequestException('Invalid Clock snapshot.');
    if (resource.startsWith('availability:')) {
      const date = new Date(resource.slice(13) + '-01T00:00:00Z');
      if (
        !Number.isFinite(date.getTime()) ||
        Math.abs(date.getTime() - Date.now()) > 10 * 366 * 86400000
      )
        throw new BadRequestException('Choose an availability month within ten years.');
    }
    await this.ensure(scope, [resource]);
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{
            data: {
              roomTypes?: Record<string, Array<{ externalRateId: string; [key: string]: unknown }>>;
              [key: string]: unknown;
            } | null;
            status: string;
            lastSyncedAt: Date | null;
            lastError: string | null;
          }>
        >`SELECT snapshot AS data,status,last_success_at AS "lastSyncedAt",last_error AS "lastError" FROM clock_sync_jobs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${scope.connectionId}::uuid AND resource=${resource}`,
    );
    const result = rows[0] ?? { data: null, status: 'READY', lastSyncedAt: null, lastError: null };
    return result;
  }
  async requestRefresh(tenantId: string, propertyId: string) {
    const scope = await this.scope(tenantId, propertyId);
    if (!scope) throw new BadRequestException('Clock is not connected.');
    await this.ensure(scope);
    await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$executeRaw`UPDATE clock_sync_jobs SET requested_at=now(),next_run_at=now(),status=CASE WHEN lease_until>now() THEN status ELSE 'READY' END,last_error=NULL WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${scope.connectionId}::uuid`,
    );
    return { queued: true };
  }
  async tick() {
    if (this.busy || !enabled()) return;
    this.busy = true;
    try {
      const properties = await this.db.$queryRaw<
        Scope[]
      >`SELECT * FROM clock_sync_properties(1000)`;
      for (const scope of properties) {
        if (!this.allowed(scope.propertyId)) continue;
        await this.ensure(scope);
        // Two lanes: the import and refresh of lists, and the bills. Bills used to be served first
        // and, being many and always due, starved the reservation import.
        await Promise.all(
          (['lists', 'bills'] as const).map(async (lane) => {
            const job = await this.claim(scope, lane);
            if (!job) return;
            try {
              await withClockBackgroundWork(() => this.run(scope, job));
            } catch (error) {
              const retry =
                error instanceof ClockFinancialCurrencyError
                  ? true
                  : error instanceof ClockBookingReadError
                    ? error.classified.retryable
                    : error instanceof Error &&
                      /Clock read did not finish|Clock did not finish reading this guest batch|Booking changed during the financial check|Clock bills changed during the financial check/.test(
                        error.message,
                      );
              const category =
                error instanceof ClockBookingReadError
                  ? error.classified.category
                  : 'configuration';
              this.logger.warn(
                `Clock sync job ${job.resource} failed (${category}, ${retry ? 'will retry' : 'stopped'}): ${errorText(error)}`,
              );
              await this.db.withTenantTransaction(
                scope,
                (tx) =>
                  tx.$executeRaw`UPDATE clock_sync_jobs SET status=${retry ? 'RETRY' : 'FAILED'},last_error=${error instanceof ClockFinancialCurrencyError ? error.message : retry ? 'Clock is temporarily unavailable. Synchronization will retry automatically.' : 'Synchronization needs connection or room-mapping review (' + category + ').'},next_run_at=now()+interval '1 minute',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${job.id}::uuid AND lease_token=${job.leaseToken}::uuid`,
              );
            }
          }),
        );
      }
    } catch {
      this.logger.warn(
        'Clock background scheduling failed; it will retry. Inspect database connectivity.',
      );
    } finally {
      this.busy = false;
    }
  }
  private async claim(scope: Scope, lane: 'lists' | 'bills'): Promise<Job | null> {
    const token = randomUUID();
    const bills = lane === 'bills';
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<
        Job[]
      >`UPDATE clock_sync_jobs j SET status='RUNNING',requested_at=NULL,lease_token=${token}::uuid,lease_until=now()+interval '5 minutes',updated_at=now() WHERE j.id=(SELECT id FROM clock_sync_jobs WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND connection_id=${scope.connectionId}::uuid AND (status<>'FAILED' OR updated_at<now()-interval '30 minutes') AND (resource LIKE 'financial:%')=${bills} AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY (requested_at IS NOT NULL) DESC,requested_at NULLS LAST,next_run_at,CASE resource WHEN 'catalog' THEN 0 WHEN 'rooms' THEN 1 WHEN 'rates' THEN 2 ELSE 3 END,id FOR UPDATE SKIP LOCKED LIMIT 1) AND j.tenant_id=${scope.tenantId}::uuid AND j.property_id=${scope.propertyId}::uuid RETURNING j.id,j.resource,j.progress,j.snapshot,j.processed,j.lease_token AS "leaseToken"`;
      return rows[0] ?? null;
    });
  }
  /**
   * How long to leave a reservation's bill alone. Bills of guests arriving or staying are checked often;
   * far-off and finished stays rarely, so a large hotel does not spend Clock's request allowance on them.
   */
  /** Clock has no room-type capacity, so the shown "up to N guests" follows what its website rates allow. */
  private async refreshDisplayedOccupancy(
    scope: Scope,
    ratesByRoomType: Map<string, Parameters<typeof occupancyFromRates>[0]>,
  ): Promise<void> {
    const derived = [...ratesByRoomType]
      .map(([id, rates]) => ({ id, occupancy: occupancyFromRates(rates) }))
      .filter((item): item is { id: string; occupancy: number } => item.occupancy !== null);
    if (!derived.length) return;
    await this.db.withTenantTransaction(scope, async (tx) => {
      for (const item of derived)
        await tx.$executeRaw`UPDATE room_types SET max_occupancy=${item.occupancy}, updated_at=now()
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
            AND id=${item.id}::uuid AND max_occupancy<>${item.occupancy}`;
    });
  }

  private async billDelay(scope: Scope, bookingId: string): Promise<number> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{ startsIn: number; endedAgo: number }>
        >`SELECT (starts_on - current_date)::int AS "startsIn", (current_date - ends_on)::int AS "endedAgo" FROM bookings WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${bookingId}::uuid`,
    );
    const row = rows[0];
    if (!row) return 43200;
    if (row.endedAgo > 1) return 86400;
    if (row.startsIn <= 1) return 600;
    if (row.startsIn <= 30) return 7200;
    return 43200;
  }
  private async save(
    scope: Scope,
    job: Job,
    progress: Record<string, unknown>,
    complete: boolean,
    snapshot?: unknown,
    processed = job.processed,
    delay = complete ? 900 : 1,
  ) {
    await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$executeRaw`UPDATE clock_sync_jobs SET progress=${JSON.stringify(progress)}::jsonb,snapshot=COALESCE(${snapshot === undefined ? null : JSON.stringify(snapshot)}::jsonb,snapshot),processed=${processed},status=${complete ? 'SYNCED' : 'READY'},last_success_at=CASE WHEN ${complete} THEN now() ELSE last_success_at END,next_run_at=CASE WHEN ${complete} AND requested_at IS NOT NULL THEN now() ELSE now()+make_interval(secs=>${delay}) END,requested_at=CASE WHEN ${complete} THEN NULL ELSE requested_at END,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${job.id}::uuid AND lease_token=${job.leaseToken}::uuid`,
    );
  }
  private async run(scope: Scope, job: Job) {
    const connection = await this.connections.activePmsConnectionCredentials(
      scope.tenantId,
      scope.propertyId,
    );
    if (connection?.provider !== 'CLOCK_PMS' || connection.connectionId !== scope.connectionId)
      throw new BadRequestException('Clock connection changed.');
    const credentials = parseClockCredentials(connection.credentials);
    if (!credentials.ok) throw new BadRequestException('Clock credentials need review.');
    if (job.resource.startsWith('financial:')) {
      const bookingId = job.resource.slice(10);
      await this.financial.refresh(scope, bookingId);
      await this.save(scope, job, {}, true, undefined, 1, await this.billDelay(scope, bookingId));
      return;
    }
    if (job.resource === 'catalog') {
      await this.catalog.sync(scope.tenantId, scope.propertyId, null);
      const result = await this.catalog.confirmAll(scope.tenantId, scope.propertyId, null);
      if (result.skipped.length) throw new BadRequestException('Clock room mappings need review.');
      await this.save(scope, job, {}, true, { confirmed: result.confirmed });
      return;
    }
    if (job.resource === 'rooms') {
      await this.save(
        scope,
        job,
        {},
        true,
        await this.catalog.roomCounts(scope.tenantId, scope.propertyId, true),
      );
      return;
    }
    if (job.resource === 'rates') {
      const result = await this.availability.ratesForAllRoomTypesDetailed(
        scope.tenantId,
        scope.propertyId,
      );
      if (!result.ok)
        throw new ClockBookingReadError({
          ...result.error,
          category: result.error.retryable ? 'provider_unavailable' : 'configuration',
        });
      await this.refreshDisplayedOccupancy(scope, result.value);
      await this.save(scope, job, {}, true, { roomTypes: Object.fromEntries(result.value) });
      return;
    }
    if (job.resource.startsWith('availability:')) {
      const types = await this.db.withTenantTransaction(
        scope,
        (tx) =>
          tx.$queryRaw<
            Array<{ id: string; name: string }>
          >`SELECT t.id,t.name FROM room_types t JOIN clock_catalog_mappings m ON m.tenant_id=t.tenant_id AND m.property_id=t.property_id AND m.local_entity_id=t.id WHERE t.tenant_id=${scope.tenantId}::uuid AND t.property_id=${scope.propertyId}::uuid AND m.connection_id=${scope.connectionId}::uuid AND m.entity_type='ROOM_TYPE' AND m.sync_status='CONFIRMED' ORDER BY t.id`,
      );
      if (!types.length) throw new BadRequestException('Clock room mappings need review.');
      const index = Number(job.progress.index ?? 0),
        type = types[index];
      const collected = Array.isArray(job.progress.roomTypes) ? job.progress.roomTypes : [];
      if (type) {
        const result = await this.availability.getAvailabilityCalendar(
          scope.tenantId,
          scope.propertyId,
          { roomTypeId: type.id, month: job.resource.slice(13), fresh: true },
        );
        if (!result.ok)
          throw new ClockBookingReadError({
            ...result.error,
            category: result.error.retryable ? 'provider_unavailable' : 'configuration',
          });
        collected.push({ ...type, days: result.value });
      }
      const complete = index + 1 >= types.length;
      await this.save(
        scope,
        job,
        complete ? {} : { index: index + 1, roomTypes: collected },
        complete,
        complete ? { roomTypes: collected, occupancy: { adults: 1, children: 0 } } : undefined,
        collected.length,
        // A month finished: look again in half an hour. Clock asks for no more than one read of
        // availability every 15 minutes; the rest of the allowance goes to the import.
        complete ? 1800 : 1,
      );
      return;
    }
    if (job.resource === 'guests') {
      const progress = Object.keys(job.progress).length
        ? job.progress
        : {
            updatedFrom: job.snapshot?.highWater
              ? new Date(Date.parse(job.snapshot.highWater) - 86400000).toISOString().slice(0, 10)
              : '1970-01-01',
            updatedUntil: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            cursor: '0',
            startedAt: new Date().toISOString(),
          };
      const result = await this.guests.batch({ ...scope, userId: null }, progress);
      const count = Object.keys(job.progress).length
        ? job.processed + result.processed
        : result.processed;
      await this.save(
        scope,
        job,
        result.completed ? {} : { ...progress, cursor: result.cursor, total: result.total },
        result.completed,
        result.completed
          ? { highWater: progress.updatedUntil, total: result.total, initialComplete: true }
          : undefined,
        count,
        result.completed ? 180 : 1,
      );
      return;
    }
    if (job.resource === 'bookings') {
      const until =
        typeof job.progress.until === 'string' ? job.progress.until : new Date().toISOString();
      const startedAt =
        typeof job.progress.startedAt === 'string'
          ? job.progress.startedAt
          : new Date().toISOString();
      const ids = Array.isArray(job.progress.ids)
        ? job.progress.ids
        : await this.reader.updatedBookingIds(
            credentials.value,
            job.snapshot?.schemaVersion === BOOKINGS_IMPORT_VERSION && job.snapshot?.highWater
              ? new Date(Date.parse(job.snapshot.highWater) - 60000).toISOString()
              : '1970-01-01T00:00:00.000Z',
            until,
          );
      let index = Number(job.progress.index ?? 0);
      let skipped = Number(job.progress.skipped ?? 0);
      const skippedIds = Array.isArray(job.progress.skippedIds) ? [...job.progress.skippedIds] : [];
      // Twenty reservations per step, four at a time. Clock's request allowance is the real limit (the rate
      // limiter queues the calls), so this keeps the allowance busy instead of waiting on one call at a time.
      const end = Math.min(index + 20, ids.length);
      const batch = ids.slice(index, end).map(String);
      for (let from = 0; from < batch.length; from += 4) {
        const results = await Promise.all(
          batch.slice(from, from + 4).map((id) =>
            this.hydration
              .hydrateBooking(scope.tenantId, scope.propertyId, scope.connectionId, id, undefined, {
                notify: false,
              })
              .catch((error: unknown) => {
                // A reservation the database refuses by rule (for example a credit-style entry with a
                // negative total) is listed and skipped. Anything else still stops the step and retries it.
                if (isUnsavableBooking(error)) {
                  this.logger.warn(`Clock reservation ${id} was skipped: ${errorText(error)}`);
                  return { outcome: 'unknown_status' as const };
                }
                throw error;
              }),
          ),
        );
        results.forEach((result, offset) => {
          if (
            result.outcome === 'missing_room_type_mapping' ||
            result.outcome === 'unknown_status'
          ) {
            // Old reservations can belong to room types or statuses MUST has no mapping for. They are counted
            // and listed instead of stopping the import of the other thousands.
            skipped += 1;
            if (skippedIds.length < 20) skippedIds.push(batch[from + offset]!);
          } else if (!['created', 'updated'].includes(result.outcome))
            throw new BadRequestException('Clock booking mapping or status needs review.');
        });
      }
      index = end;
      const complete = index >= ids.length;
      await this.save(
        scope,
        job,
        complete ? {} : { until, ids, index, startedAt, skipped, skippedIds },
        complete,
        complete
          ? {
              highWater: until,
              total: ids.length,
              initialComplete: true,
              schemaVersion: BOOKINGS_IMPORT_VERSION,
              initialTotal: job.snapshot?.initialTotal ?? ids.length,
              skipped: Number(job.snapshot?.skipped ?? 0) + skipped,
            }
          : undefined,
        index,
        complete ? 120 : 1,
      );
      return;
    }
    throw new BadRequestException('Unsupported synchronization resource.');
  }
}

type Request = { tenantContext: { tenantId: string; propertyId: string; userId: string } };
@Controller('tenants/:tenantId/properties/:propertyId/clock-sync')
@Roles(Role.TenantOwner, Role.TenantAdmin, Role.PropertyStaff)
export class ClockBackgroundSyncController {
  constructor(
    @Inject(ClockBackgroundSyncService) private readonly sync: ClockBackgroundSyncService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
  ) {}
  private async allow(req: Request, keys: string[]) {
    const caps = await this.capabilities.effective(req.tenantContext);
    if (!keys.some((k) => caps.includes(k)))
      throw new ForbiddenException('You do not have access to this Clock information.');
  }
  @Get('financial/:bookingId')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('payments.view')
  financialSnapshot(@Req() req: Request, @Param('bookingId') bookingId: string) {
    return this.financial.read(req.tenantContext, bookingId);
  }
  @Get('status')
  @TenantScoped({ propertyParam: 'propertyId' })
  async status(@Req() req: Request) {
    await this.allow(req, [
      'calendar.view',
      'guests.view',
      'rates.manage',
      'settings.manage',
      'bookings.view',
    ]);
    return this.sync.status(req.tenantContext.tenantId, req.tenantContext.propertyId);
  }
  @Get('availability')
  @TenantScoped({ propertyParam: 'propertyId' })
  async availability(@Req() req: Request, @Query('month') month: string) {
    await this.allow(req, ['calendar.view', 'rates.manage']);
    return this.sync.read(
      req.tenantContext.tenantId,
      req.tenantContext.propertyId,
      'availability:' + month,
    );
  }
  @Get('rooms')
  @TenantScoped({ propertyParam: 'propertyId' })
  async rooms(@Req() req: Request) {
    await this.allow(req, ['calendar.view', 'rooms.manage', 'bookings.view', 'settings.manage']);
    return this.sync.read(req.tenantContext.tenantId, req.tenantContext.propertyId, 'rooms');
  }
  @Get('rates')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('rates.manage')
  rates(@Req() req: Request) {
    return this.sync.read(req.tenantContext.tenantId, req.tenantContext.propertyId, 'rates');
  }
  @Post('refresh')
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('settings.manage')
  @RequiresVerifiedEmail()
  refresh(@Req() req: Request) {
    return this.sync.requestRefresh(req.tenantContext.tenantId, req.tenantContext.propertyId);
  }
}
