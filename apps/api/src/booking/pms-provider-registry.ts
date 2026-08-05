import { Inject, Injectable } from '@nestjs/common';
import type { PmsProvider } from '@must/domain-contracts';

import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { ClockPmsProvider } from '../integrations/clock/clock-pms.provider';
import { LocalPmsProvider } from './local-pms.provider';

/**
 * Resolves which PmsProvider a property actually uses — ClockPmsProvider if
 * it has an active, enabled Clock connection, LocalPmsProvider otherwise.
 * Milestone 11.5 Task 2.
 *
 * Deliberately not wired into booking *creation* yet: LocalPmsProvider's
 * createBooking does essential local-domain orchestration (quote validation,
 * MIXED-mode same-price auto room assignment, Stripe/PokPay checkout session
 * creation) that ClockBookingService's narrower create doesn't replicate —
 * dispatching creation through this registry today would either lose that
 * orchestration or, for online-payment bookings, create a real Clock
 * reservation before payment is confirmed (exactly what ADR-0001's
 * "payment-first" pattern rules out). That's Task 4's job: local
 * orchestration succeeds first, then this registry decides whether the
 * already-locally-valid booking also needs a real Clock reservation.
 *
 * Safe today: updateBooking/cancelBooking, which act on a booking that
 * already exists locally (and may or may not have a real Clock reservation
 * yet) — ClockBookingService already handles the "no externalBookingId"
 * case gracefully by skipping the pointless Clock call.
 */
@Injectable()
export class PmsProviderRegistry {
  constructor(
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(LocalPmsProvider) private readonly local: LocalPmsProvider,
    @Inject(ClockPmsProvider) private readonly clock: ClockPmsProvider,
  ) {}

  async forProperty(tenantId: string, propertyId: string): Promise<PmsProvider> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    return connection?.provider === 'CLOCK_PMS' ? this.clock : this.local;
  }
}
