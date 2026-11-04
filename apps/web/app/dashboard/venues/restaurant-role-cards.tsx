import type { PermissionCatalogItem } from '../../../components/ui/permission-list';
import type { VenueRole } from './venue-api';
import { VENUE_ROLE_OPTIONS } from './venue-roles';

/** What the API grants each fixed restaurant role (mirrors venue-capability-catalog on the API). */
export const RESTAURANT_PERMISSION_CATALOG: PermissionCatalogItem[] = [
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

const ROLE_CAPABILITIES: Record<VenueRole, string[]> = {
  MANAGER: RESTAURANT_PERMISSION_CATALOG.map((item) => item.key),
  HOST: ['venue.view', 'reservations.view', 'reservations.manage'],
};

export type RestaurantRoleRow = {
  value: VenueRole;
  name: string;
  description: string;
  capabilities: string[];
};

/** The two fixed restaurant roles, shaped like the hotel's built-in roles so they list alongside them. */
export const RESTAURANT_ROLE_ROWS: RestaurantRoleRow[] = VENUE_ROLE_OPTIONS.map((role) => ({
  value: role.value,
  name: role.label,
  description: `${role.hint}. Access is limited to the assigned restaurant.`,
  capabilities: ROLE_CAPABILITIES[role.value],
}));
