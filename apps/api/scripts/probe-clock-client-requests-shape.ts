import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';
import { parseClockCredentials } from '../src/integrations/clock/clock-credentials';

const TENANT_ID = 'fdb9f701-510e-4deb-857b-08a87fcdfbcc';
const PROPERTY_ID = '9231b946-f244-4a84-af54-0774710f3464';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const connections = app.get(IntegrationConnectionsService);
    const httpClient = app.get(ClockHttpClient);

    const connection = await connections.activePmsConnectionCredentials(TENANT_ID, PROPERTY_ID);
    if (!connection || connection.provider !== 'CLOCK_PMS') throw new Error('No Clock connection');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new Error(parsed.message);
    const credentials = parsed.value;

    // Pull the real, already-confirmed booking 38363610 to reuse its exact
    // room_type_id/room_id/rate_id — avoids guessing a valid rate.
    const existing = await httpClient.request<{
      arrival_room_type_id: number;
      arrival_room_id: number | null;
      rate_id: number;
    }>(credentials, { method: 'GET', path: '/bookings/38363610', api: 'pms_api' });
    if (existing.status < 200 || existing.status >= 300) {
      console.log('Reference booking lookup failed:', JSON.stringify(existing, null, 2));
      throw new Error('Could not load reference booking');
    }
    console.log('Reference booking fields:', existing.body);

    const shapes: Array<{ label: string; field: string; value: unknown }> = [
      { label: 'singular client_request string', field: 'client_request', value: 'probe test note' },
    ];

    for (const shape of shapes) {
      const reference = `MHB-PROBE-${Date.now()}`;
      const body = {
        booking: {
          arrival: '2027-01-10',
          departure: '2027-01-11',
          status: 'expected',
          arrival_room_type_id: existing.body.arrival_room_type_id,
          arrival_room_id: existing.body.arrival_room_id,
          rate_id: existing.body.rate_id,
          reference_number: reference,
          adults: 1,
          children: 0,
          guest_e_mail: 'probe@must.al',
          guest_first_name: 'Probe',
          guest_last_name: 'Test',
          [shape.field]: shape.value,
        },
      };
      const result = await httpClient.request<{ id: number }>(credentials, {
        method: 'POST',
        path: '/bookings/',
        api: 'pms_api',
        body,
      });
      if (result.status >= 200 && result.status < 300) {
        console.log(`SUCCESS with shape "${shape.label}":`, result.body);
        const created = result.body as { id: number };
        const verify = await httpClient.request<{ active_client_requests: unknown }>(credentials, {
          method: 'GET',
          path: `/bookings/${created.id}`,
          api: 'pms_api',
        });
        console.log('Verify active_client_requests on created booking:', verify.body);
        // Cancel the probe booking immediately so it doesn't clutter real inventory.
        const cancel = await httpClient.request(credentials, {
          method: 'PUT',
          path: `/bookings/${created.id}`,
          api: 'pms_api',
          body: { booking: { status: 'canceled', lock_version: 0 } },
        });
        console.log('Cancel attempt status:', cancel.status);
        return;
      }
      console.log(`FAILED with shape "${shape.label}" (status ${result.status}):`, result.body);
    }
    console.log('No shape succeeded.');
  } finally {
    await app.close();
  }
}

void main();
