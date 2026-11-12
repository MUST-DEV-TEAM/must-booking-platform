import { afterEach, describe, expect, it, vi } from 'vitest';

import { PokPayPaymentProvider } from './pokpay-payment.provider';

// A hotel keeps a PokPay test (staging) and a live (production) account and may switch between them at any
// time. Every check and refund of a payment must reach the account that took it, whichever one is in use now.
const STAGING = 'https://api-staging.pokpay.io';
const PRODUCTION = 'https://api.pokpay.io';
const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

function account(connectionId: string, baseUrl: string) {
  return {
    connectionId,
    mode: baseUrl === STAGING ? 'TEST' : 'LIVE',
    credentials: {
      baseUrl,
      keyId: `${connectionId}-key`,
      keySecret: `${connectionId}-secret`,
      merchantId: `${connectionId}-merchant`,
      webhookUrl: 'https://booking.example.test/api/webhooks/pokpay',
    },
  };
}
const testAccount = account('test-account', STAGING);
const liveAccount = account('live-account', PRODUCTION);

function providerWith(connections: Record<string, unknown>) {
  const lookups = {
    activePaymentConnection: vi.fn().mockResolvedValue(testAccount),
    sessionPaymentConnection: vi.fn().mockResolvedValue(null),
    linkedPaymentConnections: vi.fn().mockResolvedValue([]),
    rememberSessionConnection: vi.fn().mockResolvedValue(undefined),
    ...connections,
  };
  return { provider: new PokPayPaymentProvider(lookups as never), lookups };
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A PokPay stand-in: logins always work; `orders` says which host knows which order. */
function pokpay(orders: Record<string, Record<string, unknown>>) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.endsWith('/auth/sdk/login')) return json({ data: { accessToken: 'token' } });
    const host = new URL(url).origin;
    const orderId = decodeURIComponent(url.split('/sdk-orders/')[1]?.split('/')[0] ?? '');
    const order = orders[`${host}|${orderId}`];
    if (!order) return json({ message: 'Order not found' }, 404);
    if (method === 'POST' && url.endsWith('/refund')) {
      order.refundableAmount = Number(order.refundableAmount) - 40;
      return json({ data: { sdkOrder: { id: orderId, isRefunded: false } } });
    }
    return json({ data: { sdkOrder: order } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const paidOrder = (id: string) => ({
  id,
  amount: 100,
  finalAmount: 100,
  currencyCode: 'ALL',
  refundableAmount: 100,
  isCompleted: true,
});

describe('PokPay payments keep the account that took them', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates new orders with the account in use and reports which one it was', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.endsWith('/auth/sdk/login')
          ? json({ data: { accessToken: 'token' } })
          : json({ data: { sdkOrder: { id: 'order-new', _self: { confirmUrl: 'https://pay' } } } });
      }),
    );
    const { provider } = providerWith({});

    const created = await provider.createCheckoutSession(context, {
      idempotencyKey: 'create-1',
      bookingId: 'booking-1',
      amount: { amount: '100.00', currency: 'ALL' },
      successUrl: 'https://guest.example.test/success',
      cancelUrl: 'https://guest.example.test/cancel',
    });

    expect(created).toEqual({
      ok: true,
      value: { id: 'order-new', url: 'https://pay', connectionId: 'test-account' },
    });
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.startsWith(STAGING))).toBe(true);
  });

  it('checks a live payment through the live account while the hotel is on its test account', async () => {
    const calls = pokpay({ [`${PRODUCTION}|order-live`]: paidOrder('order-live') });
    const { provider } = providerWith({
      sessionPaymentConnection: vi.fn().mockResolvedValue(liveAccount),
    });

    await expect(provider.getPayment(context, 'order-live')).resolves.toMatchObject({
      id: 'order-live',
      status: 'COMPLETED',
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.url.startsWith(PRODUCTION))).toBe(true);
  });

  it('refunds a live payment through the live account while the hotel is on its test account', async () => {
    const calls = pokpay({ [`${PRODUCTION}|order-live`]: paidOrder('order-live') });
    const { provider } = providerWith({
      sessionPaymentConnection: vi.fn().mockResolvedValue(liveAccount),
    });

    const refunded = await provider.refund(context, {
      idempotencyKey: 'refund-1',
      paymentId: 'order-live',
      amount: { amount: '40.00', currency: 'ALL' },
      alreadyRefunded: { amount: '0.00', currency: 'ALL' },
    });

    expect(refunded).toMatchObject({ ok: true });
    expect(calls).toContainEqual({
      url: `${PRODUCTION}/merchants/live-account-merchant/sdk-orders/order-live/refund`,
      method: 'POST',
    });
    expect(calls.some((call) => call.url.startsWith(STAGING))).toBe(false);
  });

  it('finds the account of an older order by asking each account, and remembers it', async () => {
    const calls = pokpay({ [`${PRODUCTION}|order-old`]: paidOrder('order-old') });
    const { provider, lookups } = providerWith({
      linkedPaymentConnections: vi.fn().mockResolvedValue([testAccount, liveAccount]),
    });

    await expect(provider.getPayment(context, 'order-old')).resolves.toMatchObject({
      id: 'order-old',
    });
    expect(lookups.rememberSessionConnection).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      'POKPAY',
      'order-old',
      'live-account',
    );
    // The account in use was asked first and did not know the order; nothing was sent anywhere else.
    expect(calls.filter((call) => !call.url.endsWith('/auth/sdk/login'))).toEqual([
      { url: `${STAGING}/merchants/test-account-merchant/sdk-orders/order-old`, method: 'GET' },
      { url: `${PRODUCTION}/merchants/live-account-merchant/sdk-orders/order-old`, method: 'GET' },
      { url: `${PRODUCTION}/merchants/live-account-merchant/sdk-orders/order-old`, method: 'GET' },
    ]);
  });

  it('uses the only account a hotel ever had for an older order without asking around', async () => {
    const calls = pokpay({ [`${PRODUCTION}|order-old`]: paidOrder('order-old') });
    const { provider, lookups } = providerWith({
      activePaymentConnection: vi.fn().mockResolvedValue(null),
      linkedPaymentConnections: vi.fn().mockResolvedValue([liveAccount]),
    });

    await expect(provider.getPayment(context, 'order-old')).resolves.toMatchObject({
      id: 'order-old',
    });
    expect(lookups.rememberSessionConnection).not.toHaveBeenCalled();
    expect(calls.filter((call) => !call.url.endsWith('/auth/sdk/login'))).toEqual([
      { url: `${PRODUCTION}/merchants/live-account-merchant/sdk-orders/order-old`, method: 'GET' },
    ]);
  });
});
