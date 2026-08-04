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
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockConnectionPingService) private readonly ping: ClockConnectionPingService,
    @Inject(ClockCatalogSyncService) private readonly catalogSync: ClockCatalogSyncService,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
    @Inject(ClockBookingService) private readonly booking: ClockBookingService,
  ) {}

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

  getAvailability(
    context: PmsProviderContext,
    query: AvailabilityQuery,
  ): Promise<Result<AvailabilityResult>> {
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
