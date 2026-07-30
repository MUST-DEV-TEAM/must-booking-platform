import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SignupRateLimitGuard } from '../src/auth/signup-rate-limit.guard';

describe('SignupRateLimitGuard', () => {
  it('uses the socket peer address instead of a caller-supplied forwarded header', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    const guard = new SignupRateLimitGuard(
      { getAllAndOverride: () => true } as never,
      { consume } as never,
    );
    const request = {
      body: { email: 'owner@example.test' },
      headers: { 'x-forwarded-for': '203.0.113.99' },
      socket: { remoteAddress: '198.51.100.20' },
    };
    const response = { setHeader: vi.fn() };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(consume).toHaveBeenCalledWith('198.51.100.20', 'owner@example.test');
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('sets Retry-After when the socket IP exceeds a limit', async () => {
    const guard = new SignupRateLimitGuard(
      { getAllAndOverride: () => true } as never,
      { consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterSeconds: 45 }) } as never,
    );
    const response = { setHeader: vi.fn() };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ body: {}, socket: { remoteAddress: '198.51.100.20' } }),
        getResponse: () => response,
      }),
    };

    await expect(guard.canActivate(context as never)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '45');
  });
});
