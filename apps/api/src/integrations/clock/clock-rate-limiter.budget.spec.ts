import { describe, expect, it } from 'vitest';

import { clockBackgroundBudget } from './clock-rate-limiter';

describe('clockBackgroundBudget', () => {
  it('leaves two requests per second to guests and staff by day', () => {
    expect(clockBackgroundBudget(new Date('2026-10-26T09:00:00Z'))).toBe(2);
    expect(clockBackgroundBudget(new Date('2026-10-26T21:59:00Z'))).toBe(2);
    expect(clockBackgroundBudget(new Date('2026-10-26T04:00:00Z'))).toBe(2);
  });

  it('lets the import use one more overnight, when the hotel is quiet', () => {
    expect(clockBackgroundBudget(new Date('2026-10-26T22:00:00Z'))).toBe(3);
    expect(clockBackgroundBudget(new Date('2026-10-26T01:30:00Z'))).toBe(3);
    expect(clockBackgroundBudget(new Date('2026-10-26T03:59:00Z'))).toBe(3);
  });
});
