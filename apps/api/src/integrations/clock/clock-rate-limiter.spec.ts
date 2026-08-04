import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { CLOCK_RATE_LIMIT_PER_SECOND, ClockRateLimiterService } from './clock-rate-limiter';

process.env.REDIS_URL ??= 'redis://localhost:6379';

describe('ClockRateLimiterService', () => {
  const limiter = new ClockRateLimiterService();

  afterAll(async () => {
    await limiter.onModuleDestroy();
  });

  it(`allows up to ${CLOCK_RATE_LIMIT_PER_SECOND} requests per second per API user`, async () => {
    const apiUser = `test-user-${randomUUID()}`;
    const results = [];
    for (let i = 0; i < CLOCK_RATE_LIMIT_PER_SECOND; i += 1) {
      results.push(await limiter.consume(apiUser));
    }
    expect(results.every((result) => result.allowed)).toBe(true);
  });

  it(`rejects the request beyond the ${CLOCK_RATE_LIMIT_PER_SECOND}th within the same window`, async () => {
    const apiUser = `test-user-${randomUUID()}`;
    for (let i = 0; i < CLOCK_RATE_LIMIT_PER_SECOND; i += 1) await limiter.consume(apiUser);

    const overLimit = await limiter.consume(apiUser);
    expect(overLimit.allowed).toBe(false);
    expect(overLimit.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('keeps separate counters for different API users', async () => {
    const userA = `test-user-a-${randomUUID()}`;
    const userB = `test-user-b-${randomUUID()}`;
    for (let i = 0; i < CLOCK_RATE_LIMIT_PER_SECOND; i += 1) await limiter.consume(userA);

    const aOverLimit = await limiter.consume(userA);
    const bFirstCall = await limiter.consume(userB);

    expect(aOverLimit.allowed).toBe(false);
    expect(bFirstCall.allowed).toBe(true);
  });

  it('allows requests again once the window rolls over', async () => {
    const apiUser = `test-user-${randomUUID()}`;
    for (let i = 0; i < CLOCK_RATE_LIMIT_PER_SECOND; i += 1) await limiter.consume(apiUser);
    expect((await limiter.consume(apiUser)).allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await limiter.consume(apiUser)).allowed).toBe(true);
  });
});
