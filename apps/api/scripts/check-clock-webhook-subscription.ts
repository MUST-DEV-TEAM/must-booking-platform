import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { parseClockCredentials } from '../src/integrations/clock/clock-credentials';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';

/**
 * Read-only probe: GETs Clock's Base API /webhook_subscription for one
 * property's Clock connection, to see whether a subscription already exists
 * and what shape Clock actually returns — the runbook documents this
 * endpoint's existence but not its request/response contract, and nothing
 * in this codebase has called it before. Never writes anything.
 */
async function main() {
  const tenantId = process.env.CLOCK_WEBHOOK_TENANT_ID;
  const propertyId = process.env.CLOCK_WEBHOOK_PROPERTY_ID;
  if (!tenantId || !propertyId)
    throw new Error('CLOCK_WEBHOOK_TENANT_ID and CLOCK_WEBHOOK_PROPERTY_ID are required.');

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
      api: 'base_api',
      method: 'GET',
      path: '/webhook_subscription',
      timeoutMs: 15_000,
    });
    console.log('status:', response.status);
    console.log('body:', JSON.stringify(response.body, null, 2));
  } finally {
    await app.close();
  }
}

void main();
