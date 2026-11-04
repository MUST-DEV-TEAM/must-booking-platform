import type { CatalogEntry } from './capability-catalog';

/**
 * Every permission on a restaurant venue, in the order the dashboard shows them.
 * Stage 1 has two fixed venue roles; workspace owners and admins hold every key.
 */
export const VENUE_CAPABILITY_CATALOG: readonly CatalogEntry[] = [
  {
    group: 'Restaurant',
    key: 'venue.view',
    label: 'View the restaurant',
    description: 'See the restaurant, its areas, tables and floor map.',
  },
  {
    group: 'Restaurant',
    key: 'venue.manage',
    label: 'Set up the restaurant',
    description: 'Change the restaurant details, areas, tables and floor map.',
  },
  {
    group: 'Restaurant',
    key: 'venue.staff',
    label: 'Manage restaurant staff',
    description: 'Give people access to the restaurant and suspend them.',
  },
  {
    group: 'Reservations',
    key: 'reservations.view',
    label: 'View table reservations',
    description: 'See table reservations and their details.',
  },
  {
    group: 'Reservations',
    key: 'reservations.manage',
    label: 'Manage table reservations',
    description: 'Create, change and cancel table reservations.',
  },
];

export type VenueRole = 'MANAGER' | 'HOST';

const ALL_VENUE_CAPABILITIES = VENUE_CAPABILITY_CATALOG.map((entry) => entry.key);

export const VENUE_ROLE_CAPABILITIES: Record<VenueRole, string[]> = {
  MANAGER: [...ALL_VENUE_CAPABILITIES],
  HOST: ['venue.view', 'reservations.view', 'reservations.manage'],
};
