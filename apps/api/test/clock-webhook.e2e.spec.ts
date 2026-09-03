import { randomUUID } from 'node:crypto';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockWebhookVerificationService } from '../src/integrations/clock/clock-webhook-verification.service';
import type { SnsEnvelope } from '../src/integrations/clock/clock-webhook-signature';
import { buildCanonicalString } from '../src/integrations/clock/clock-webhook-signature';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

// A live Message Channels subscription now exists for this account (activated
// 2026-09-03, see docs/CLOCK_RUNBOOK.md) and real event shapes were captured
// from it — see the 'parses a real Clock event shape' test below. Real AWS
// SNS traffic still isn't exercised directly *in this suite* (that needs a
// live subscription and a public URL, neither available in CI); everything
// except the literal "fetch cert bytes from AWS" step is real:
// real HTTP routing, real RLS-carve-out lookup by webhookPublicId, real
// RSA signature verification against a real generated key pair, real
// dedup via the unique (connection_id, event_id) constraint, and a real
// job landing on the real clock.webhooks BullMQ queue. Only the network
// fetch of the signing cert is stubbed (ClockWebhookVerificationService's
// fetchCert is injectable for exactly this reason — same pattern as
// ClockHttpClient's protocol override for local-server tests).
const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privatePem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function signedNotification(overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
  const envelope: SnsEnvelope = {
    Type: 'Notification',
    MessageId: randomUUID(),
    TopicArn: 'arn:aws:sns:eu-west-1:123456789012:clock-events',
    Message: JSON.stringify({ type: 'booking.updated', id: 987654 }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1',
    Signature: '',
    SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-test.pem',
    ...overrides,
  };
  const signer = createSign('RSA-SHA1');
  signer.update(buildCanonicalString(envelope), 'utf8');
  signer.end();
  envelope.Signature = signer.sign(privatePem, 'base64');
  return envelope;
}

describe('Clock webhook gateway', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let webhookPublicId: string;
  let connectionId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-webhook-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(ClockWebhookVerificationService)
      .useValue(new ClockWebhookVerificationService(async () => certPem))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Webhook Hotel',
        propertyName: 'Main Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Clock Webhook Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Webhook Test Clock',
        credentials: {
          host: 'h',
          accountId: '1',
          subscriptionId: '2',
          apiUser: 'u',
          apiKey: 'k',
          snsTopicArn: 'arn:aws:sns:eu-west-1:123456789012:clock-events',
        },
      })
      .expect(201);
    connectionId = connection.body.id;
    webhookPublicId = connection.body.webhookPublicId;
    expect(webhookPublicId).toMatch(/^[0-9a-f-]{36}$/);
    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/integration-connections/${connectionId}`,
      )
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('accepts a genuinely signed notification, stores it, and enqueues hydration', async () => {
    const envelope = signedNotification();

    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${webhookPublicId}`)
      .send(envelope)
      .expect(200);

    const stored = await admin.$queryRaw<
      Array<{ eventType: string; objectId: string; status: string }>
    >`
      SELECT event_type AS "eventType", object_id AS "objectId", status FROM provider_events
      WHERE connection_id = ${connectionId}::uuid AND event_id = ${envelope.MessageId}
    `;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({
      eventType: 'booking.updated',
      objectId: '987654',
      status: 'RECEIVED',
    });

    const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queue = new Queue('clock.webhooks', { connection: redis });
    const counts = await queue.getJobCounts();
    expect(counts.waiting + counts.active + counts.completed).toBeGreaterThan(0);
    redis.disconnect();

    const connectionRow = await admin.$queryRaw<Array<{ lastWebhookReceivedAt: Date | null }>>`
      SELECT last_webhook_received_at AS "lastWebhookReceivedAt" FROM integration_connections
      WHERE id = ${connectionId}::uuid
    `;
    expect(connectionRow[0]!.lastWebhookReceivedAt).not.toBeNull();
  });

  it('parses a real Clock event shape (Subject carries the type, Message is a single-key id) — captured 2026-09-03 against Empire Beach Resort', async () => {
    const envelope = signedNotification({
      Subject: 'booking_new',
      Message: JSON.stringify({ booking_id: 38144004 }),
    });

    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${webhookPublicId}`)
      .send(envelope)
      .expect(200);

    const stored = await admin.$queryRaw<Array<{ eventType: string; objectId: string }>>`
      SELECT event_type AS "eventType", object_id AS "objectId" FROM provider_events
      WHERE connection_id = ${connectionId}::uuid AND event_id = ${envelope.MessageId}
    `;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({ eventType: 'booking_new', objectId: '38144004' });
  });

  it('is idempotent — replaying the same MessageId does not create a second event', async () => {
    const envelope = signedNotification();

    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${webhookPublicId}`)
      .send(envelope)
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${webhookPublicId}`)
      .send(envelope)
      .expect(200);

    const stored = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM provider_events WHERE connection_id = ${connectionId}::uuid AND event_id = ${envelope.MessageId}
    `;
    expect(stored).toHaveLength(1);
  });

  it('rejects a tampered message (bad signature) and stores nothing', async () => {
    const envelope = signedNotification();
    const tampered = { ...envelope, Message: JSON.stringify({ type: 'booking.updated', id: 111 }) };

    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${webhookPublicId}`)
      .send(tampered)
      .expect(400);

    const stored = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM provider_events WHERE connection_id = ${connectionId}::uuid AND event_id = ${tampered.MessageId}
    `;
    expect(stored).toHaveLength(0);
  });

  it('rejects a validly signed notification from a different SNS topic', async () => {
    const envelope = signedNotification({
      TopicArn: 'arn:aws:sns:eu-west-1:123456789012:untrusted-topic',
    });

    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${webhookPublicId}`)
      .send(envelope)
      .expect(400);

    const stored = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM provider_events WHERE connection_id = ${connectionId}::uuid
        AND event_id = ${envelope.MessageId}
    `;
    expect(stored).toHaveLength(0);
  });

  it('returns 404 for an unknown webhookPublicId rather than leaking connection existence', async () => {
    await request(app!.getHttpServer())
      .post(`/clock-webhooks/${randomUUID()}`)
      .send(signedNotification())
      .expect(404);
  });
});
