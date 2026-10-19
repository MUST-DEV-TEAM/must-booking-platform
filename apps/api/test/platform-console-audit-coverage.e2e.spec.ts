import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '@prisma/client';

import { BUILT_IN_PLATFORM_ROLES, PLATFORM_CAPABILITY_KEYS } from '../src/platform/console/platform-capabilities';
import { discoverConsoleRoutes } from '../src/platform/console/platform-console-routes';
import {
  clearPlatformLoginLimits,
  CONSOLE_HEADERS,
  ConsoleClient,
  ownerClient,
  seedPlatformAccount,
  startConsoleApp,
  TEST_PASSWORD,
} from './helpers/platform-console';

describe('platform console: audit coverage', () => {
  const owner: PrismaClient = ownerClient();
  let app: INestApplication;
  let adminEmail: string;

  beforeAll(async () => {
    await clearPlatformLoginLimits();
    app = await startConsoleApp();
    adminEmail = (await seedPlatformAccount(owner, 'super_admin')).email;
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('writes an audit row for every mutating console route, whether it succeeds or fails', async () => {
    const { AppModule } = await import('../src/app.module');
    const controllers = Reflect.getMetadata('controllers', AppModule);
    const mutating = discoverConsoleRoutes(controllers).filter((route) => route.mutating);
    expect(mutating.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const route of mutating) {
      await clearPlatformLoginLimits();
      const client = new ConsoleClient(app);
      const login = await client.login(adminEmail);
      expect(login.status).toBe(200);

      const path = route.path
        .replace('/platform-console', '')
        .replace(/:[A-Za-z]+/g, () => randomUUID());
      const requestId = `coverage-${randomUUID()}`;
      const verb = route.method.toLowerCase() as 'post' | 'patch' | 'put' | 'delete';
      const req = request(app.getHttpServer())
        [verb](`/platform-console${path}`)
        .set(CONSOLE_HEADERS)
        .set('Cookie', route.public ? '' : client.cookie)
        .set('X-Request-Id', requestId);
      if (!route.public && !route.skipsIdempotency) req.set('Idempotency-Key', randomUUID());
      // An empty or meaningless body: most routes fail validation, which must still be audited.
      const response = await req.send(route.public ? { email: adminEmail, password: 'Wrong-password-1' } : {});
      expect(response.status, `${route.method} ${route.path}`).not.toBe(500);

      const rows = await owner.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM platform_audit_log WHERE request_id = ${requestId}`;
      if (rows[0].n < 1) missing.push(`${route.method} ${route.path} -> ${response.status}`);
    }
    expect(missing).toEqual([]);
  });

  it('keeps the code catalog and the seeded built-in roles identical', async () => {
    const roles = await owner.$queryRaw<Array<{ key: string; capabilities: string[] }>>`
      SELECT key, capabilities FROM platform_roles WHERE is_built_in ORDER BY key`;
    expect(roles.map((role) => role.key).sort()).toEqual(
      BUILT_IN_PLATFORM_ROLES.map((role) => role.key).sort(),
    );
    for (const role of BUILT_IN_PLATFORM_ROLES)
      expect([...(roles.find((row) => row.key === role.key)?.capabilities ?? [])].sort()).toEqual(
        [...role.capabilities].sort(),
      );
    expect(BUILT_IN_PLATFORM_ROLES.find((role) => role.key === 'super_admin')?.capabilities).toEqual(
      PLATFORM_CAPABILITY_KEYS,
    );
    // Finance and the auditor never get write access outside billing.
    const finance = roles.find((row) => row.key === 'finance')!.capabilities;
    expect(finance.filter((key) => !key.startsWith('platform.billing') && key !== 'platform.hotels.view' && key !== 'platform.connections.view')).toEqual([]);
    const auditor = roles.find((row) => row.key === 'auditor')!.capabilities;
    expect(auditor.filter((key) => /manage|create|lifecycle|dangerous|act_as|approve|export/.test(key))).toEqual([]);
    void TEST_PASSWORD;
  });
});
