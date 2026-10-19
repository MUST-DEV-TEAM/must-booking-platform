import { describe, expect, it } from 'vitest';

import {
  LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  blocksHotelLogin,
  canTransition,
  hotelDashboardAccess,
  needsDangerousPermission,
  publicBookingAllowed,
} from './hotel-lifecycle';

describe('hotel lifecycle rules', () => {
  it('only allows the documented transitions', () => {
    const allowed = LIFECYCLE_STATES.flatMap((from) =>
      LIFECYCLE_TRANSITIONS[from].map((to) => `${from}>${to}`),
    ).sort();
    expect(allowed).toEqual(
      [
        'TRIAL>ACTIVE',
        'TRIAL>PAST_DUE',
        'TRIAL>SUSPENDED',
        'TRIAL>CANCELLED',
        'ACTIVE>PAST_DUE',
        'ACTIVE>SUSPENDED',
        'ACTIVE>CANCELLED',
        'PAST_DUE>ACTIVE',
        'PAST_DUE>SUSPENDED',
        'PAST_DUE>CANCELLED',
        'SUSPENDED>ACTIVE',
        'SUSPENDED>CANCELLED',
        'CANCELLED>ARCHIVED',
        'CANCELLED>ACTIVE',
      ].sort(),
    );
    expect(canTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(canTransition('ACTIVE', 'ACTIVE')).toBe(false);
    expect(canTransition('ACTIVE', 'TRIAL')).toBe(false);
  });

  it('marks cancel, archive and reinstating a cancelled hotel as dangerous', () => {
    expect(needsDangerousPermission('ACTIVE', 'CANCELLED')).toBe(true);
    expect(needsDangerousPermission('CANCELLED', 'ARCHIVED')).toBe(true);
    expect(needsDangerousPermission('CANCELLED', 'ACTIVE')).toBe(true);
    expect(needsDangerousPermission('ACTIVE', 'SUSPENDED')).toBe(false);
    expect(needsDangerousPermission('SUSPENDED', 'ACTIVE')).toBe(false);
  });

  it('defines what each state does to the hotel dashboard, logins and public booking', () => {
    const table = LIFECYCLE_STATES.map((state) => ({
      state,
      read: hotelDashboardAccess(state, 'GET'),
      write: hotelDashboardAccess(state, 'POST'),
      login: blocksHotelLogin(state),
      publicBooking: publicBookingAllowed(state),
    }));
    expect(table).toEqual([
      { state: 'TRIAL', read: 'allowed', write: 'allowed', login: false, publicBooking: true },
      { state: 'ACTIVE', read: 'allowed', write: 'allowed', login: false, publicBooking: true },
      { state: 'PAST_DUE', read: 'allowed', write: 'allowed', login: false, publicBooking: true },
      { state: 'SUSPENDED', read: 'blocked', write: 'blocked', login: true, publicBooking: false },
      { state: 'CANCELLED', read: 'blocked', write: 'blocked', login: true, publicBooking: false },
      {
        state: 'ARCHIVED',
        read: 'allowed',
        write: 'read_only',
        login: false,
        publicBooking: false,
      },
    ]);
  });
});
