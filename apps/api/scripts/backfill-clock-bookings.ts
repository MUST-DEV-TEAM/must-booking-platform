import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { ClockBookingConsistencyService } from '../src/integrations/clock/clock-booking-consistency.service';
import { ClockBookingHydrationService } from '../src/integrations/clock/clock-booking-hydration.service';
import { parseClockCredentials } from '../src/integrations/clock/clock-credentials';

/**
 * One-time backfill for a property whose Clock webhook was never registered:
 * mirrors every Clock booking in a date range into the local `bookings`
 * table via the same hydrateBooking path the webhook pipeline uses, so the
 * calendar reflects reality immediately instead of waiting on webhooks that
 * were never wired up on Clock's side.
 */
async function main() {
  const tenantId = process.env.CLOCK_BACKFILL_TENANT_ID;
  const propertyId = process.env.CLOCK_BACKFILL_PROPERTY_ID;
  const startsOn = process.env.CLOCK_BACKFILL_STARTS_ON;
  const endsOn = process.env.CLOCK_BACKFILL_ENDS_ON;
  if (!tenantId || !propertyId || !startsOn || !endsOn)
    throw new Error(
      'CLOCK_BACKFILL_TENANT_ID, CLOCK_BACKFILL_PROPERTY_ID, CLOCK_BACKFILL_STARTS_ON, and CLOCK_BACKFILL_ENDS_ON are required.',
    );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const connections = app.get(IntegrationConnectionsService);
    const consistency = app.get(ClockBookingConsistencyService);
    const hydration = app.get(ClockBookingHydrationService);

    const connection = await connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new Error('This property has no active Clock PMS connection.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new Error(parsed.message);

    const bookingIds = await consistency.listBookingIds(parsed.value, { startsOn, endsOn });
    console.log(`Found ${bookingIds.length} Clock booking(s) between ${startsOn} and ${endsOn}.`);

    const outcomes: Record<string, number> = {};
    for (const clockBookingId of bookingIds) {
      const result = await hydration.hydrateBooking(
        tenantId,
        propertyId,
        connection.connectionId,
        clockBookingId,
      );
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      console.log(`  ${clockBookingId}: ${result.outcome}`);
    }
    console.log('Summary:', outcomes);
  } finally {
    await app.close();
  }
}

void main();
