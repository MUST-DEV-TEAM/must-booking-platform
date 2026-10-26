import { afterEach, describe, expect, it, vi } from 'vitest';

import { PokPayPaymentProvider } from '../src/payments/pokpay-payment.provider';

const context = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  propertyId: '00000000-0000-4000-8000-000000000002',
};

function makeProvider(
  credentials: Record<string, string> | null = {
    keyId: 'key-id',
    keySecret: 'key-secret',
    merchantId: 'merchant-id',
    webhookUrl: 'https://api.example.test/webhooks/pokpay',
  },
) {
  const connections = {
    activePaymentConnectionCredentials: vi.fn().mockResolvedValue(credentials),
  };
  return new PokPayPaymentProvider(connections as never);
}

describe('PokPayPaymentProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POKPAY_KEY_ID;
    delete process.env.POKPAY_KEY_SECRET;
    delete process.env.POKPAY_MERCHANT_ID;
    delete process.env.POKPAY_WEBHOOK_URL;
    delete process.env.POKPAY_API_BASE_URL;
    delete process.env.WEB_APP_URL;
  });

  it.each(['https://api-staging.pokpay.io', 'https://api.pokpay.io'])(
    'creates SDK orders and uses authenticated authoritative order reads on %s',
    async (baseUrl) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ data: { accessToken: 'token' } }))
        .mockResolvedValueOnce(
          json({
            data: {
              sdkOrder: { id: 'order-1', _self: { confirmUrl: 'https://pay.pokpay.test/order-1' } },
            },
          }),
        )
        .mockResolvedValueOnce(json({ data: { accessToken: 'token' } }))
        .mockResolvedValueOnce(
          json({
            data: {
              sdkOrder: { id: 'order-1', amount: 12.5, currencyCode: 'EUR', isCompleted: true },
            },
          }),
        );
      vi.stubGlobal('fetch', fetchMock);
      const provider = makeProvider({
        baseUrl,
        keyId: 'key-id',
        keySecret: 'key-secret',
        merchantId: 'merchant-id',
        webhookUrl: 'https://api.example.test/webhooks/pokpay',
      });

      await expect(
        provider.createCheckoutSession(context, {
          idempotencyKey: 'create-1',
          bookingId: 'booking-1',
          amount: { amount: '12.50', currency: 'EUR' },
          successUrl: 'https://guest.example.test/success',
          cancelUrl: 'https://guest.example.test/cancel',
        }),
      ).resolves.toEqual({
        ok: true,
        value: { id: 'order-1', url: 'https://pay.pokpay.test/order-1' },
      });
      await expect(provider.getPayment(context, 'order-1')).resolves.toEqual({
        id: 'order-1',
        bookingId: 'order-1',
        amount: { amount: '12.50', currency: 'EUR' },
        status: 'COMPLETED',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/merchants/merchant-id/sdk-orders`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ authorization: 'Bearer token' }),
        }),
      );
      // PokPay's own API sends/returns the raw currency amount, not cents —
      // confirmed against the real sandbox (a 900.00 EUR total sent as 90000
      // was rejected as "maximum amount of 1000 EUR exceeded"). 12.50 EUR
      // must be sent as 12.5, never 1250.
      const orderCall = fetchMock.mock.calls[1]!;
      expect(JSON.parse(orderCall[1].body as string)).toMatchObject({ amount: 12.5 });
    },
  );

  it('does not represent an unsigned callback as verified', async () => {
    await expect(
      makeProvider().verifyWebhookEvent(context, new Uint8Array(), ''),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'POKPAY_AUTHORITATIVE_REREAD_REQUIRED' },
    });
  });

  it('reports health from a successful authentication-token request', async () => {
    process.env.POKPAY_KEY_ID = 'key-id';
    process.env.POKPAY_KEY_SECRET = 'key-secret';
    process.env.POKPAY_MERCHANT_ID = 'merchant-id';
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { accessToken: 'token' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(makeProvider().checkHealth()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-staging.pokpay.io/auth/sdk/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends orders to the production host when the connection sets the production base URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { accessToken: 'token' } }))
      .mockResolvedValueOnce(
        json({
          data: {
            sdkOrder: { id: 'order-1', _self: { confirmUrl: 'https://pay.pokpay.test/order-1' } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = makeProvider({
      keyId: 'key-id',
      keySecret: 'key-secret',
      merchantId: 'merchant-id',
      webhookUrl: 'https://api.example.test/webhooks/pokpay',
      baseUrl: 'https://api.pokpay.io/',
    });

    await expect(
      provider.createCheckoutSession(context, {
        idempotencyKey: 'create-1',
        bookingId: 'booking-1',
        amount: { amount: '12.50', currency: 'EUR' },
        successUrl: 'https://guest.example.test/success',
        cancelUrl: 'https://guest.example.test/cancel',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pokpay.io/auth/sdk/login',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.pokpay.io/merchants/merchant-id/sdk-orders',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses production and a derived webhook URL when the connection only picks the environment', async () => {
    process.env.WEB_APP_URL = 'https://booking.example.test';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { accessToken: 'token' } }))
      .mockResolvedValueOnce(
        json({
          data: {
            sdkOrder: { id: 'order-1', _self: { confirmUrl: 'https://pay.pokpay.test/order-1' } },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = makeProvider({
      keyId: 'key-id',
      keySecret: 'key-secret',
      merchantId: 'merchant-id',
      environment: 'production',
    });

    await provider.createCheckoutSession(context, {
      idempotencyKey: 'create-1',
      bookingId: 'booking-1',
      amount: { amount: '12.50', currency: 'EUR' },
      successUrl: 'https://guest.example.test/success',
      cancelUrl: 'https://guest.example.test/cancel',
    });
    const orderCall = fetchMock.mock.calls[1]!;
    expect(orderCall[0]).toBe('https://api.pokpay.io/merchants/merchant-id/sdk-orders');
    expect(JSON.parse(orderCall[1].body as string)).toMatchObject({
      webhookUrl: 'https://booking.example.test/api/webhooks/pokpay',
    });
  });

  it('rejects a base URL that is neither PokPay staging nor production, without calling out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = makeProvider({
      keyId: 'key-id',
      keySecret: 'key-secret',
      merchantId: 'merchant-id',
      webhookUrl: 'https://api.example.test/webhooks/pokpay',
      baseUrl: 'https://api.pokpay.io.evil.example',
    });

    await expect(
      provider.createCheckoutSession(context, {
        idempotencyKey: 'create-1',
        bookingId: 'booking-1',
        amount: { amount: '12.50', currency: 'EUR' },
        successUrl: 'https://guest.example.test/success',
        cancelUrl: 'https://guest.example.test/cancel',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'POKPAY_BASE_URL_NOT_ALLOWED' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function json(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
