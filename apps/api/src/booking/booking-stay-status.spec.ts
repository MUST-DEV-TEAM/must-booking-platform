import { describe, expect, it } from 'vitest';

import { stayStatusProblem } from './booking-stay-status';

const base = { startsOn: '2027-07-12', today: '2027-07-12' };

describe('stayStatusProblem', () => {
  it('allows the normal journey', () => {
    expect(stayStatusProblem({ ...base, from: 'expected', to: 'checked_in' })).toBeNull();
    expect(stayStatusProblem({ ...base, from: 'checked_in', to: 'checked_out' })).toBeNull();
    expect(stayStatusProblem({ ...base, from: 'expected', to: 'no_show' })).toBeNull();
  });

  it('allows undoing a mis-click', () => {
    expect(stayStatusProblem({ ...base, from: 'checked_in', to: 'expected' })).toBeNull();
    expect(stayStatusProblem({ ...base, from: 'no_show', to: 'expected' })).toBeNull();
    expect(stayStatusProblem({ ...base, from: 'checked_out', to: 'checked_in' })).toBeNull();
  });

  it('refuses jumps that make no sense', () => {
    expect(stayStatusProblem({ ...base, from: 'expected', to: 'checked_out' })).toMatch(/cannot/);
    expect(stayStatusProblem({ ...base, from: 'no_show', to: 'checked_in' })).toMatch(/cannot/);
  });

  it('refuses to check in or mark a no-show before the arrival day', () => {
    const early = { from: 'expected' as const, startsOn: '2027-07-20', today: '2027-07-12' };
    expect(stayStatusProblem({ ...early, to: 'checked_in' })).toMatch(/not come/);
    expect(stayStatusProblem({ ...early, to: 'no_show' })).toMatch(/not come/);
  });
});
