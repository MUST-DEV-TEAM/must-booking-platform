/**
 * The Settings menu: groups, tabs and where old links land. One source for the side menu, the
 * page titles and the redirects (settings redesign plan, "Menu").
 */
export const settingsGroups = [
  { key: 'start', label: 'Start' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'booking', label: 'Booking' },
  { key: 'payments', label: 'Payments' },
  { key: 'connections', label: 'Connections' },
  { key: 'communication', label: 'Communication' },
  { key: 'account', label: 'Account', note: 'Applies to all your hotels' },
] as const;

export type SettingsGroup = (typeof settingsGroups)[number]['key'];

type TabDefinition = {
  key: string;
  group: SettingsGroup;
  label: string;
  description: string;
  /** False until the tab has a page; hidden tabs are never shown empty. */
  available: boolean;
};

export const settingsTabs = [
  {
    key: 'overview',
    group: 'start',
    label: 'Overview',
    description: 'Everything that controls how this hotel takes bookings.',
    available: true,
  },
  {
    key: 'profile',
    group: 'hotel',
    label: 'Profile',
    description: 'Hotel name, location, languages, currency and formats.',
    available: true,
  },
  {
    key: 'contact-brand',
    group: 'hotel',
    label: 'Contact and brand',
    description: 'How guests reach the hotel, and the logo and colours they see.',
    available: true,
  },
  {
    key: 'booking-rules',
    group: 'booking',
    label: 'Booking rules',
    description: 'Stay limits, booking window and how guests choose rooms.',
    available: true,
  },
  {
    key: 'policies',
    group: 'booking',
    label: 'Policies',
    description: 'Check-in and check-out, cancellation and house rules.',
    available: true,
  },
  {
    key: 'taxes-fees',
    group: 'booking',
    label: 'Taxes and fees',
    description: 'VAT, city tax and fees, and how prices are shown to guests.',
    available: false,
  },
  {
    key: 'payment-methods',
    group: 'payments',
    label: 'Payment methods',
    description: 'How guests can pay, and how long a room is held while they pay.',
    available: true,
  },
  {
    key: 'integrations',
    group: 'connections',
    label: 'Integrations',
    description: 'Property system, payments, email and website connections.',
    available: true,
  },
  {
    key: 'emails',
    group: 'communication',
    label: 'Emails',
    description: 'What guests and staff receive, the wording, and every email sent.',
    available: true,
  },
  {
    key: 'team',
    group: 'account',
    label: 'Team and roles',
    description: 'Who can sign in, and what each role may do.',
    available: true,
  },
  {
    key: 'plan-usage',
    group: 'account',
    label: 'Plan and usage',
    description: 'Your plan and how much of it is in use.',
    available: true,
  },
  {
    key: 'audit-log',
    group: 'account',
    label: 'Audit log',
    description: 'Every change made in this hotel, by whom and when.',
    available: true,
  },
] as const satisfies readonly TabDefinition[];

export type SettingsTab = (typeof settingsTabs)[number]['key'];

/** Old `settingsArea` values from saved links and bookmarks, and the tab each one opens now. */
export const legacySettingsAreas: Readonly<Record<string, SettingsTab>> = {
  general: 'profile',
  branding: 'contact-brand',
  'check-in-out': 'policies',
  payments: 'payment-methods',
  'managed-pages': 'integrations',
  email: 'emails',
  billing: 'plan-usage',
};

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return settingsTabs.some((tab) => tab.key === value && tab.available);
}

/** The tab a `settingsArea` value opens; no value opens the overview, an unknown value too. */
export function resolveSettingsTab(value: string | null | undefined): SettingsTab {
  if (!value) return 'overview';
  if (isSettingsTab(value)) return value;
  return legacySettingsAreas[value] ?? 'overview';
}

export function settingsTab(key: SettingsTab) {
  return settingsTabs.find((tab) => tab.key === key)!;
}

export function settingsTabHref(tenantId: string, propertyId: string, tab: SettingsTab) {
  const base = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=settings`;
  return tab === 'overview' ? base : `${base}&settingsArea=${tab}`;
}
