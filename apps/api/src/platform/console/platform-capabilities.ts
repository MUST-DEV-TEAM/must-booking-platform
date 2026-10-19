/**
 * Every platform-console permission. Routes under /platform-console check these keys and fail closed:
 * a route without a declared capability is denied. Built-in roles live in the platform_roles table
 * (seeded by migration 20261020000000); a test keeps this file and that seed identical.
 */
export type PlatformCapabilityEntry = {
  group: string;
  key: string;
  label: string;
  description: string;
};

export const PLATFORM_CAPABILITY_CATALOG: readonly PlatformCapabilityEntry[] = [
  {
    group: 'Hotels',
    key: 'platform.hotels.view',
    label: 'View hotels',
    description: 'See the hotel directory and hotel details.',
  },
  {
    group: 'Hotels',
    key: 'platform.hotels.create',
    label: 'Create hotels',
    description: 'Onboard a new hotel and invite its owner.',
  },
  {
    group: 'Hotels',
    key: 'platform.hotels.lifecycle',
    label: 'Change hotel status',
    description: 'Move a hotel between Trial, Active, Past due and Suspended.',
  },
  {
    group: 'Hotels',
    key: 'platform.hotels.dangerous',
    label: 'Cancel or archive hotels',
    description: 'Cancel, archive or reinstate a hotel.',
  },
  {
    group: 'Connections',
    key: 'platform.connections.view',
    label: 'View connections',
    description: 'See the status of PMS, payment, website and email connections.',
  },
  {
    group: 'Connections',
    key: 'platform.integrations.manage',
    label: 'Manage integrations',
    description: 'Operate hotel integrations (Phase 2).',
  },
  {
    group: 'Billing',
    key: 'platform.billing.view',
    label: 'View plans and billing',
    description: 'See plans, usage and invoices.',
  },
  {
    group: 'Billing',
    key: 'platform.billing.manage',
    label: 'Manage plans and billing',
    description: 'Change plans and billing (Milestone 15).',
  },
  {
    group: 'Support',
    key: 'platform.support.view_as',
    label: 'View a hotel as support',
    description: 'Open a hotel in read-only support mode.',
  },
  {
    group: 'Support',
    key: 'platform.support.act_as',
    label: 'Act on behalf of a hotel',
    description: 'Request approved, time-limited access that can make limited changes.',
  },
  {
    group: 'Support',
    key: 'platform.support.approve',
    label: 'Approve support access',
    description: 'Approve another team member’s act-as request.',
  },
  {
    group: 'Team',
    key: 'platform.team.view',
    label: 'View the team',
    description: 'See platform accounts and roles.',
  },
  {
    group: 'Team',
    key: 'platform.team.manage',
    label: 'Manage the team',
    description: 'Invite, create, suspend and change roles of platform accounts.',
  },
  {
    group: 'Audit',
    key: 'platform.audit.view',
    label: 'View the audit log',
    description: 'Search the platform audit log.',
  },
  {
    group: 'Audit',
    key: 'platform.audit.export',
    label: 'Export the audit log',
    description: 'Download the audit log as CSV.',
  },
] as const;

export const PLATFORM_CAPABILITY_KEYS: readonly string[] = PLATFORM_CAPABILITY_CATALOG.map(
  (entry) => entry.key,
);

export const BUILT_IN_PLATFORM_ROLES: ReadonlyArray<{
  key: string;
  name: string;
  capabilities: readonly string[];
}> = [
  { key: 'super_admin', name: 'Super admin', capabilities: PLATFORM_CAPABILITY_KEYS },
  {
    key: 'operations',
    name: 'Operations / support',
    capabilities: [
      'platform.hotels.view',
      'platform.hotels.create',
      'platform.hotels.lifecycle',
      'platform.connections.view',
      'platform.integrations.manage',
      'platform.support.view_as',
      'platform.support.act_as',
      'platform.support.approve',
      'platform.audit.view',
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    capabilities: [
      'platform.hotels.view',
      'platform.connections.view',
      'platform.billing.view',
      'platform.billing.manage',
    ],
  },
  {
    key: 'auditor',
    name: 'Read-only auditor',
    capabilities: [
      'platform.hotels.view',
      'platform.connections.view',
      'platform.billing.view',
      'platform.team.view',
      'platform.audit.view',
    ],
  },
];

/** Capabilities that act-as support sessions may use inside a hotel. Everything else is refused. */
export const ACT_AS_ALLOWED_HOTEL_CAPABILITIES: readonly string[] = [
  'bookings.view',
  'bookings.create',
  'bookings.edit',
  'bookings.cancel',
  'calendar.view',
  'calendar.block',
  'guests.view',
  'payments.view',
  'payments.record',
  'accommodations.manage',
  'rates.manage',
  'reports.view',
];
