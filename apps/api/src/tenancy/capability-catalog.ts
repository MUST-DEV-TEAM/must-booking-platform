/**
 * Every permission a hotel role or a person can hold, in the order the dashboard shows them.
 * `area.action` keys; the API checks these on each protected route.
 */
export type CatalogEntry = { group: string; key: string; label: string; description: string };

export const CAPABILITY_CATALOG: readonly CatalogEntry[] = [
  { group: 'Requests', key: 'requests.review', label: 'Review requests', description: 'Approve or reject cancellation exceptions.' },
  { group: 'Bookings', key: 'bookings.view', label: 'View bookings', description: 'See reservations, their details and history.' },
  { group: 'Bookings', key: 'bookings.create', label: 'Create bookings', description: 'Add reservations for guests.' },
  { group: 'Bookings', key: 'bookings.edit', label: 'Edit bookings', description: 'Change reservation details and resend payment links.' },
  { group: 'Bookings', key: 'bookings.cancel', label: 'Cancel bookings', description: 'Cancel reservations.' },
  { group: 'Calendar', key: 'calendar.view', label: 'View the calendar', description: 'See the reservations calendar and availability.' },
  { group: 'Calendar', key: 'calendar.block', label: 'Block availability', description: 'Take rooms out of sale and remove blocks.' },
  { group: 'Guests', key: 'guests.view', label: 'View guests', description: 'See guest profiles and their history.' },
  { group: 'Guests', key: 'guests.merge', label: 'Merge guests', description: 'Review and merge duplicate guest profiles.' },
  { group: 'Payments', key: 'payments.view', label: 'View payments', description: 'See payments, refunds and payment history.' },
  { group: 'Payments', key: 'payments.record', label: 'Record payments', description: 'Mark a booking as paid at the hotel.' },
  { group: 'Payments', key: 'payments.refund', label: 'Refund payments', description: 'Refund money to guests.' },
  { group: 'Accommodations', key: 'accommodations.manage', label: 'Manage accommodations', description: 'Add and change room types and rooms.' },
  { group: 'Accommodations', key: 'photos.manage', label: 'Manage photos', description: 'Upload and organise room and hotel photos.' },
  { group: 'Rates', key: 'rates.manage', label: 'Manage rates', description: 'Change rate plans and prices.' },
  { group: 'Reports', key: 'reports.view', label: 'View reports', description: 'See reports and figures.' },
  { group: 'Settings', key: 'settings.manage', label: 'Manage settings', description: 'Manage hotel emails, notifications and review links.' },
  { group: 'Staff', key: 'staff.view', label: 'View staff', description: 'See who works at the hotel and what they can do.' },
  { group: 'Staff', key: 'staff.create', label: 'Add staff', description: 'Create staff accounts and send invitations.' },
  { group: 'Staff', key: 'staff.manage_roles', label: 'Manage roles', description: 'Create, change and delete custom roles.' },
  { group: 'Staff', key: 'staff.manage_permissions', label: 'Manage permissions', description: 'Change a person’s role and extra permissions.' },
  { group: 'Staff', key: 'staff.suspend', label: 'Suspend staff', description: 'Suspend and reactivate staff access.' },
] as const;

export const CAPABILITY_KEYS: readonly string[] = CAPABILITY_CATALOG.map((entry) => entry.key);

const keysOf = (...groups: string[]) =>
  CAPABILITY_CATALOG.filter((entry) => groups.includes(entry.group)).map((entry) => entry.key);

/** What each built-in role gets in a new hotel. */
export const BUILT_IN_ROLES: ReadonlyArray<{ name: string; description: string; capabilities: readonly string[] }> = [
  {
    name: 'Property Manager',
    description: 'Runs the hotel day to day: everything except changing who is an owner.',
    capabilities: CAPABILITY_KEYS,
  },
  {
    name: 'Front Desk',
    description: 'Handles bookings, the calendar and guests at reception.',
    capabilities: [
      'bookings.view',
      'bookings.create',
      'bookings.edit',
      'bookings.cancel',
      'calendar.view',
      'guests.view',
      'guests.merge',
      'payments.record',
    ],
  },
  {
    name: 'Finance',
    description: 'Sees payments and reports and can refund.',
    capabilities: ['payments.view', 'payments.refund', 'reports.view', 'bookings.view'],
  },
];

export { keysOf };
