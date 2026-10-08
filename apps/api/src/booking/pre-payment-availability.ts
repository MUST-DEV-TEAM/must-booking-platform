import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@must/domain-contracts';

import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { ClockPrePaymentAvailability } from '../integrations/clock/clock-pre-payment-availability';

export type PrePaymentStay = {
  startsOn: string;
  endsOn: string;
  rooms: Array<{ roomTypeId: string; roomId?: string; adults: number; children: number }>;
};

/**
 * A PMS adapter's live, uncached confirmation that every requested room is still free in
 * the PMS. Booking code runs it after the local holds and before opening online checkout,
 * because the PMS itself holds nothing while the guest pays. Failures use
 * `AVAILABILITY_FAILED`; `retryable` is true only when the PMS could not be reached.
 */
export interface PrePaymentAvailabilityCheck {
  confirmAvailable(
    context: { tenantId: string; propertyId: string },
    stay: PrePaymentStay,
  ): Promise<Result<void>>;
}

/**
 * Picks the pre-payment check for a property's PMS, like PmsProviderRegistry does for the
 * provider itself. A property without an external PMS has nothing to confirm: its local
 * inventory holds are the whole truth.
 */
@Injectable()
export class PrePaymentAvailabilityRegistry {
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockPrePaymentAvailability) private readonly clock: ClockPrePaymentAvailability,
  ) {}

  async forProperty(
    tenantId: string,
    propertyId: string,
  ): Promise<PrePaymentAvailabilityCheck | null> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    return connection?.provider === 'CLOCK_PMS' ? this.clock : null;
  }

  async confirmAvailable(
    context: { tenantId: string; propertyId: string },
    stay: PrePaymentStay,
  ): Promise<Result<void>> {
    const check = await this.forProperty(context.tenantId, context.propertyId);
    return check ? check.confirmAvailable(context, stay) : { ok: true, value: undefined };
  }
}
