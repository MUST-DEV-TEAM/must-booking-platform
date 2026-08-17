import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { ClockBookingConsistencyService } from '../src/integrations/clock/clock-booking-consistency.service';

async function main() {
  const tenantId = process.env.EMPIRE_CLOCK_TENANT_ID;
  const propertyId = process.env.EMPIRE_CLOCK_PROPERTY_ID;
  const startsOn = process.env.EMPIRE_CLOCK_STARTS_ON;
  const endsOn = process.env.EMPIRE_CLOCK_ENDS_ON;
  if (!tenantId || !propertyId || !startsOn || !endsOn)
    throw new Error(
      'EMPIRE_CLOCK_TENANT_ID, EMPIRE_CLOCK_PROPERTY_ID, EMPIRE_CLOCK_STARTS_ON, and EMPIRE_CLOCK_ENDS_ON are required.',
    );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = await app
      .get(ClockBookingConsistencyService)
      .check(tenantId, propertyId, { startsOn, endsOn });
    console.log(JSON.stringify(result, null, 2));
    if (result.findings.length > 0) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

void main();
