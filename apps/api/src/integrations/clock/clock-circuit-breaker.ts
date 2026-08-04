import { Injectable } from '@nestjs/common';

// Source brief section 9 requires a circuit breaker; it doesn't specify
// thresholds, so these are reasonable, documented defaults (ASSUMPTION),
// not derived from anything Clock-specific. One breaker per key (API user)
// so one tenant's failing connection can't trip calls for another tenant.
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface BreakerRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
}

export class CircuitOpenError extends Error {
  constructor(retryAfterMs: number) {
    super(`Clock circuit breaker is open after repeated failures; retry after ${retryAfterMs}ms.`);
    this.name = 'CircuitOpenError';
  }
}

@Injectable()
export class ClockCircuitBreakerService {
  private readonly breakers = new Map<string, BreakerRecord>();

  /** Throws CircuitOpenError if calls for this key are currently blocked. */
  assertClosed(key: string): void {
    const breaker = this.record(key);
    if (breaker.state !== 'OPEN') return;

    const elapsed = Date.now() - (breaker.openedAt ?? 0);
    if (elapsed < CIRCUIT_BREAKER_COOLDOWN_MS) {
      throw new CircuitOpenError(CIRCUIT_BREAKER_COOLDOWN_MS - elapsed);
    }
    // Cooldown elapsed: allow exactly one trial call through (HALF_OPEN).
    breaker.state = 'HALF_OPEN';
  }

  recordSuccess(key: string): void {
    this.breakers.set(key, { state: 'CLOSED', consecutiveFailures: 0, openedAt: null });
  }

  recordFailure(key: string): void {
    const breaker = this.record(key);
    if (breaker.state === 'HALF_OPEN') {
      // The trial call failed — re-open immediately, reset the cooldown clock.
      this.breakers.set(key, {
        state: 'OPEN',
        consecutiveFailures: breaker.consecutiveFailures + 1,
        openedAt: Date.now(),
      });
      return;
    }
    const consecutiveFailures = breaker.consecutiveFailures + 1;
    if (consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.breakers.set(key, { state: 'OPEN', consecutiveFailures, openedAt: Date.now() });
      return;
    }
    this.breakers.set(key, { state: 'CLOSED', consecutiveFailures, openedAt: null });
  }

  stateOf(key: string): CircuitState {
    return this.record(key).state;
  }

  private record(key: string): BreakerRecord {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = { state: 'CLOSED', consecutiveFailures: 0, openedAt: null };
      this.breakers.set(key, breaker);
    }
    return breaker;
  }
}
