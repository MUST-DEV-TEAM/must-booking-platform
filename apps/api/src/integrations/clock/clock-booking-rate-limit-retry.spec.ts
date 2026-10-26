import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClockBookingService } from './clock-booking.service';

afterEach(() => vi.useRealTimers());

const credentials = {
  host: 'h',
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'api-user',
  apiKey: 'k',
};

function setup(responses: Array<{ status: number; body?: unknown }>, limiterAllows = true) {
  const client = { request: vi.fn() };
  for (const response of responses)
    client.request.mockResolvedValueOnce({ status: response.status, body: response.body ?? {} });
  const service = Object.assign(Object.create(ClockBookingService.prototype), {
    client,
    circuitBreaker: { assertClosed: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() },
    rateLimiter: {
      consume: vi
        .fn()
        .mockResolvedValue(
          limiterAllows ? { allowed: true } : { allowed: false, retryAfterSeconds: 1 },
        ),
    },
  });
  const call = (method: 'GET' | 'POST' | 'PUT' = 'POST') =>
    (
      service as unknown as {
        fetch: (c: unknown, o: unknown) => Promise<{ ok: boolean; error?: { category: string } }>;
      }
    ).fetch(credentials, { method, path: '/bookings/', body: { booking: {} } });
  return { client, call, service };
}

describe('Clock booking requests and rate limits', () => {
  it('retries a booking creation that Clock refused with 429, because nothing was processed', async () => {
    vi.useFakeTimers();
    const { call, client } = setup([
      { status: 429 },
      { status: 429 },
      { status: 201, body: { id: 7 } },
    ]);

    const result = call('POST');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ ok: true });
    expect(client.request).toHaveBeenCalledTimes(3);
  });

  it('gives up after a few tries and reports the rate limit', async () => {
    vi.useFakeTimers();
    const { call, client } = setup([
      { status: 429 },
      { status: 429 },
      { status: 429 },
      { status: 429 },
    ]);

    const result = call('PUT');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ ok: false, error: { category: 'rate_limited' } });
    expect(client.request).toHaveBeenCalledTimes(4);
  });

  it('waits for the local limiter and never sends while it refuses', async () => {
    vi.useFakeTimers();
    const { call, client } = setup([], false);

    const result = call('POST');
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ ok: false, error: { category: 'rate_limited' } });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('does not retry any other failure, so a possibly processed request is never repeated', async () => {
    const { call, client } = setup([{ status: 500, body: { error: 'boom' } }]);

    const result = await call('POST');

    expect(result).toMatchObject({ ok: false });
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});
