import { afterEach, expect, it, vi } from 'vitest';
import { PokPayPaymentProvider } from './pokpay-payment.provider';
afterEach(() => vi.unstubAllGlobals());
it('blocks restaurant create, read and refund before any production HTTP request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const production = {
    connectionId: 'live',
    mode: 'LIVE',
    credentials: {
      environment: 'production',
      keyId: 'test',
      keySecret: 'test',
      merchantId: 'test',
      webhookUrl: 'https://example.test/api/webhooks/pokpay',
    },
  };
  const provider = new PokPayPaymentProvider({
    activePaymentConnection: async () => production,
    sessionPaymentConnection: async () => production,
    linkedPaymentConnections: async () => [production],
    rememberSessionConnection: async () => undefined,
  } as never);
  const context = { tenantId: 'tenant', propertyId: 'property', stagingOnly: true };
  expect(
    await provider.createCheckoutSession(context, {
      idempotencyKey: 'key',
      bookingId: 'reservation',
      amount: { amount: '20.00', currency: 'EUR' },
      successUrl: 'https://example.test',
      cancelUrl: 'https://example.test',
    }),
  ).toMatchObject({ ok: false, error: { code: 'POKPAY_STAGING_REQUIRED' } });
  expect(await provider.getPayment(context, 'order')).toBeNull();
  expect(
    await provider.refund(context, {
      idempotencyKey: 'refund',
      paymentId: 'order',
      amount: { amount: '20.00', currency: 'EUR' },
    }),
  ).toMatchObject({ ok: false, error: { code: 'POKPAY_STAGING_REQUIRED' } });
  expect(fetch).not.toHaveBeenCalled();
});
