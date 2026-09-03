import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reportOperationalFailure } = vi.hoisted(() => ({ reportOperationalFailure: vi.fn() }));
vi.mock('../../observability/error-tracking', () => ({ reportOperationalFailure }));

import {
  CIRCUIT_BREAKER_COOLDOWN_MS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CircuitOpenError,
  ClockCircuitBreakerService,
} from './clock-circuit-breaker';

describe('ClockCircuitBreakerService', () => {
  let breaker: ClockCircuitBreakerService;

  beforeEach(() => {
    breaker = new ClockCircuitBreakerService();
    vi.useFakeTimers();
    reportOperationalFailure.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and allows calls through', () => {
    expect(breaker.stateOf('user-a')).toBe('CLOSED');
    expect(() => breaker.assertClosed('user-a')).not.toThrow();
  });

  it('opens after the failure threshold is reached', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i += 1)
      breaker.recordFailure('user-a');
    expect(breaker.stateOf('user-a')).toBe('CLOSED');

    breaker.recordFailure('user-a');
    expect(breaker.stateOf('user-a')).toBe('OPEN');
    expect(() => breaker.assertClosed('user-a')).toThrow(CircuitOpenError);
  });

  it('resets the failure count on success', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i += 1)
      breaker.recordFailure('user-a');
    breaker.recordSuccess('user-a');
    breaker.recordFailure('user-a');
    expect(breaker.stateOf('user-a')).toBe('CLOSED');
  });

  it('moves to half-open after the cooldown and allows exactly one trial call', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) breaker.recordFailure('user-a');
    expect(breaker.stateOf('user-a')).toBe('OPEN');

    vi.advanceTimersByTime(CIRCUIT_BREAKER_COOLDOWN_MS + 1);
    expect(() => breaker.assertClosed('user-a')).not.toThrow();
    expect(breaker.stateOf('user-a')).toBe('HALF_OPEN');
  });

  it('re-opens immediately if the half-open trial call fails', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) breaker.recordFailure('user-a');
    vi.advanceTimersByTime(CIRCUIT_BREAKER_COOLDOWN_MS + 1);
    breaker.assertClosed('user-a');
    expect(breaker.stateOf('user-a')).toBe('HALF_OPEN');

    breaker.recordFailure('user-a');
    expect(breaker.stateOf('user-a')).toBe('OPEN');
  });

  it('closes if the half-open trial call succeeds', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) breaker.recordFailure('user-a');
    vi.advanceTimersByTime(CIRCUIT_BREAKER_COOLDOWN_MS + 1);
    breaker.assertClosed('user-a');

    breaker.recordSuccess('user-a');
    expect(breaker.stateOf('user-a')).toBe('CLOSED');
  });

  it('alerts exactly once when the breaker opens, not on every failure leading up to it', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i += 1)
      breaker.recordFailure('user-a');
    expect(reportOperationalFailure).not.toHaveBeenCalled();

    breaker.recordFailure('user-a');
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    const [, context] = reportOperationalFailure.mock.calls[0]!;
    expect(context).toEqual({ component: 'clock', operation: 'circuit-breaker-opened' });
  });

  it('alerts again when a half-open trial call fails and re-opens it', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) breaker.recordFailure('user-a');
    reportOperationalFailure.mockClear();
    vi.advanceTimersByTime(CIRCUIT_BREAKER_COOLDOWN_MS + 1);
    breaker.assertClosed('user-a');

    breaker.recordFailure('user-a');
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
  });

  it('keeps breakers independent per key', () => {
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i += 1) breaker.recordFailure('user-a');
    expect(breaker.stateOf('user-a')).toBe('OPEN');
    expect(breaker.stateOf('user-b')).toBe('CLOSED');
    expect(() => breaker.assertClosed('user-b')).not.toThrow();
  });
});
