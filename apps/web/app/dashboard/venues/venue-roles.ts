import type { VenueRole } from './venue-api';

/** How the two restaurant roles are shown to people. The stored values stay MANAGER and HOST. */
export const VENUE_ROLE_LABEL: Record<VenueRole, string> = {
  MANAGER: 'Restaurant Manager',
  HOST: 'Waiter',
};

export const VENUE_ROLE_OPTIONS: ReadonlyArray<{ value: VenueRole; label: string; hint: string }> =
  [
    {
      value: 'HOST',
      label: 'Waiter',
      hint: 'Sees the restaurant, its bookings and the floor plan',
    },
    {
      value: 'MANAGER',
      label: 'Restaurant Manager',
      hint: 'Also sets up tables, opening hours and staff',
    },
  ];
