import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { PublicRateLimiterService } from '../src/tenancy/public-rate-limiter.service';

process.env.REDIS_URL ??= 'redis://localhost:6379';

describe('PublicRateLimiterService', () => {
  const limiter = new PublicRateLimiterService();

  afterAll(async () => {
    await limiter.onModuleDestroy();
  });

  it('rejects the request after the configured limit is exceeded', async () => {
    const clientIp = `rate-limit-test-${randomUUID()}`;
    const options = { name: 'test-booking-mutation', maximum: 2, windowSeconds: 60 };

    await expect(limiter.consume(options, clientIp, 'tenant', 'property')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume(options, clientIp, 'tenant', 'property')).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume(options, clientIp, 'tenant', 'property')).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
  });
});
