import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { StripeWebhookController } from './stripe-webhook.controller';

const connection = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  connectionId: '22222222-2222-4222-8222-222222222222',
  secretKey: 'sk_test_a',
  webhookSecret: 'whsec_a',
};
const paidEvent = {
  id: 'evt_1',
  type: 'checkout.session.completed',
  externalPaymentId: 'cs_test_1',
  tenantId: connection.tenantId,
  propertyId: '33333333-3333-4333-8333-333333333333',
  bookingId: '44444444-4444-4444-8444-444444444444',
  paymentStatus: 'paid',
};

function build(overrides: { connection?: typeof connection | null; verified?: unknown } = {}) {
  const verifyWebhookEvent = vi.fn(
    async () => overrides.verified ?? { ok: true, value: paidEvent },
  );
  const processPaymentSucceeded = vi.fn(async () => ({ ok: true }));
  const connections = {
    stripeWebhookConnection: vi.fn(async () =>
      overrides.connection === undefined ? connection : overrides.connection,
    ),
  };
  const controller = new StripeWebhookController(
    { verifyWebhookEvent } as never,
    { processPaymentSucceeded } as never,
    connections as never,
  );
  const receive = (signature = 't=1,v1=x') =>
    controller.receive('55555555-5555-4555-8555-555555555555', signature, {
      rawBody: Buffer.from('{}'),
    } as never);
  return { receive, verifyWebhookEvent, processPaymentSucceeded };
}

describe('StripeWebhookController (one endpoint and secret per hotel connection)', () => {
  it('answers 404 for an unknown webhook id without verifying anything', async () => {
    const { receive, verifyWebhookEvent } = build({ connection: null });
    await expect(receive()).rejects.toBeInstanceOf(NotFoundException);
    expect(verifyWebhookEvent).not.toHaveBeenCalled();
  });

  it("verifies with that connection's own keys and records the paid event", async () => {
    const { receive, verifyWebhookEvent, processPaymentSucceeded } = build();
    await expect(receive()).resolves.toEqual({ received: true });
    expect(verifyWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: connection.tenantId,
        stripeWebhook: { secretKey: 'sk_test_a', webhookSecret: 'whsec_a' },
      }),
      expect.anything(),
      't=1,v1=x',
    );
    expect(processPaymentSucceeded).toHaveBeenCalledWith(paidEvent, connection.connectionId);
  });

  it('rejects a bad signature and records nothing', async () => {
    const { receive, processPaymentSucceeded } = build({
      verified: { ok: false, error: { code: 'STRIPE_SIGNATURE_INVALID', message: 'bad' } },
    });
    await expect(receive()).rejects.toBeInstanceOf(BadRequestException);
    expect(processPaymentSucceeded).not.toHaveBeenCalled();
  });

  it("rejects an event whose booking belongs to another hotel's account", async () => {
    const { receive, processPaymentSucceeded } = build({
      verified: {
        ok: true,
        value: { ...paidEvent, tenantId: '99999999-9999-4999-8999-999999999999' },
      },
    });
    await expect(receive()).rejects.toBeInstanceOf(BadRequestException);
    expect(processPaymentSucceeded).not.toHaveBeenCalled();
  });

  it("answers 400, not a retry, when the payment belongs to another connection's account", async () => {
    const { receive, processPaymentSucceeded } = build();
    processPaymentSucceeded.mockResolvedValueOnce({
      ok: false,
      error: { code: 'STRIPE_CONNECTION_MISMATCH', message: 'different connection' },
    } as never);
    await expect(receive()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a paid event that names no tenant at all', async () => {
    const { receive, processPaymentSucceeded } = build({
      verified: { ok: true, value: { ...paidEvent, tenantId: undefined } },
    });
    await expect(receive()).rejects.toBeInstanceOf(BadRequestException);
    expect(processPaymentSucceeded).not.toHaveBeenCalled();
  });
});
