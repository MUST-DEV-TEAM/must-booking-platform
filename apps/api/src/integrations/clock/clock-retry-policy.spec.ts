import { describe, expect, it } from 'vitest';

import type { ClockClassifiedError } from './clock-error-classification';
import { isRetryEligible, nextRetryDelayMs } from './clock-retry-policy';

function error(
  category: ClockClassifiedError['category'],
  retryable = false,
): ClockClassifiedError {
  return { category, code: `clock_${category}`, message: 'x', retryable };
}

describe('isRetryEligible', () => {
  it('allows retry for 429 (rate_limited) regardless of method', () => {
    expect(isRetryEligible({ error: error('rate_limited'), method: 'POST' })).toBe(true);
  });

  it('allows retry for provider_unavailable regardless of method', () => {
    expect(isRetryEligible({ error: error('provider_unavailable'), method: 'POST' })).toBe(true);
  });

  it('allows retry for a safe network interruption', () => {
    expect(isRetryEligible({ error: error('network'), method: 'POST' })).toBe(true);
  });

  it('allows retry for a GET timeout', () => {
    expect(isRetryEligible({ error: error('timeout'), method: 'GET' })).toBe(true);
  });

  it('never retries a POST timeout — this is the exact booking-creation-timeout rule', () => {
    expect(isRetryEligible({ error: error('timeout'), method: 'POST' })).toBe(false);
  });

  it('never retries when explicitly marked an unconfirmed mutation, even if otherwise eligible', () => {
    expect(
      isRetryEligible({
        error: error('network'),
        method: 'POST',
        isUnconfirmedMutation: true,
      }),
    ).toBe(false);
  });

  it.each([
    'authentication',
    'authorization',
    'validation',
    'not_found',
    'conflict',
    'unknown_result',
    'schema_mismatch',
    'configuration',
    'permanent',
  ] as const)('never retries %s', (category) => {
    expect(isRetryEligible({ error: error(category), method: 'GET' })).toBe(false);
  });
});

describe('nextRetryDelayMs', () => {
  it('grows the delay ceiling exponentially with attempt number, capped at maxDelayMs', () => {
    const delays = [1, 2, 3, 4, 10].map((attempt) =>
      nextRetryDelayMs({ attempt, baseDelayMs: 100, maxDelayMs: 1000 }),
    );
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1000);
    }
  });

  it('never exceeds maxDelayMs even at a high attempt count', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(
        nextRetryDelayMs({ attempt: 50, baseDelayMs: 250, maxDelayMs: 8000 }),
      ).toBeLessThanOrEqual(8000);
    }
  });
});
