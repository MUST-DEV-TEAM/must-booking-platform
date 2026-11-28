import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { HOTEL_CEILING_FACTOR, trustedVisitorAddress } from './public-website-client';

const key = 'k'.repeat(40);
const configured = `property-1:${createHash('sha256').update(key).digest('hex')}`;
const headers = { 'x-must-website-key': key, 'x-must-visitor-ip': '203.0.113.7' };

describe('trustedVisitorAddress', () => {
  it('accepts the visitor address only with the key configured for that hotel', () => {
    expect(trustedVisitorAddress(headers, 'property-1', configured)).toBe('203.0.113.7');
    expect(trustedVisitorAddress(headers, 'property-2', configured)).toBeNull();
    expect(trustedVisitorAddress(headers, 'property-1', undefined)).toBeNull();
    expect(
      trustedVisitorAddress(
        { ...headers, 'x-must-website-key': 'x'.repeat(40) },
        'property-1',
        configured,
      ),
    ).toBeNull();
    expect(
      trustedVisitorAddress({ 'x-must-visitor-ip': '203.0.113.7' }, 'property-1', configured),
    ).toBeNull();
    expect(
      trustedVisitorAddress(
        { ...headers, 'x-must-visitor-ip': 'not-an-address' },
        'property-1',
        configured,
      ),
    ).toBeNull();
  });
});

describe('PublicRateLimitGuard with a website key', () => {
  afterEach(() => vi.unstubAllEnvs());

  function run(requestHeaders: Record<string, string>, allowed: (name: string) => boolean) {
    type Consume = (
      options: { name: string },
      caller: string,
    ) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
    const consume = vi.fn<Consume>(async (options) => ({
      allowed: allowed(options.name),
      retryAfterSeconds: 30,
    }));
    const options = { name: 'read', maximum: 120, windowSeconds: 60 };
    const guard = new PublicRateLimitGuard(
      { getAllAndOverride: () => options } as never,
      { consume } as never,
    );
    const request = {
      headers: requestHeaders,
      params: { tenantId: 'tenant-1', propertyId: 'property-1' },
      socket: { remoteAddress: '10.0.0.2' },
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader: vi.fn() }),
      }),
    };
    return { consume, result: guard.canActivate(context as never) };
  }

  it('keeps the shared window for callers without a key, whatever address they claim', async () => {
    vi.stubEnv('WEBSITE_CLIENT_KEYS', configured);
    const { consume, result } = run({ 'x-must-visitor-ip': '203.0.113.7' }, () => true);
    await expect(result).resolves.toBe(true);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0]![1]).toBe('10.0.0.2');
  });

  it('limits each visitor of a known website separately, under a hotel ceiling', async () => {
    vi.stubEnv('WEBSITE_CLIENT_KEYS', configured);
    const { consume, result } = run(headers, () => true);
    await expect(result).resolves.toBe(true);
    expect(consume.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [{ name: 'read', maximum: 120, windowSeconds: 60 }, 'visitor:203.0.113.7'],
      [{ name: 'read:website', maximum: 120 * HOTEL_CEILING_FACTOR, windowSeconds: 60 }, 'website'],
    ]);
  });

  it('refuses a visitor over their limit without using up the hotel ceiling', async () => {
    vi.stubEnv('WEBSITE_CLIENT_KEYS', configured);
    const { consume, result } = run(headers, () => false);
    await expect(result).rejects.toThrow('Too many requests');
    expect(consume).toHaveBeenCalledTimes(1);
  });
});
