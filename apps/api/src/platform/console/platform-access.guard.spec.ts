import { afterEach, describe, expect, it } from 'vitest';

import { clientIp } from './platform-access.guard';

const request = (forwarded?: string) =>
  ({
    method: 'POST',
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
    socket: { remoteAddress: '10.0.0.7' },
  }) as Parameters<typeof clientIp>[0];

describe('clientIp', () => {
  afterEach(() => {
    delete process.env.PLATFORM_TRUSTED_PROXY_HOPS;
  });

  it('ignores X-Forwarded-For unless proxies are explicitly trusted', () => {
    expect(clientIp(request('203.0.113.9'))).toBe('10.0.0.7');
  });

  it('takes the entry the nearest trusted proxy appended, not the client-controlled left side', () => {
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = '1';
    expect(clientIp(request('6.6.6.6, 198.51.100.4'))).toBe('198.51.100.4');
  });

  it('counts hops from the right when several proxies are trusted', () => {
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = '2';
    expect(clientIp(request('6.6.6.6, 198.51.100.4, 192.0.2.1'))).toBe('198.51.100.4');
  });

  it('falls back to the socket address when the chain is shorter than the trusted hops', () => {
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = '3';
    expect(clientIp(request('198.51.100.4'))).toBe('10.0.0.7');
  });
});
