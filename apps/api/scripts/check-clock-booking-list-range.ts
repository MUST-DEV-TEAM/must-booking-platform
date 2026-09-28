import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { parseClockCredentials } from '../src/integrations/clock/clock-credentials';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';

/**
 * Read-only: calls Clock's /bookings/ list endpoint directly for a date
 * range and prints the raw id count, to verify a prior backfill actually
 * saw every booking Clock has on file (rather than trusting the backfill's
 * own summary), including whether Clock's list is paginated.
 */
async function main() {
  const tenantId = process.env.CLOCK_CHECK_TENANT_ID;
  const propertyId = process.env.CLOCK_CHECK_PROPERTY_ID;
  const startsOn = process.env.CLOCK_CHECK_STARTS_ON;
  const endsOn = process.env.CLOCK_CHECK_ENDS_ON;
  if (!tenantId || !propertyId || !startsOn || !endsOn)
    throw new Error(
      'CLOCK_CHECK_TENANT_ID, CLOCK_CHECK_PROPERTY_ID, CLOCK_CHECK_STARTS_ON, and CLOCK_CHECK_ENDS_ON are required.',
    );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const connections = app.get(IntegrationConnectionsService);
    const client = app.get(ClockHttpClient);
    const connection = await connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new Error('This property has no active Clock PMS connection.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new Error(parsed.message);

    const response = await client.request(parsed.value, {
      api: 'pms_api',
      method: 'GET',
      path: '/bookings/',
      query: { 'arrival.lt': endsOn, 'departure.gt': startsOn },
      timeoutMs: 15_000,
    });
    console.log('status:', response.status);
    const body = response.body;
    console.log('isArray:', Array.isArray(body));
    console.log('count:', Array.isArray(body) ? body.length : 'n/a');
    console.log('raw (first 40):', JSON.stringify(Array.isArray(body) ? body.slice(0, 40) : body));
  } finally {
    await app.close();
  }
}

void main();
