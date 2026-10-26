import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import { MailDeliveryService } from '../../src/mail/mail-delivery.service';
import { MAIL_PROVIDER, type MailProvider } from '../../src/mail/mail.provider';
import { isolatedMailDelivery } from './isolated-mail-delivery';
import { withoutExternalWorkers } from './without-external-workers';

/** Local runs point these at an isolated database through apps/api/.env; CI uses the defaults. */
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public';
export const TEST_MIGRATION_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public';

export const TEST_PASSWORD = 'Console-Test-Pass-1234';

/** Migration-owner client: bypasses RLS, used only to arrange and inspect test data. */
export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_MIGRATION_URL } } });
}

/** Captures staff invitation emails so a test can follow the link without a real mailbox. */
export class MailCapture {
  readonly invitations: Array<{ to: string; invitationUrl: string }> = [];
  readonly provider = new Proxy(
    {
      sendStaffInvitationEmail: async (command: { to: string; invitationUrl: string }) => {
        this.invitations.push({
          to: command.to.toLowerCase(),
          invitationUrl: command.invitationUrl,
        });
      },
    },
    {
      // Only send* calls are stubbed; answering `then` or lifecycle hooks would make Nest wait forever.
      get: (target, key) =>
        (target as Record<string | symbol, unknown>)[key] ??
        (typeof key === 'string' && key.startsWith('send') ? async () => undefined : undefined),
    },
  ) as unknown as MailProvider;

  tokenFor(email: string): string {
    const invitation = [...this.invitations]
      .reverse()
      .find((entry) => entry.to === email.toLowerCase());
    if (!invitation) throw new Error(`No invitation email captured for ${email}`);
    return new URL(invitation.invitationUrl).searchParams.get('token')!;
  }
}

export async function startConsoleApp(mail?: MailCapture): Promise<INestApplication> {
  process.env.APP_PORT ??= '3000';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.WEB_APP_URL ??= 'http://localhost:3001';
  const { AppModule } = await import('../../src/app.module');
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (mail) builder.overrideProvider(MAIL_PROVIDER).useValue(mail.provider);
  builder.overrideProvider(MailDeliveryService).useFactory(isolatedMailDelivery);
  const moduleRef = await withoutExternalWorkers(builder).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export type TestAccount = { id: string; email: string; roleKey: string };

/** Creates an ACTIVE platform account directly (arrange step). */
export async function seedPlatformAccount(
  owner: PrismaClient,
  roleKey: 'super_admin' | 'operations' | 'finance' | 'auditor',
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
): Promise<TestAccount> {
  const email = `console-${roleKey}-${randomUUID()}@example.test`;
  const hash = await bcrypt.hash(TEST_PASSWORD, 4);
  const rows = await owner.$queryRaw<Array<{ id: string }>>`
    INSERT INTO platform_accounts (email, first_name, last_name, password_hash, role_id, status)
    SELECT ${email}, 'Test', ${roleKey}, ${hash}, r.id, ${status}
    FROM platform_roles r WHERE r.key = ${roleKey}
    RETURNING id
  `;
  return { id: rows[0]!.id, email, roleKey };
}

export const CONSOLE_HEADERS = { 'X-Platform-Console': '1' } as const;

/** Thin client for console routes: adds the CSRF header and an Idempotency-Key to writes. */
export class ConsoleClient {
  constructor(
    private readonly app: INestApplication,
    public cookie = '',
  ) {}

  private build(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) {
    const req = request(this.app.getHttpServer())[method](`/platform-console${path}`);
    req.set(CONSOLE_HEADERS);
    if (this.cookie) req.set('Cookie', this.cookie);
    return req;
  }

  async login(email: string, password = TEST_PASSWORD) {
    const response = await this.build('post', '/auth/login').send({ email, password });
    const set = response.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = set?.find((entry) => entry.startsWith('must_platform='));
    if (cookie) this.cookie = cookie.split(';')[0]!;
    return response;
  }

  get(path: string) {
    return this.build('get', path);
  }

  write(
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body: unknown = {},
    key: string | null = randomUUID(),
  ) {
    const req = this.build(method, path);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body as object);
  }
}

export async function loggedIn(
  app: INestApplication,
  account: TestAccount,
): Promise<ConsoleClient> {
  const client = new ConsoleClient(app);
  const response = await client.login(account.email);
  if (response.status !== 200) throw new Error(`Login failed in test arrange: ${response.status}`);
  return client;
}

export async function clearPlatformLoginLimits(): Promise<void> {
  const { createClient } = await import('redis');
  const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });
  await redis.connect();
  const keys = await redis.keys('rate-limit:platform-login:*');
  if (keys.length) await redis.del(keys);
  await redis.quit();
}
