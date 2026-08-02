import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StripePaymentProvider } from './stripe-payment.provider';

const secretKey = 'sk_test_webhook_provider_test';
const webhookSecret = 'whsec_webhook_provider_test';
const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const bookingId = '33333333-3333-4333-8333-333333333333';

const payload = JSON.stringify({
  id: 'evt_test_checkout_completed',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_checkout_completed',
      object: 'checkout.session',
      payment_status: 'paid',
      metadata: { tenantId: context.tenantId, propertyId: context.propertyId, bookingId },
    },
  },
});

const originalSecretKey = process.env.STRIPE_SECRET_KEY;
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalSecretKey;
  if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
});

describe('StripePaymentProvider.refund', () => {
  it('resolves a Checkout session to its payment intent and sends an idempotent refund', async () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    const stripe = new Stripe(secretKey);
    const sessions = Object.getPrototypeOf(stripe.checkout.sessions) as {
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
    };
    const refunds = Object.getPrototypeOf(stripe.refunds) as {
      create: (...args: unknown[]) => Promise<Stripe.Refund>;
    };
    const retrieve = vi
      .spyOn(sessions, 'retrieve')
      .mockResolvedValue({ payment_intent: 'pi_test_original' } as Stripe.Checkout.Session);
    const create = vi
      .spyOn(refunds, 'create')
      .mockResolvedValue({ id: 're_test_refund', status: 'succeeded' } as Stripe.Refund);

    await expect(
      new StripePaymentProvider().refund(context, {
        idempotencyKey: 'refund-attempt-1',
        paymentId: 'cs_test_original',
        amount: { amount: '12.34', currency: 'EUR' },
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: 're_test_refund',
        bookingId: 'cs_test_original',
        amount: { amount: '12.34', currency: 'EUR' },
        status: 'succeeded',
      },
    });
    expect(retrieve).toHaveBeenCalledWith('cs_test_original');
    expect(create).toHaveBeenCalledWith(
      { payment_intent: 'pi_test_original', amount: 1234 },
      { idempotencyKey: 'refund-attempt-1' },
    );
  });
});

describe('StripePaymentProvider.checkHealth', () => {
  it('uses the Stripe balance endpoint', async () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    const stripe = new Stripe(secretKey);
    const balance = Object.getPrototypeOf(stripe.balance) as {
      retrieve: () => Promise<Stripe.Balance>;
    };
    const retrieve = vi.spyOn(balance, 'retrieve').mockResolvedValue({} as Stripe.Balance);

    await expect(new StripePaymentProvider().checkHealth()).resolves.toEqual({ ok: true });
    expect(retrieve).toHaveBeenCalledOnce();
  });
});

describe('StripePaymentProvider.verifyWebhookEvent', () => {
  it('accepts a valid signed Checkout payment event and returns only verified metadata', async () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const signature = new Stripe(secretKey).webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    await expect(
      new StripePaymentProvider().verifyWebhookEvent(context, Buffer.from(payload), signature),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: 'evt_test_checkout_completed',
        type: 'checkout.session.completed',
        externalPaymentId: 'cs_test_checkout_completed',
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        bookingId,
        paymentStatus: 'paid',
      },
    });
  });

  it('rejects missing and tampered Stripe signatures', async () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const signature = new Stripe(secretKey).webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const provider = new StripePaymentProvider();

    await expect(
      provider.verifyWebhookEvent(context, Buffer.from(payload), ''),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'STRIPE_SIGNATURE_MISSING' },
    });
    await expect(
      provider.verifyWebhookEvent(context, Buffer.from(`${payload} `), signature),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'STRIPE_SIGNATURE_INVALID' },
    });
  });
});
