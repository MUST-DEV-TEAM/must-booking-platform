import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { PublicRateLimitGuard } from '../src/tenancy/public-rate-limit.guard';

describe('PublicRateLimitGuard', () => {
  it('blocks a public booking mutation after its limit and never trusts a forwarded client IP', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 51 });
    const guard = new PublicRateLimitGuard(
      {
        getAllAndOverride: () => ({ name: 'booking-mutation', maximum: 10, windowSeconds: 60 }),
      } as never,
      { consume } as never,
    );
    const response = { setHeader: vi.fn() };
    const request = {
      headers: { 'x-forwarded-for': '203.0.113.99' },
      params: { tenantId: 'tenant', propertyId: 'property' },
      socket: { remoteAddress: '198.51.100.20' },
      tenantContext: { tenantId: 'tenant', propertyId: 'property' },
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    };

    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(consume).toHaveBeenCalledWith(
      { name: 'booking-mutation', maximum: 10, windowSeconds: 60 },
      '198.51.100.20',
      'tenant',
      'property',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '51');
  });

  it('allows requests within their configured limit', async () => {
    const guard = new PublicRateLimitGuard(
      { getAllAndOverride: () => ({ name: 'read', maximum: 120, windowSeconds: 60 }) } as never,
      { consume: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }) } as never,
    );
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ params: {}, socket: { remoteAddress: '198.51.100.20' } }),
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });
});
