import { describe, expect, it } from 'vitest';

import {
  FINANCIAL_ALERT_AFTER_FAILURES,
  financialRetryDelaySeconds,
  shouldAlertFinancialBlocked,
} from './clock-sync-backoff';

describe('financial retry schedule', () => {
  it('waits 1 minute, 5 minutes, 30 minutes, then 6 hours, and stays at 6 hours', () => {
    expect([0, 1, 2, 3, 4, 10, 1000].map(financialRetryDelaySeconds)).toEqual([
      60, 300, 1800, 21_600, 21_600, 21_600, 21_600,
    ]);
  });

  it('never waits less than a minute or returns nonsense for odd input', () => {
    expect(financialRetryDelaySeconds(-5)).toBe(60);
    expect(financialRetryDelaySeconds(1.9)).toBe(300);
    expect(financialRetryDelaySeconds(Number.NaN)).toBe(60);
  });

  it('raises the alert exactly once per streak, on the third failure', () => {
    const alerts = [1, 2, 3, 4, 5, 50].filter(shouldAlertFinancialBlocked);
    expect(alerts).toEqual([FINANCIAL_ALERT_AFTER_FAILURES]);
    expect(FINANCIAL_ALERT_AFTER_FAILURES).toBe(3);
  });
});
