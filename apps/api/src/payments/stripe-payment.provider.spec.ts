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

function makeProvider(
  tenantSecretKey = secretKey,
  sessionSecretKey: string | null = null,
  publishableKey?: string,
) {
  const connections = {
    activePaymentConnection: vi.fn().mockResolvedValue({
      connectionId: 'conn-in-use',
      mode: 'TEST',
      credentials: { secretKey: tenantSecretKey, ...(publishableKey ? { publishableKey } : {}) },
    }),
    sessionPaymentConnection: vi.fn().mockResolvedValue(
      sessionSecretKey
        ? {
            connectionId: 'conn-of-order',
            mode: 'TEST',
            credentials: { secretKey: sessionSecretKey },
          }
        : null,
    ),
  };
  return Object.assign(new StripePaymentProvider(connections as never), { mocks: connections });
}

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
      makeProvider().refund(context, {
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

describe('StripePaymentProvider accounts (the connection that took the payment)', () => {
  it('sends a refund through the account that took the payment, not the one now in use', async () => {
    const stripe = new Stripe(secretKey);
    const sessions = Object.getPrototypeOf(stripe.checkout.sessions) as {
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
    };
    vi.spyOn(sessions, 'retrieve').mockResolvedValue({
      payment_intent: 'pi_test_original',
    } as Stripe.Checkout.Session);
    const refunds = Object.getPrototypeOf(stripe.refunds) as {
      create: (...args: unknown[]) => Promise<Stripe.Refund>;
    };
    vi.spyOn(refunds, 'create').mockResolvedValue({
      id: 're_test_refund',
      status: 'succeeded',
    } as Stripe.Refund);
    const provider = makeProvider('sk_test_in_use', 'sk_test_of_order');

    await provider.refund(context, {
      idempotencyKey: 'refund-attempt-2',
      paymentId: 'cs_test_original',
      amount: { amount: '5.00', currency: 'EUR' },
    });

    expect(provider.mocks.sessionPaymentConnection).toHaveBeenCalledWith(
      context.tenantId,
      context.propertyId,
      'STRIPE',
      'cs_test_original',
    );
    expect(provider.mocks.activePaymentConnection).not.toHaveBeenCalled();
  });

  it('uses the account in use for a payment whose account was never recorded', async () => {
    const provider = makeProvider('sk_test_in_use', null);
    vi.spyOn(
      Object.getPrototypeOf(new Stripe(secretKey).checkout.sessions),
      'retrieve',
    ).mockResolvedValue({
      payment_intent: 'pi_x',
    });
    await provider.refund(context, {
      idempotencyKey: 'refund-attempt-3',
      paymentId: 'cs_test_old',
      amount: { amount: '1.00', currency: 'EUR' },
    });
    expect(provider.mocks.activePaymentConnection).toHaveBeenCalled();
  });

  it('reports which account created a checkout session', async () => {
    const stripe = new Stripe(secretKey);
    const sessions = Object.getPrototypeOf(stripe.checkout.sessions) as {
      create: (...args: unknown[]) => Promise<Stripe.Checkout.Session>;
    };
    vi.spyOn(sessions, 'create').mockResolvedValue({
      id: 'cs_test_new',
      url: 'https://checkout.stripe.test/cs_test_new',
    } as Stripe.Checkout.Session);

    await expect(
      makeProvider().createCheckoutSession(context, {
        idempotencyKey: 'k',
        bookingId,
        amount: { amount: '10.00', currency: 'EUR' },
        successUrl: 'https://x.test/s',
        cancelUrl: 'https://x.test/c',
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: 'cs_test_new',
        url: 'https://checkout.stripe.test/cs_test_new',
        connectionId: 'conn-in-use',
      },
    });
  });
});

describe('StripePaymentProvider embedded checkout', () => {
  const command = {
    idempotencyKey: 'k',
    bookingId,
    amount: { amount: '10.00', currency: 'EUR' },
    successUrl: 'https://x.test/s',
    cancelUrl: 'https://x.test/c',
  };
  const spyCreate = (result: Partial<Stripe.Checkout.Session>) => {
    const sessions = Object.getPrototypeOf(new Stripe(secretKey).checkout.sessions) as {
      create: (...args: unknown[]) => Promise<Stripe.Checkout.Session>;
    };
    return vi.spyOn(sessions, 'create').mockResolvedValue(result as Stripe.Checkout.Session);
  };

  it('returns a client secret and the publishable key when the website asks and the hotel saved one', async () => {
    const create = spyCreate({ id: 'cs_test_emb', client_secret: 'cs_test_emb_secret_x' });
    await expect(
      makeProvider(secretKey, null, 'pk_test_abc').createCheckoutSession(context, {
        ...command,
        embedded: true,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: 'cs_test_emb',
        url: '',
        connectionId: 'conn-in-use',
        clientSecret: 'cs_test_emb_secret_x',
        publishableKey: 'pk_test_abc',
      },
    });
    const sent = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      ui_mode: 'embedded_page',
      return_url: 'https://x.test/s',
      redirect_on_completion: 'if_required',
    });
    expect(sent).not.toHaveProperty('success_url');
    expect(sent).not.toHaveProperty('cancel_url');
  });

  it("falls back to Stripe's own page when the hotel has no publishable key", async () => {
    const create = spyCreate({ id: 'cs_test_host', url: 'https://checkout.stripe.test/x' });
    await expect(
      makeProvider().createCheckoutSession(context, { ...command, embedded: true }),
    ).resolves.toMatchObject({ ok: true, value: { url: 'https://checkout.stripe.test/x' } });
    expect(create.mock.calls[0]![0]).toMatchObject({ success_url: 'https://x.test/s' });
    expect(create.mock.calls[0]![0]).not.toHaveProperty('ui_mode');
  });

  it('keeps the normal page when the website did not ask for the embedded one', async () => {
    const create = spyCreate({ id: 'cs_test_host', url: 'https://checkout.stripe.test/x' });
    await makeProvider(secretKey, null, 'pk_test_abc').createCheckoutSession(context, command);
    expect(create.mock.calls[0]![0]).not.toHaveProperty('ui_mode');
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

    await expect(makeProvider().checkHealth()).resolves.toEqual({ ok: true });
    expect(retrieve).toHaveBeenCalledOnce();
  });
});

describe('StripePaymentProvider.verifyWebhookEvent', () => {
  const withSecrets = { ...context, stripeWebhook: { secretKey, webhookSecret } };

  it('accepts a valid signed Checkout payment event and returns only verified metadata', async () => {
    const signature = new Stripe(secretKey).webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    await expect(
      makeProvider().verifyWebhookEvent(withSecrets, Buffer.from(payload), signature),
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
    const signature = new Stripe(secretKey).webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const provider = makeProvider();

    await expect(
      provider.verifyWebhookEvent(withSecrets, Buffer.from(payload), ''),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'STRIPE_SIGNATURE_MISSING' },
    });
    await expect(
      provider.verifyWebhookEvent(withSecrets, Buffer.from(`${payload} `), signature),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'STRIPE_SIGNATURE_INVALID' },
    });
  });

  it('refuses to verify when the connection has no webhook secret, never falling back to the environment', async () => {
    process.env.STRIPE_SECRET_KEY = secretKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const signature = new Stripe(secretKey).webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });

    await expect(
      makeProvider().verifyWebhookEvent(context, Buffer.from(payload), signature),
    ).resolves.toMatchObject({ ok: false, error: { code: 'STRIPE_WEBHOOK_NOT_CONFIGURED' } });
  });
});
