import { describe, expect, it } from 'vitest';

import { cleanStayNote, isEarlyDeparture, stayStatusProblem } from './booking-stay-status';

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

describe('departure day and notes', () => {
  it('refuses a check-in on or after the departure day, but not a late arrival inside the stay', () => {
    const stay = {
      from: 'expected' as const,
      to: 'checked_in' as const,
      startsOn: '2027-07-10',
      endsOn: '2027-07-13',
    };
    expect(stayStatusProblem({ ...stay, today: '2027-07-12' })).toBeNull();
    expect(stayStatusProblem({ ...stay, today: '2027-07-13' })).toMatch(/departure day/);
    expect(stayStatusProblem({ ...stay, today: '2027-07-20' })).toMatch(/departure day/);
  });

  it('still allows checking out and undoing after the departure day', () => {
    const late = { startsOn: '2027-07-10', endsOn: '2027-07-13', today: '2027-07-15' };
    expect(stayStatusProblem({ ...late, from: 'checked_in', to: 'checked_out' })).toBeNull();
    expect(stayStatusProblem({ ...late, from: 'checked_in', to: 'expected' })).toBeNull();
  });

  it('calls a check-out before the booked departure day early', () => {
    expect(isEarlyDeparture({ endsOn: '2027-07-13', today: '2027-07-12' })).toBe(true);
    expect(isEarlyDeparture({ endsOn: '2027-07-13', today: '2027-07-13' })).toBe(false);
    expect(isEarlyDeparture({ endsOn: '2027-07-13', today: '2027-07-14' })).toBe(false);
  });

  it('cleans a staff note', () => {
    expect(cleanStayNote('  Paid in cash at the desk  ')).toBe('Paid in cash at the desk');
    expect(cleanStayNote('   ')).toBeNull();
    expect(cleanStayNote(42)).toBeNull();
    expect(cleanStayNote('x'.repeat(900))).toHaveLength(500);
  });
});
