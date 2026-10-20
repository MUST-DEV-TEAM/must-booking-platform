/**
 * Overview by permission: every widget needs a permission, and a role's "Overview type" only
 * chooses which of the permitted widgets to show. A type can never reveal a widget the person
 * is not allowed to see.
 */
export const OVERVIEW_TYPES = [
  'auto',
  'owner_manager',
  'front_desk',
  'finance',
  'reservations',
  'minimal',
] as const;
export type OverviewType = (typeof OVERVIEW_TYPES)[number];
export type ResolvedOverviewType = Exclude<OverviewType, 'auto'>;

export const OVERVIEW_TYPE_LABELS: Record<OverviewType, string> = {
  auto: 'Automatic (from permissions)',
  owner_manager: 'Owner / Manager',
  front_desk: 'Front desk',
  finance: 'Finance',
  reservations: 'Reservations',
  minimal: 'Minimal',
};

export type WidgetKey =
  | 'tile.arrivals'
  | 'tile.departures'
  | 'tile.inHouse'
  | 'tile.occupancy'
  | 'tile.needsAttention'
  | 'tile.dueAtDesk'
  | 'tile.collectedToday'
  | 'tile.newBookings'
  | 'list.arrivals'
  | 'list.departures'
  | 'list.needsAttention'
  | 'list.upcomingArrivals'
  | 'list.soldOut'
  | 'list.cancellations'
  | 'list.activity'
  | 'panel.myTasks';

/** Capabilities that must ALL be held; an empty list means everyone. */
export const WIDGET_PERMISSIONS: Record<WidgetKey, readonly string[]> = {
  'tile.arrivals': ['bookings.view'],
  'tile.departures': ['bookings.view'],
  'tile.inHouse': ['bookings.view'],
  'tile.occupancy': ['calendar.view'],
  'tile.needsAttention': ['bookings.view'],
  'tile.dueAtDesk': ['bookings.view', 'payments.view'],
  'tile.collectedToday': ['payments.view'],
  'tile.newBookings': ['bookings.view'],
  'list.arrivals': ['bookings.view'],
  'list.departures': ['bookings.view'],
  'list.needsAttention': ['bookings.view'],
  'list.upcomingArrivals': ['bookings.view'],
  'list.soldOut': ['calendar.view'],
  'list.cancellations': ['bookings.view'],
  'list.activity': ['bookings.view'],
  'panel.myTasks': [],
};

const ALL_WIDGETS = Object.keys(WIDGET_PERMISSIONS) as WidgetKey[];

const PRESETS: Record<ResolvedOverviewType, readonly WidgetKey[]> = {
  owner_manager: ALL_WIDGETS,
  front_desk: [
    'tile.arrivals',
    'tile.departures',
    'tile.inHouse',
    'tile.needsAttention',
    'tile.dueAtDesk',
    'list.arrivals',
    'list.departures',
    'list.needsAttention',
    'list.upcomingArrivals',
    'list.soldOut',
    'panel.myTasks',
  ],
  finance: [
    'tile.collectedToday',
    'tile.dueAtDesk',
    'tile.needsAttention',
    'list.cancellations',
    'list.activity',
    'panel.myTasks',
  ],
  reservations: [
    'tile.newBookings',
    'tile.arrivals',
    'tile.needsAttention',
    'list.upcomingArrivals',
    'list.cancellations',
    'list.needsAttention',
    'panel.myTasks',
  ],
  minimal: ['tile.arrivals', 'tile.departures', 'panel.myTasks'],
};

/** Names of the built-in role templates. Custom roles use their stored type. */
const BUILT_IN_TYPES: Record<string, ResolvedOverviewType> = {
  'Property Manager': 'owner_manager',
  'Front Desk': 'front_desk',
  Finance: 'finance',
};

/** First match wins. */
export function autoOverviewType(capabilities: readonly string[]): ResolvedOverviewType {
  const has = (key: string) => capabilities.includes(key);
  if (has('payments.view') && (has('reports.view') || has('staff.view'))) return 'owner_manager';
  if (has('payments.view') && !has('bookings.create')) return 'finance';
  if ((has('bookings.create') || has('bookings.edit')) && has('calendar.view')) return 'front_desk';
  if (has('bookings.create')) return 'reservations';
  return 'minimal';
}

export function resolveOverviewType(input: {
  tenantRole: 'OWNER' | 'ADMIN' | 'STAFF';
  roleName?: string | null;
  roleKind?: 'BUILT_IN' | 'CUSTOM' | null;
  storedType?: string | null;
  capabilities: readonly string[];
}): ResolvedOverviewType {
  if (input.tenantRole !== 'STAFF') return 'owner_manager';
  if (input.roleKind === 'BUILT_IN' && input.roleName && BUILT_IN_TYPES[input.roleName])
    return BUILT_IN_TYPES[input.roleName]!;
  const stored = (OVERVIEW_TYPES as readonly string[]).includes(input.storedType ?? '')
    ? (input.storedType as OverviewType)
    : 'auto';
  return stored === 'auto' ? autoOverviewType(input.capabilities) : stored;
}

/** Widgets of the type that the person is also allowed to see, in display order. */
export function visibleWidgets(
  type: ResolvedOverviewType,
  capabilities: readonly string[],
  context: { source: 'LOCAL' | 'CLOCK' } = { source: 'LOCAL' },
): WidgetKey[] {
  return PRESETS[type].filter(
    (key) =>
      WIDGET_PERMISSIONS[key].every((capability) => capabilities.includes(capability)) &&
      // MUST does not know Clock's room supply, so "sold out" is only shown for MUST-source hotels.
      !(key === 'list.soldOut' && context.source === 'CLOCK'),
  );
}

export function widgetsForPreview(type: OverviewType, capabilities: readonly string[]) {
  const resolved = type === 'auto' ? autoOverviewType(capabilities) : type;
  const shown = visibleWidgets(resolved, capabilities);
  const hidden = PRESETS[resolved].filter((key) => !shown.includes(key));
  return { resolved, shown, hidden };
}
