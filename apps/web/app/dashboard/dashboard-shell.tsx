'use client';

import {
  AppShell,
  Card,
  Heading,
  NavigationSectionTabBar,
  NavigationSectionTabItem,
  Stack,
  StatePanel,
  StatusBadge,
  Text,
  type NavigationItem,
} from '@must/ui';
import {
  CalendarDays,
  ClipboardList,
  CircleHelp,
  CreditCard,
  FileChartColumn,
  Hotel as IconHotel,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  Package as IconInventory,
  Settings,
  Tags,
  UserRound,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchSessionUser, type SessionUser } from '../auth-routing';
import styles from './dashboard-shell.module.css';
import { DashboardOverview, NeedsAttentionTab } from './overview';
import { DashboardCalendar } from './calendar';
import { WalkInBooking } from './walk-in-booking';
import { DashboardPayments } from './payments';
import { DashboardGuests } from './guests';
import { DashboardStaff } from './staff';
import { DashboardReservations } from './reservations';
import { DashboardSettings, isSettingsArea, SettingsHub, type SettingsArea } from './settings';
import { DashboardNotifications, NotificationsInbox } from './notifications';
import { DashboardReports } from './reports';
import { RoomManagement } from './[tenantId]/room-management';
import { RateManagement } from './[tenantId]/rate-management';
import { IntegrationsManagement } from './[tenantId]/integrations-management';
import { PropertyManagement } from './[tenantId]/property-management';

type TenantRole = 'OWNER' | 'ADMIN' | 'STAFF';
type Membership = { tenantId: string; role: TenantRole };
type BookingMode = 'ROOM_TYPE_ONLY' | 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
type PaymentGateways = { stripe: boolean; pokpay: boolean; payAtHotel: boolean };
type Property = {
  id: string;
  name: string;
  bookingMode?: BookingMode;
  paymentGateways?: PaymentGateways;
};

type PropertyOverview = {
  kpis: {
    arrivals: number;
    departures: number;
    inHouse: number;
    bookedRoomNights: number;
    availableRoomNights: number;
    occupancyRate: number | null;
  };
  needsAttention: unknown[];
};

type PropertySummary = { property: Property; overview: PropertyOverview | null };

const roleLabels: Record<TenantRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  STAFF: 'Staff',
};

type InitialDashboardData = {
  user: SessionUser | null;
  role: TenantRole;
  properties: Property[];
  capabilities?: string[];
};

type DashboardNavigationDefinition = {
  section: string;
  label: string;
  icon: NavigationItem['icon'];
  capabilities?: readonly string[];
};

const operationalNavigation = [
  { section: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  {
    section: 'reservations',
    label: 'Bookings',
    icon: ClipboardList,
    capabilities: ['bookings.manage'],
  },
  { section: 'calendar', label: 'Calendar', icon: CalendarDays, capabilities: ['calendar.view'] },
  { section: 'payments', label: 'Payments', icon: CreditCard, capabilities: ['payments.refund'] },
  { section: 'guests', label: 'Guests', icon: UserRound, capabilities: ['guests.manage'] },
] as const;

const managementNavigation = [
  // Accommodations/Rates & Pricing/Staff/Settings are owner/admin-only regardless of
  // capability -- see ownerAdminOnlySections below -- so they intentionally carry no
  // `capabilities` entry here.
  { section: 'accommodations', label: 'Accommodations', icon: IconHotel },
  { section: 'rates-pricing', label: 'Rates & Pricing', icon: Tags },
  { section: 'staff', label: 'Staff', icon: Users },
  { section: 'reports', label: 'Reports', icon: FileChartColumn, capabilities: ['reports.view'] },
  { section: 'settings', label: 'Settings', icon: Settings },
] as const;

const hotelNavigation = [
  { section: 'hotels', label: 'Hotels', icon: IconHotel },
  { section: 'inventory', label: 'Inventory', icon: IconInventory },
] as const;

const dashboardSections: readonly DashboardNavigationDefinition[] = [
  ...operationalNavigation.slice(0, 3),
  ...hotelNavigation,
  ...operationalNavigation.slice(3),
  ...managementNavigation,
];

const dashboardTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'needs-attention', label: 'Needs Attention' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'quick-booking', label: 'Quick Booking' },
  { key: 'system-health', label: 'System Health' },
] as const;

type DashboardTab = (typeof dashboardTabs)[number]['key'];
type UnavailableDashboardTab = Exclude<DashboardTab, 'overview' | 'quick-booking'>;

const unavailableDashboardTabCopy: Record<UnavailableDashboardTab, string> = {
  'needs-attention': 'Needs Attention will be available in a future dashboard update.',
  approvals:
    'Approvals will coordinate review and sign-off for bookings and other workflows; no approval workflow is configured yet.',
  'system-health':
    'System Health will summarize operational checks across booking, payments, PMS, notifications, processing, and security; those checks are not available yet.',
};

// Tenant-administration sections: never delegable to a STAFF-role user via a capability
// grant, regardless of what a custom template happens to include. Matches this milestone's
// established scoping (tasks 16/18/20/21) and the backend's unconditional @Roles(Owner, Admin)
// on every one of these sections' endpoints.
const ownerAdminOnlySections = new Set([
  'accommodations',
  'rates-pricing',
  'inventory',
  'staff',
  'settings',
]);

function canAccessSection(role: TenantRole, capabilities: readonly string[], section: string) {
  if (
    role !== 'STAFF' ||
    section === 'overview' ||
    section === 'hotels' ||
    section === 'notifications'
  )
    return true;
  if (ownerAdminOnlySections.has(section)) return false;
  const item = dashboardSections.find((candidate) => candidate.section === section);
  return !!item?.capabilities?.some((capability) => capabilities.includes(capability));
}

function isDashboardTab(value: string | null): value is DashboardTab {
  return dashboardTabs.some((tab) => tab.key === value);
}

function dashboardTabHref(tenantId: string, propertyId: string, tab: DashboardTab) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=overview&tab=${tab}`;
}

function DashboardSectionTabs({
  tenantId,
  propertyId,
  currentTab,
  canAccessQuickBooking,
}: {
  tenantId: string;
  propertyId: string;
  currentTab: DashboardTab;
  canAccessQuickBooking: boolean;
}) {
  return (
    <NavigationSectionTabBar>
      {dashboardTabs
        .filter((tab) => tab.key !== 'quick-booking' || canAccessQuickBooking)
        .map((tab) => (
          <NavigationSectionTabItem
            current={tab.key === currentTab}
            href={dashboardTabHref(tenantId, propertyId, tab.key)}
            key={tab.key}
            label={tab.label}
          />
        ))}
    </NavigationSectionTabBar>
  );
}

function UnavailableDashboardPanel({ title, body }: { title: string; body: string }) {
  return (
    <StatePanel
      body={body}
      icon={<CircleHelp aria-hidden="true" />}
      title={`${title} unavailable`}
      variant="not-available"
    />
  );
}

function DashboardTabPlaceholder({ tab }: { tab: UnavailableDashboardTab }) {
  return (
    <UnavailableDashboardPanel
      body={unavailableDashboardTabCopy[tab]}
      title={dashboardTabs.find((item) => item.key === tab)?.label ?? tab}
    />
  );
}

function InventorySection() {
  return (
    <UnavailableDashboardPanel
      body="Inventory is not available yet; availability restrictions and manual blocks are planned for a future dashboard update."
      title="Inventory"
    />
  );
}

export function dashboardNavigation(
  tenantId: string,
  propertyId: string,
  role: TenantRole,
  currentSection = 'overview',
  capabilities: readonly string[] = [],
): NavigationItem[] {
  const items = dashboardSections.filter((item) =>
    canAccessSection(role, capabilities, item.section),
  );
  return items.map((item) => ({
    href: `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${item.section}`,
    label: item.label,
    current: item.section === currentSection,
    icon: item.icon,
  }));
}

export function DashboardShell({
  tenantId,
  initialData,
}: {
  tenantId: string;
  initialData?: InitialDashboardData;
}) {
  const [user, setUser] = useState<SessionUser | null | undefined>(initialData?.user);
  const [role, setRole] = useState<TenantRole | undefined>(initialData?.role);
  const [properties, setProperties] = useState<Property[] | undefined>(initialData?.properties);
  const [selectedPropertyId, setSelectedPropertyId] = useState(initialData?.properties[0]?.id);
  const [capabilities, setCapabilities] = useState<string[] | undefined>(initialData?.capabilities);
  const [section, setSection] = useState('overview');
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [settingsArea, setSettingsArea] = useState<SettingsArea | null>(null);
  const selectedProperty =
    properties?.find((property) => property.id === selectedPropertyId) ?? properties?.[0];

  useEffect(() => {
    if (initialData) return;
    let active = true;
    void Promise.all([
      fetchSessionUser(),
      fetch('/api/auth/memberships', { credentials: 'include' }).then(async (response) =>
        response.ok
          ? ((await response.json()) as { memberships: Membership[] })
          : { memberships: [] },
      ),
      fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' }).then(
        async (response) => (response.ok ? ((await response.json()) as Property[]) : []),
      ),
    ])
      .then(([sessionUser, memberships, propertyList]) => {
        if (!active) return;
        setUser(sessionUser);
        setRole(
          memberships.memberships.find((membership) => membership.tenantId === tenantId)?.role,
        );
        setProperties(propertyList);
        const params = new URLSearchParams(window.location.search);
        const requestedPropertyId = params.get('propertyId');
        setSection(params.get('section') ?? 'overview');
        const requestedTab = params.get('tab');
        setTab(isDashboardTab(requestedTab) ? requestedTab : 'overview');
        const requestedSettingsArea = params.get('settingsArea');
        setSettingsArea(isSettingsArea(requestedSettingsArea) ? requestedSettingsArea : null);
        setSelectedPropertyId(
          propertyList.some((property) => property.id === requestedPropertyId)
            ? requestedPropertyId!
            : propertyList[0]?.id,
        );
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setProperties([]);
      });
    return () => {
      active = false;
    };
  }, [initialData, tenantId]);

  useEffect(() => {
    if (role !== 'STAFF' || !selectedProperty) return;
    let active = true;
    setCapabilities(undefined);
    void fetch(`/api/tenants/${tenantId}/properties/${selectedProperty.id}/capabilities/mine`, {
      credentials: 'include',
    })
      .then(async (response) => (response.ok ? ((await response.json()) as string[]) : []))
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch(() => {
        if (active) setCapabilities([]);
      });
    return () => {
      active = false;
    };
  }, [role, selectedProperty?.id, tenantId]);

  const navigation =
    selectedProperty && role
      ? dashboardNavigation(tenantId, selectedProperty.id, role, section, capabilities ?? [])
      : [];
  const canViewSection = role ? canAccessSection(role, capabilities ?? [], section) : false;
  const canAccessQuickBooking =
    role !== 'STAFF' || capabilities?.includes('bookings.manage') === true;
  const visibleDashboardTab = tab === 'quick-booking' && !canAccessQuickBooking ? 'overview' : tab;

  return (
    <AppShell
      homeHref="/dashboard"
      navigation={navigation}
      title={selectedProperty?.name ?? 'Hotel operations'}
      userEmail={user?.email}
      userRole={role ? roleLabels[role] : undefined}
      headerActions={
        <>
          {properties && properties.length > 0 && role !== 'STAFF' ? (
            <label className={styles.propertySwitcher}>
              <Layers aria-hidden="true" size={16} />
              <select
                aria-label="Switch property"
                value={selectedProperty?.id ?? ''}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setSelectedPropertyId(event.target.value);
                  setSection('overview');
                  setTab('overview');
                  setSettingsArea(null);
                  window.location.href = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(event.target.value)}&section=overview`;
                }}
              >
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selectedProperty && role ? (
            <DashboardNotifications tenantId={tenantId} propertyId={selectedProperty.id} />
          ) : null}
        </>
      }
    >
      {selectedProperty && role && canViewSection && section === 'overview' ? (
        <Stack gap="lg">
          <DashboardSectionTabs
            currentTab={visibleDashboardTab}
            canAccessQuickBooking={canAccessQuickBooking}
            propertyId={selectedProperty.id}
            tenantId={tenantId}
          />
          {visibleDashboardTab === 'overview' ? (
            <DashboardOverview
              canManageQuickBooking={canAccessQuickBooking}
              tenantId={tenantId}
              propertyId={selectedProperty.id}
              role={role}
            />
          ) : visibleDashboardTab === 'needs-attention' ? (
            <NeedsAttentionTab tenantId={tenantId} propertyId={selectedProperty.id} />
          ) : visibleDashboardTab === 'quick-booking' ? (
            <WalkInBooking
              tenantId={tenantId}
              propertyId={selectedProperty.id}
              bookingMode={selectedProperty.bookingMode}
              paymentGateways={selectedProperty.paymentGateways}
            />
          ) : (
            <DashboardTabPlaceholder tab={visibleDashboardTab} />
          )}
        </Stack>
      ) : null}
      {properties && properties.length > 0 && role && canViewSection && section === 'hotels' ? (
        <HotelsSection tenantId={tenantId} properties={properties} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'inventory' ? (
        <InventorySection />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'reservations' ? (
        <DashboardReservations tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'calendar' ? (
        <DashboardCalendar
          tenantId={tenantId}
          propertyId={selectedProperty.id}
          bookingMode={selectedProperty.bookingMode}
          canManageAvailability={role === 'OWNER' || role === 'ADMIN'}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'payments' ? (
        <DashboardPayments tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'guests' ? (
        <DashboardGuests tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'notifications' ? (
        <NotificationsInbox tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'accommodations' ? (
        <RoomManagement propertyId={selectedProperty.id} tenantId={tenantId} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'rates-pricing' ? (
        <RateManagement propertyId={selectedProperty.id} tenantId={tenantId} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'staff' ? (
        <DashboardStaff tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'reports' ? (
        <DashboardReports tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'settings' ? (
        settingsArea ? (
          <DashboardSettings
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            settingsArea={settingsArea}
          />
        ) : (
          <SettingsHub tenantId={tenantId} propertyId={selectedProperty.id} />
        )
      ) : null}
    </AppShell>
  );
}

export function HotelsSection({
  tenantId,
  properties,
}: {
  tenantId: string;
  properties: Property[];
}) {
  const summariesQuery = useQuery({
    queryKey: [
      'dashboard',
      'hotels',
      tenantId,
      properties.map((property) => property.id).join(','),
    ],
    queryFn: async (): Promise<PropertySummary[]> =>
      Promise.all(
        properties.map(async (property) => {
          const response = await fetch(
            `/api/tenants/${tenantId}/properties/${property.id}/overview`,
            { credentials: 'include' },
          );
          const overview = response.ok ? ((await response.json()) as PropertyOverview) : null;
          return { property, overview };
        }),
      ),
    enabled: properties.length > 0,
  });

  if (summariesQuery.isPending)
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading hotels…"
        variant="loading"
      />
    );
  if (summariesQuery.isError)
    return (
      <StatePanel
        body="Unable to load the hotel summaries."
        icon={<LoaderCircle aria-hidden="true" />}
        title="Hotels unavailable"
        variant="error"
      />
    );

  const summaries = summariesQuery.data ?? [];
  return (
    <Stack className={styles.hotelsSection} gap="lg">
      <HotelAggregateKpis results={summaries} />
      <div className={styles.hotelCards}>
        {summaries.map(({ property, overview }) => (
          <Card className={styles.hotelCard} key={property.id}>
            <a
              aria-label={`Open ${property.name} overview`}
              className={styles.hotelCardLink}
              href={`/dashboard/${tenantId}?propertyId=${encodeURIComponent(property.id)}&section=overview`}
            >
              <div className={styles.hotelCardHeader}>
                <Heading level={3}>{property.name}</Heading>
                {overview ? (
                  <StatusBadge
                    domain="booking"
                    label={`${overview.needsAttention.length} need attention`}
                    state={overview.needsAttention.length ? 'pending' : 'confirmed'}
                  />
                ) : (
                  // The designed "Unavailable" status has no hotel-status data source yet.
                  <Text tone="secondary">Attention unavailable</Text>
                )}
              </div>
              <Text tone="secondary">
                {overview
                  ? `${overview.kpis.inHouse} in-house · ${overview.kpis.arrivals} arrivals · ${overview.kpis.departures} departures · ${formatOccupancy(overview.kpis.occupancyRate)}`
                  : "Unable to load this property's summary."}
              </Text>
            </a>
          </Card>
        ))}
      </div>
      <Card>
        <Stack gap="md">
          <Heading level={2}>Manage properties</Heading>
          <PropertyManagement tenantId={tenantId} />
        </Stack>
      </Card>
      <section aria-labelledby="hotels-integrations-heading" className={styles.integrationsPanel}>
        <Heading id="hotels-integrations-heading" level={2}>
          Integrations
        </Heading>
        <IntegrationsManagement tenantId={tenantId} properties={properties} />
      </section>
    </Stack>
  );
}

function HotelAggregateKpis({ results }: { results: PropertySummary[] }) {
  const totals = results.reduce(
    (acc, { overview }) => {
      if (!overview) return acc;
      acc.arrivals += overview.kpis.arrivals;
      acc.departures += overview.kpis.departures;
      acc.inHouse += overview.kpis.inHouse;
      acc.bookedRoomNights += overview.kpis.bookedRoomNights;
      acc.availableRoomNights += overview.kpis.availableRoomNights;
      return acc;
    },
    { arrivals: 0, departures: 0, inHouse: 0, bookedRoomNights: 0, availableRoomNights: 0 },
  );
  const occupancyRate =
    totals.availableRoomNights > 0
      ? Math.round((totals.bookedRoomNights / totals.availableRoomNights) * 100)
      : null;

  return (
    <Card>
      <Stack gap="sm">
        <Heading level={2}>All properties</Heading>
        <Text tone="secondary">
          {totals.inHouse} guests in-house · {totals.arrivals} arrivals today · {totals.departures}{' '}
          departures today · {formatOccupancy(occupancyRate)}
        </Text>
      </Stack>
    </Card>
  );
}

function formatOccupancy(rate: number | null) {
  return rate === null ? 'occupancy n/a' : `${Math.round(rate)}% occupancy`;
}
