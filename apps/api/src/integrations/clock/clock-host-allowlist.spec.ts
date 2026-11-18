import { afterEach, describe, expect, it } from 'vitest';

import { isAllowedClockHost } from './clock-credentials';
import { ClockHttpClient, ClockHttpError } from './clock-http-client';

const credentials = (host: string) => ({
  host,
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'user',
  apiKey: 'key',
});

describe('Clock API host allowlist (task 39-10a)', () => {
  const extra = process.env.CLOCK_EXTRA_API_HOSTS;
  afterEach(() => {
    process.env.CLOCK_EXTRA_API_HOSTS = extra;
  });

  it('allows only Clock’s own API host in production', () => {
    delete process.env.CLOCK_EXTRA_API_HOSTS;
    expect(isAllowedClockHost('sky-eu1.clock-software.com')).toBe(true);
    expect(isAllowedClockHost(' SKY-EU1.clock-software.com ')).toBe(true);
    for (const host of [
      'evil.example.com',
      'sky-eu1.clock-software.com.evil.com',
      'sky-eu1.clock-software.com:8443',
      'user@sky-eu1.clock-software.com',
      '169.254.169.254',
      'localhost',
      'h',
      '',
    ])
      expect(isAllowedClockHost(host)).toBe(false);
  });

  it('adds exact test host names, with or without a port, from CLOCK_EXTRA_API_HOSTS', () => {
    process.env.CLOCK_EXTRA_API_HOSTS = '127.0.0.1, clock.example.test';
    expect(isAllowedClockHost('127.0.0.1:43123')).toBe(true);
    expect(isAllowedClockHost('clock.example.test')).toBe(true);
    expect(isAllowedClockHost('other.example.test')).toBe(false);
    expect(isAllowedClockHost('a.clock.example.test')).toBe(false);
  });

  it('refuses to send a request anywhere else, before any network call', async () => {
    delete process.env.CLOCK_EXTRA_API_HOSTS;
    await expect(
      new ClockHttpClient().request(credentials('169.254.169.254'), {
        api: 'base',
        path: '/rooms',
      } as never),
    ).rejects.toBeInstanceOf(ClockHttpError);
  });
});
