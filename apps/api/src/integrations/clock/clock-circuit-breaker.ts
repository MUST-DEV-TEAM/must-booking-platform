import { Injectable } from '@nestjs/common';

import { reportOperationalFailure } from '../../observability/error-tracking';

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
      this.alertOpened(breaker.consecutiveFailures + 1);
      return;
    }
    const consecutiveFailures = breaker.consecutiveFailures + 1;
    if (consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.breakers.set(key, { state: 'OPEN', consecutiveFailures, openedAt: Date.now() });
      this.alertOpened(consecutiveFailures);
      return;
    }
    this.breakers.set(key, { state: 'CLOSED', consecutiveFailures, openedAt: null });
  }

  stateOf(key: string): CircuitState {
    return this.record(key).state;
  }

  /** Fires exactly once per opening — assertClosed() throws before any real
   * attempt while already OPEN, so recordFailure() is never called again
   * until a trial (HALF_OPEN) call happens. Covers Clock certification gap
   * Task B's remaining alert case (docs/CLOCK_CERTIFICATION_GAPS_PLAN.md):
   * repeated auth/5xx failures against Clock, including a real 429 that
   * slips past the self-imposed rate-limit ceiling. No tenant/apiUser
   * identifier in the alert — this service is intentionally tenant-agnostic
   * (one breaker per Clock API user, not per tenant) and never sees a
   * tenantId to attach. */
  private alertOpened(consecutiveFailures: number): void {
    reportOperationalFailure(
      new Error(`Clock circuit breaker opened after ${consecutiveFailures} consecutive failures.`),
      { component: 'clock', operation: 'circuit-breaker-opened' },
    );
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
