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
import { ClockConnectionPingService } from './clock-connection-ping';

export const CLOCK_PMS_PROVIDER = Symbol('CLOCK_PMS_PROVIDER');

/**
 * Real ClockPmsProvider. Only testConnection is implemented so far
 * (Milestone 11 Task 6) — catalog sync (Task 7), availability (Task 8), and
 * booking CRUD (Task 10) land as their own dedicated, individually-verified
 * tasks rather than being stubbed out speculatively here. This is not the
 * DI-bound PMS_PROVIDER yet (LocalPmsProvider still is) — swapping which
 * provider a property actually uses is a later task's job, not this one's.
 */
@Injectable()
export class ClockPmsProvider implements PmsProvider {
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockConnectionPingService) private readonly ping: ClockConnectionPingService,
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

  syncCatalog(context: PmsProviderContext, cursor?: string): Promise<Page<CatalogItem>> {
    void context;
    void cursor;
    throw notImplemented('syncCatalog', 7);
  }

  getAvailability(
    context: PmsProviderContext,
    query: AvailabilityQuery,
  ): Promise<Result<AvailabilityResult>> {
    void context;
    void query;
    throw notImplemented('getAvailability', 8);
  }

  getBooking(context: PmsProviderContext, externalBookingId: string): Promise<Booking | null> {
    void context;
    void externalBookingId;
    throw notImplemented('getBooking', 10);
  }

  findBookingByExternalReference(
    context: PmsProviderContext,
    reference: string,
  ): Promise<Booking | null> {
    void context;
    void reference;
    throw notImplemented('findBookingByExternalReference', 10);
  }

  createBooking(
    context: PmsProviderContext,
    command: CreateBookingCommand,
  ): Promise<Result<Booking>> {
    void context;
    void command;
    throw notImplemented('createBooking', 10);
  }

  updateBooking(
    context: PmsProviderContext,
    command: UpdateBookingCommand,
  ): Promise<Result<Booking>> {
    void context;
    void command;
    throw notImplemented('updateBooking', 10);
  }

  cancelBooking(
    context: PmsProviderContext,
    command: CancelBookingCommand,
  ): Promise<Result<Booking>> {
    void context;
    void command;
    throw notImplemented('cancelBooking', 10);
  }
}

function notImplemented(method: string, task: number): Error {
  return new Error(
    `ClockPmsProvider.${method} is not implemented yet — lands in Milestone 11 Task ${task}.`,
  );
}
