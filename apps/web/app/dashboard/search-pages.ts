/** Pages, settings and quick actions that the search can open, with the words people may type for them. */
export type SearchPage = {
  label: string;
  kind: 'Page' | 'Setting' | 'Action';
  hint: string;
  /** Dashboard section the link opens; the person must be allowed to open it. */
  section: string;
  /** Extra URL parameters, without a leading &. */
  extra?: string;
  /** Capability needed on top of the section being openable. */
  requires?: string;
  keywords: string[];
};

export const SEARCH_PAGES: readonly SearchPage[] = [
  {
    label: 'Overview',
    kind: 'Page',
    hint: 'Today at a glance',
    section: 'overview',
    keywords: ['home', 'dashboard', 'today', 'arrivals', 'departures'],
  },
  {
    label: 'Needs attention',
    kind: 'Page',
    hint: 'Bookings that need a person',
    section: 'overview',
    requires: 'bookings.view',
    extra: 'tab=needs-attention',
    keywords: ['problems', 'failed', 'review', 'issues', 'alerts'],
  },
  {
    label: 'System health',
    kind: 'Page',
    hint: 'Live status of this hotel',
    section: 'overview',
    requires: 'bookings.view',
    extra: 'tab=system-health',
    keywords: ['status', 'sync', 'errors', 'monitoring'],
  },
  {
    label: 'Reservations',
    kind: 'Page',
    hint: 'All bookings',
    section: 'reservations',
    requires: 'bookings.view',
    keywords: ['bookings', 'booking', 'reservation', 'guests staying'],
  },
  {
    label: 'New booking',
    kind: 'Action',
    hint: 'Create a reservation',
    section: 'overview',
    extra: 'tab=quick-booking',
    requires: 'bookings.create',
    keywords: ['add reservation', 'walk-in', 'create booking', 'quick booking'],
  },
  {
    label: 'Calendar',
    kind: 'Page',
    hint: 'Reservations by room and day',
    section: 'calendar',
    requires: 'calendar.view',
    keywords: ['availability', 'timeline', 'block dates', 'tape chart'],
  },
  {
    label: 'Payments',
    kind: 'Page',
    hint: 'Payments, refunds and balances',
    section: 'payments',
    requires: 'payments.view',
    keywords: ['bill', 'invoice', 'refund', 'money', 'paid', 'balance', 'card', 'receipt'],
  },
  {
    label: 'Guests',
    kind: 'Page',
    hint: 'Guest directory',
    section: 'guests',
    requires: 'guests.view',
    keywords: ['customers', 'contacts', 'duplicates', 'phone', 'email'],
  },
  {
    label: 'Accommodations',
    kind: 'Page',
    hint: 'Room types, rooms, photos, amenities',
    section: 'accommodations',
    keywords: [
      'rooms',
      'room types',
      'photos',
      'amenities',
      'categories',
      'house rules',
      'import rooms',
    ],
  },
  {
    label: 'Rates & Pricing',
    kind: 'Page',
    hint: 'Prices, plans, taxes and fees',
    section: 'rates-pricing',
    requires: 'rates.manage',
    keywords: ['price', 'rate plan', 'seasons', 'taxes', 'fees', 'vat', 'discount'],
  },
  {
    label: 'Inventory',
    kind: 'Page',
    hint: 'Stock, restrictions and blocks',
    section: 'inventory',
    requires: 'calendar.view',
    keywords: [
      'stock',
      'availability',
      'stop sell',
      'minimum stay',
      'closed to arrival',
      'blocks',
      'restrictions',
    ],
  },
  {
    label: 'Reports',
    kind: 'Page',
    hint: 'Occupancy, revenue and more',
    section: 'reports',
    requires: 'reports.view',
    keywords: ['occupancy', 'revenue', 'adr', 'revpar', 'statistics', 'export'],
  },
  {
    label: 'Staff',
    kind: 'Page',
    hint: 'People, roles and permissions',
    section: 'staff',
    requires: 'staff.view',
    keywords: ['users', 'team', 'roles', 'permissions', 'invite', 'access'],
  },
  {
    label: 'Emails',
    kind: 'Page',
    hint: 'Templates, delivery and sender',
    section: 'emails',
    requires: 'settings.manage',
    keywords: ['templates', 'delivery', 'sender', 'smtp', 'domain', 'notifications emails'],
  },
  {
    label: 'Notifications',
    kind: 'Page',
    hint: 'Your alerts',
    section: 'notifications',
    keywords: ['alerts', 'inbox', 'unread', 'tasks'],
  },
  {
    label: 'My account',
    kind: 'Page',
    hint: 'Your name and password',
    section: 'account',
    keywords: ['profile', 'password', 'change password', 'name'],
  },
  {
    label: 'Hotels',
    kind: 'Page',
    hint: 'Your hotels',
    section: 'hotels',
    requires: 'tenant.admin',
    keywords: ['properties', 'switch hotel'],
  },
  {
    label: 'Settings',
    kind: 'Page',
    hint: 'Hotel settings',
    section: 'settings',
    requires: 'tenant.admin',
    keywords: ['preferences', 'configuration'],
  },
  {
    label: 'General settings',
    kind: 'Setting',
    hint: 'Hotel name, address, time zone',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=general',
    keywords: ['hotel name', 'address', 'time zone', 'timezone', 'currency', 'contact'],
  },
  {
    label: 'Booking rules',
    kind: 'Setting',
    hint: 'Check-in time, minimum stay, same-day cutoff',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=booking-rules',
    keywords: [
      'check-in time',
      'check-out time',
      'minimum stay',
      'maximum stay',
      'same day',
      'cutoff',
      'booking mode',
      'advance booking',
    ],
  },
  {
    label: 'Payment settings',
    kind: 'Setting',
    hint: 'Card, pay at hotel, gateways',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=payments',
    keywords: [
      'stripe',
      'pokpay',
      'pay at hotel',
      'gateway',
      'payment methods',
      'cancellation policy',
    ],
  },
  {
    label: 'Branding',
    kind: 'Setting',
    hint: 'Logo and appearance',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=branding',
    keywords: ['logo', 'colours', 'colors', 'theme', 'website look'],
  },
  {
    label: 'Email settings',
    kind: 'Setting',
    hint: 'Who gets which emails',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=email',
    keywords: ['recipients', 'sender name', 'reply-to', 'mute emails'],
  },
  {
    label: 'Website connection',
    kind: 'Setting',
    hint: 'Connect the hotel website',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=managed-pages',
    keywords: ['wordpress', 'plugin', 'connection code', 'managed pages', 'website'],
  },
  {
    label: 'Billing account',
    kind: 'Setting',
    hint: 'Plan and invoices',
    section: 'settings',
    requires: 'tenant.admin',
    extra: 'settingsArea=billing',
    keywords: ['plan', 'subscription', 'invoices'],
  },
] as const;

const norm = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Pages the person may open whose name or keywords start with, or contain, what they typed. */
export function matchPages(
  query: string,
  canOpen: (section: string) => boolean,
  can: (capability: string) => boolean,
  limit = 6,
): SearchPage[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const score = (page: SearchPage): number => {
    const label = norm(page.label);
    if (label === q) return 0;
    if (label.startsWith(q)) return 1;
    if (label.split(/\s+/).some((word) => word.startsWith(q))) return 2;
    if (page.keywords.some((word) => norm(word).startsWith(q))) return 3;
    // Looser "contains" matching only for longer text, so "vat" does not match "reservations".
    if (
      q.length >= 4 &&
      (label.includes(q) || page.keywords.some((word) => norm(word).includes(q)))
    )
      return 4;
    return 99;
  };
  return SEARCH_PAGES.filter(
    (page) => canOpen(page.section) && (!page.requires || can(page.requires)),
  )
    .map((page) => ({ page, rank: score(page) }))
    .filter((entry) => entry.rank < 99)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.page);
}

/** What to show before anything is typed. */
export function quickLinks(
  canOpen: (section: string) => boolean,
  can: (capability: string) => boolean,
): SearchPage[] {
  const wanted = ['New booking', 'Needs attention', 'Calendar', 'Payments', 'Guests', 'Reports'];
  return wanted
    .map((label) => SEARCH_PAGES.find((page) => page.label === label)!)
    .filter((page) => canOpen(page.section) && (!page.requires || can(page.requires)))
    .slice(0, 5);
}
