import type {
  RoomMoveAvailabilityQuery,
  RoomMoveAvailabilitySnapshot,
} from '@must/domain-contracts';
import { ClockStayAmendmentService } from './clock-stay-amendment.service';
import type { StayAmendmentQuery, StayAmendmentCommand } from '@must/domain-contracts';
import type { MoveBookingRoomCommand } from '@must/domain-contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AvailabilityQuery,
  type AvailabilityResult,
  type Booking,
  type CancelBookingCommand,
  type CatalogItem,
  type CreateBookingCommand,
  type Page,
  type PmsProvider,
  type PmsProviderContext,
  type Result,
  type UpdateBookingCommand,
} from '@must/domain-contracts';

import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockAvailabilityService } from './clock-availability.service';
import { ClockBookingService } from './clock-booking.service';
import { ClockCatalogSyncService } from './clock-catalog-sync.service';
import { ClockConnectionPingService } from './clock-connection-ping';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';

export const CLOCK_PMS_PROVIDER = Symbol('CLOCK_PMS_PROVIDER');

/**
 * Real ClockPmsProvider. testConnection (Task 6), syncCatalog (Task 7),
 * getAvailability (Task 8), and booking CRUD (Task 10) are implemented. This
 * is not the DI-bound PMS_PROVIDER yet (LocalPmsProvider still is) —
 * swapping which provider a property actually uses is a later task's job,
 * not this one's.
 */
@Injectable()
export class ClockPmsProvider implements PmsProvider {
  previewStayAmendment(context: PmsProviderContext, query: StayAmendmentQuery) {
    return this.stayAmendments.preview(context, query);
  }
  amendBookingStay(context: PmsProviderContext, command: StayAmendmentCommand) {
    return this.stayAmendments.amend(context, command);
  }
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockConnectionPingService) private readonly ping: ClockConnectionPingService,
    @Inject(ClockCatalogSyncService) private readonly catalogSync: ClockCatalogSyncService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockBookingService) private readonly booking: ClockBookingService,
    @Inject(ClockStayAmendmentService) private readonly stayAmendments: ClockStayAmendmentService,
  ) {}

  async unavailableRoomsForMove(
    context: PmsProviderContext,
    query: RoomMoveAvailabilityQuery,
  ): Promise<Result<RoomMoveAvailabilitySnapshot>> {
    // Browsing uses durable projections only. Clock's uncached guard is still
    // required inside moveBookingRoom immediately before an external assignment.
    return this.database.withTenantTransaction(context, async (tx) => {
      const bindings = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT pc.connection_id AS id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${context.tenantId}::uuid AND pc.property_id=${context.propertyId}::uuid AND pc.kind='PMS' AND pc.enabled AND c.provider='CLOCK_PMS' AND c.status='CONNECTED' FOR SHARE OF pc,c`;
      if (!bindings[0])
        return {
          ok: false as const,
          error: {
            code: 'CLOCK_CONNECTION_UNAVAILABLE',
            message: 'The saved Clock connection is unavailable.',
            retryable: true,
          },
        };
      const connectionId = bindings[0].id;
      await tx.$executeRaw`INSERT INTO clock_sync_jobs(tenant_id,property_id,connection_id,resource,next_run_at) VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${connectionId}::uuid,'bookings',now()) ON CONFLICT DO NOTHING`;
      const jobs = await tx.$queryRaw<
        Array<{ at: Date | null; complete: boolean; status: string }>
      >`SELECT last_success_at AS at,(snapshot->>'initialComplete'='true' AND snapshot->>'schemaVersion'='2') IS TRUE AS complete,status FROM clock_sync_jobs WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND connection_id=${connectionId}::uuid AND resource='bookings'`;
      const taken = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT DISTINCT b.room_id AS id FROM bookings b JOIN clock_catalog_mappings m ON m.tenant_id=b.tenant_id AND m.property_id=b.property_id AND m.local_entity_id=b.room_id AND m.connection_id=${connectionId}::uuid AND m.entity_type='ROOM' AND m.sync_status='CONFIRMED' WHERE b.tenant_id=${context.tenantId}::uuid AND b.property_id=${context.propertyId}::uuid AND b.id<>${query.excludeBookingId}::uuid AND b.room_id=ANY(${query.roomIds}::uuid[]) AND b.starts_on<${query.endsOn}::date AND b.ends_on>${query.startsOn}::date AND b.status NOT IN ('CANCELLED','EXPIRED','AVAILABILITY_FAILED')`;
      const job = jobs[0],
        at = job?.at ? new Date(job.at) : null;
      return {
        ok: true as const,
        value: {
          unavailableRoomIds: taken.map((row) => row.id),
          source: 'CLOCK_SNAPSHOT' as const,
          lastSyncedAt: at?.toISOString() ?? null,
          complete: !!job?.complete,
          stale:
            !at ||
            Date.now() - at.getTime() > 5 * 60_000 ||
            job?.status === 'FAILED' ||
            job?.status === 'RETRY',
        },
      };
    });
  }
  moveBookingRoom(context: PmsProviderContext, command: MoveBookingRoomCommand) {
    return this.booking.moveBookingRoom(context, command);
  }

  async testConnection(context: PmsProviderContext): Promise<Result<void>> {
    const connection = await this.connections.activePmsConnectionCredentials(
      context.tenantId,
      context.propertyId,
    );
    if (!connection || connection.provider !== 'CLOCK_PMS') {
      return {
        ok: false,
        error: {
          code: 'clock_configuration',
          message: 'This property has no active Clock PMS connection.',
          retryable: false,
        },
      };
    }

    const result = await this.ping.ping(connection.credentials);
    if (result.ok) return { ok: true, value: undefined };
    return {
      ok: false,
      error: { code: 'clock_connection_failed', message: result.message, retryable: false },
    };
  }

  async syncCatalog(context: PmsProviderContext, cursor?: string): Promise<Page<CatalogItem>> {
    void cursor; // Clock's full room-type/room list is small enough per property to not need pagination yet.
    await this.catalogSync.sync(context.tenantId, context.propertyId, null);
    // syncCatalog stages proposals (Task 7) and never auto-applies them — the
    // domain contract's returned items are the CONFIRMED local catalog, same
    // as LocalPmsProvider returns its own local room types.
    const roomTypes = await this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<Array<{ id: string; name: string; maxOccupancy: number }>>`
        SELECT id, name, max_occupancy AS "maxOccupancy" FROM room_types
      `,
    );
    return {
      items: roomTypes.map((roomType) => ({
        kind: 'room_type' as const,
        id: roomType.id,
        name: roomType.name,
        maxOccupancy: roomType.maxOccupancy,
      })),
      nextCursor: null,
    };
  }

  async getAvailability(
    context: PmsProviderContext,
    query: AvailabilityQuery,
  ): Promise<Result<AvailabilityResult>> {
    const roomTypes = await this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM room_types
          WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
            AND id = ${query.roomTypeId}::uuid AND status = 'PUBLISHED'::"RoomTypeStatus"
        `,
    );
    if (!roomTypes[0])
      return {
        ok: false,
        error: {
          code: 'ROOM_TYPE_NOT_AVAILABLE',
          message: 'Room type is not published.',
          retryable: false,
        },
      };
    return this.availability.getAvailability(context.tenantId, context.propertyId, query);
  }

  getBooking(context: PmsProviderContext, externalBookingId: string): Promise<Booking | null> {
    return this.booking.getBooking(context, externalBookingId);
  }

  findBookingByExternalReference(
    context: PmsProviderContext,
    reference: string,
  ): Promise<Booking | null> {
    return this.booking.findBookingByExternalReference(context, reference);
  }

  createBooking(
    context: PmsProviderContext,
    command: CreateBookingCommand,
  ): Promise<Result<Booking>> {
    return this.booking.createBooking(context, command);
  }

  updateBooking(
    context: PmsProviderContext,
    command: UpdateBookingCommand,
  ): Promise<Result<Booking>> {
    return this.booking.updateBooking(context, command);
  }

  cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand,
  ): Promise<Result<Booking>> {
    return this.booking.cancelBooking(context, command);
  }
}
