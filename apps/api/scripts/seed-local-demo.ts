import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { LocalDemoSeedService } from '../src/tenancy/local-demo-seed.service';

async function main() {
  const tenantId = process.env.LOCAL_DEMO_TENANT_ID;
  const actorUserId = process.env.LOCAL_DEMO_ACTOR_USER_ID;
  if (!tenantId || !actorUserId)
    throw new Error('LOCAL_DEMO_TENANT_ID and LOCAL_DEMO_ACTOR_USER_ID are required.');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const result = await app.get(LocalDemoSeedService).seed(tenantId, actorUserId);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void main();
