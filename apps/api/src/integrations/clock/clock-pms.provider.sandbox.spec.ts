import { describe, expect, it } from 'vitest';

import { ClockCircuitBreakerService } from './clock-circuit-breaker';
import { ClockConnectionPingService } from './clock-connection-ping';
import { ClockHttpClient } from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

// Real-sandbox verification (Milestone 11 Task 6's actual acceptance
// criterion: "run against the owner's real Clock sandbox account"). Skips
// itself when CLOCK_SANDBOX_* env vars aren't set (never set in CI on
// purpose — no third-party sandbox calls on every PR) so this only runs
// when someone deliberately wants to re-verify against the real account.
const hasSandboxCredentials =
  !!process.env.CLOCK_SANDBOX_API_USER &&
  !!process.env.CLOCK_SANDBOX_API_KEY &&
  !!process.env.CLOCK_SANDBOX_BASE_API_URL;

describe.skipIf(!hasSandboxCredentials)('ClockConnectionPingService (real sandbox)', () => {
  it('successfully pings the real Clock sandbox account', async () => {
    const url = new URL(
      process.env.CLOCK_SANDBOX_PMS_API_URL ?? process.env.CLOCK_SANDBOX_BASE_API_URL!,
    );
    const [, , accountId, subscriptionId] = url.pathname.split('/');

    const rateLimiter = new ClockRateLimiterService();
    const ping = new ClockConnectionPingService(
      new ClockHttpClient(),
      rateLimiter,
      new ClockCircuitBreakerService(),
    );

    try {
      const result = await ping.ping({
        host: url.host,
        accountId,
        subscriptionId,
        apiUser: process.env.CLOCK_SANDBOX_API_USER!,
        apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
      });

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Connected to Clock successfully.');
    } finally {
      await rateLimiter.onModuleDestroy();
    }
  }, 15_000);

  it('reports a clear authentication failure for a wrong API key, not a crash', async () => {
    const url = new URL(
      process.env.CLOCK_SANDBOX_PMS_API_URL ?? process.env.CLOCK_SANDBOX_BASE_API_URL!,
    );
    const [, , accountId, subscriptionId] = url.pathname.split('/');

    const rateLimiter = new ClockRateLimiterService();
    const ping = new ClockConnectionPingService(
      new ClockHttpClient(),
      rateLimiter,
      new ClockCircuitBreakerService(),
    );

    try {
      const result = await ping.ping({
        host: url.host,
        accountId,
        subscriptionId,
        apiUser: process.env.CLOCK_SANDBOX_API_USER!,
        apiKey: 'deliberately-wrong-key',
      });

      // Clock's real 401-on-bad-credentials body is plain text, not JSON
      // ({"error": "..."}) — confirmed 2026-08-04. classifyClockHttpResponse
      // correctly surfaces Clock's own message here rather than falling back
      // to a generic one, since the body did contain real content.
      expect(result.ok).toBe(false);
      expect(result.message).toBe('HTTP Digest: Access denied.');
    } finally {
      await rateLimiter.onModuleDestroy();
    }
  }, 15_000);
});
