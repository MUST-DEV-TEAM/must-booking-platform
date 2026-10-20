'use client';

import { InventorySection } from './inventory';

import { Card, Heading, Stack, StatePanel, StatusBadge, Text, type NavigationItem } from '@must/ui';
import {
  CalendarDays,
  ClipboardList,
  CircleHelp,
  CreditCard,
  FileChartColumn,
  Hotel as IconHotel,
  Layers,
  LayoutDashboard,
  Mail,
  LoaderCircle,
  Package as IconInventory,
  Settings,
  Tags,
  UserRound,
  Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Chip } from '../../components/ui/chip';
import { TabBar } from '../../components/ui/tab-bar';
import { AppShell, type AppNavigationItem } from '../../components/app-shell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { fetchSessionUser, type SessionUser } from '../auth-routing';
import styles from './dashboard-shell.module.css';
import { NeedsAttentionTab } from './needs-attention';
import { SystemHealthTab } from './system-health';
import { useUnseenBookings } from './unseen-bookings';
import { DashboardOverview, useOverviewQuery } from './overview';
import { CalendarPage } from './calendar-page';
import { AddReservation } from './add-reservation';
import { DashboardPayments } from './payments';
import { PaymentDetail } from './payment-detail';
import { DashboardGuests } from './guests';
import { GuestDetail } from './guest-detail';
import { DashboardStaff } from './staff';
import { MyAccount } from './my-account';
import { ReservationDetail } from './reservation-detail';
import { ReservationsPage } from './reservations-page';
import { EmailSettings, isEmailTab, type EmailTab } from './email-settings';
import { DashboardSettings, isSettingsArea, SettingsHub, type SettingsArea } from './settings';
import { DashboardNotifications, NotificationsInbox } from './notifications';
import { EmailsWorkspace } from './emails';
import { DashboardReports } from './reports';
import { ActivityAudit } from './activity-audit';
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
  checkInTime?: string | null;
  checkOutTime?: string | null;
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
  /** Visible when the user holds at least one of these (in addition to `capabilities`). */
  anyCapabilities?: readonly string[];
};

const operationalNavigation = [
  { section: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  {
    section: 'reservations',
    label: 'Bookings',
    icon: ClipboardList,
    capabilities: ['bookings.view'],
  },
  { section: 'calendar', label: 'Calendar', icon: CalendarDays, capabilities: ['calendar.view'] },
  {
    section: 'payments',
    label: 'Payments',
    icon: CreditCard,
    capabilities: ['payments.view', 'bookings.view'],
  },
  { section: 'guests', label: 'Guests', icon: UserRound, capabilities: ['guests.view'] },
] as const;

const managementNavigation = [
  // Inventory uses calendar permissions; Settings remains owner/admin-only.
  {
    section: 'accommodations',
    label: 'Accommodations',
    icon: IconHotel,
    // Photos live in the listing editor; photos-only staff reach them through this entry.
    anyCapabilities: ['accommodations.manage', 'photos.manage'],
  },
  {
    section: 'rates-pricing',
    label: 'Rates & Pricing',
    icon: Tags,
    capabilities: ['rates.manage'],
  },
  { section: 'staff', label: 'Staff', icon: Users, capabilities: ['staff.view'] },
  { section: 'emails', label: 'Emails', icon: Mail, capabilities: ['settings.manage'] },
  { section: 'reports', label: 'Reports', icon: FileChartColumn, capabilities: ['reports.view'] },
  {
    section: 'audit',
    label: 'Audit log',
    icon: ClipboardList,
    anyCapabilities: [
      'bookings.view',
      'payments.view',
      'calendar.view',
      'rates.manage',
      'accommodations.manage',
      'photos.manage',
      'guests.view',
      'reports.view',
      'settings.manage',
      'staff.view',
    ],
  },
  { section: 'settings', label: 'Settings', icon: Settings },
] as const;

const hotelNavigation = [
  { section: 'hotels', label: 'Hotels', icon: IconHotel },
  {
    section: 'inventory',
    label: 'Inventory',
    icon: IconInventory,
    capabilities: ['calendar.view'],
  },
] as const;

const dashboardSections: readonly DashboardNavigationDefinition[] = [
  ...operationalNavigation.slice(0, 3),
  ...hotelNavigation,
  ...operationalNavigation.slice(3),
  ...managementNavigation,
];

const dashboardTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'needs-attention', label: 'Needs attention' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'quick-booking', label: 'Quick booking' },
  { key: 'system-health', label: 'System health' },
] as const;

type DashboardTab = (typeof dashboardTabs)[number]['key'];
type UnavailableDashboardTab = Exclude<
  DashboardTab,
  'overview' | 'quick-booking' | 'system-health'
>;

const unavailableDashboardTabCopy: Record<UnavailableDashboardTab, string> = {
  'needs-attention': 'Needs Attention will be available in a future dashboard update.',
  approvals:
    'Approvals will coordinate review and sign-off for bookings and other workflows; no approval workflow is configured yet.',
};

// Tenant-administration sections: never delegable to a STAFF-role user via a capability
// grant, regardless of what a custom template happens to include. Matches this milestone's
// established scoping (tasks 16/18/20/21) and the backend's unconditional @Roles(Owner, Admin)
// on every one of these sections' endpoints.
const ownerAdminOnlySections = new Set(['settings']);

function canAccessSection(role: TenantRole, capabilities: readonly string[], section: string) {
  if (section === 'emails') return capabilities.includes('settings.manage');
  if (
    role !== 'STAFF' ||
    section === 'overview' ||
    section === 'hotels' ||
    section === 'account' ||
    section === 'notifications'
  )
    return true;
  if (ownerAdminOnlySections.has(section)) return false;
  const item = dashboardSections.find((candidate) => candidate.section === section);
  if (item?.anyCapabilities)
    return item.anyCapabilities.some((capability) => capabilities.includes(capability));
  return !!item?.capabilities?.every((capability) => capabilities.includes(capability));
}

// Approvals and System health are planned; their URLs fall back to Overview until they exist.
const LIVE_TABS: readonly string[] = [
  'overview',
  'needs-attention',
  'quick-booking',
  'system-health',
];

function isDashboardTab(value: string | null): value is DashboardTab {
  return dashboardTabs.some((tab) => tab.key === value) && LIVE_TABS.includes(value ?? '');
}

function dashboardTabHref(tenantId: string, propertyId: string, tab: DashboardTab) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=overview&tab=${tab}`;
}

function DashboardSectionTabs({
  tenantId,
  propertyId,
  currentTab,
  canAccessQuickBooking,
  canAccessSystemHealth,
  onSelectTab,
}: {
  tenantId: string;
  propertyId: string;
  currentTab: DashboardTab;
  canAccessQuickBooking: boolean;
  canAccessSystemHealth: boolean;
  onSelectTab: (tab: DashboardTab) => void;
}) {
  // Approvals and System health are planned features; they stay out of the live tab bar until built.
  const attention = useOverviewQuery(tenantId, propertyId).data?.needsAttentionCount;
  const tabs = dashboardTabs
    .filter(
      (tab) =>
        tab.key === 'overview' ||
        tab.key === 'needs-attention' ||
        tab.key === 'quick-booking' ||
        tab.key === 'system-health',
    )
    .filter((tab) => tab.key !== 'system-health' || canAccessSystemHealth)
    .filter((tab) => tab.key !== 'quick-booking' || canAccessQuickBooking)
    .map((tab) => ({
      id: tab.key,
      label: tab.label,
      count: tab.key === 'needs-attention' ? attention : undefined,
    }));
  return (
    <TabBar
      label="Dashboard sections"
      tabs={tabs}
      current={currentTab}
      onSelect={(id) => onSelectTab(id as DashboardTab)}
    />
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

export function dashboardNavigation(
  tenantId: string,
  propertyId: string,
  role: TenantRole,
  currentSection = 'overview',
  capabilities: readonly string[] = [],
  badges: Readonly<Record<string, number>> = {},
): AppNavigationItem[] {
  const items = dashboardSections.filter((item) =>
    canAccessSection(role, capabilities, item.section),
  );
  return items.map((item) => ({
    href: `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${item.section}`,
    label: item.label,
    current: item.section === currentSection,
    icon: item.icon,
    badge: badges[item.section],
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
  // A single payment or guest opened by link (?payment=<bookingId> / ?guest=<guestId>).
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [settingsArea, setSettingsArea] = useState<SettingsArea | null>(null);
  const [emailTab, setEmailTab] = useState<EmailTab | undefined>(undefined);
  const selectedProperty =
    properties?.find((property) => property.id === selectedPropertyId) ?? properties?.[0];

  // Tabs switch in place and push the address; the back/forward buttons must follow.
  useEffect(() => {
    const onPopState = () => {
      const requested = new URLSearchParams(window.location.search).get('tab');
      setTab(isDashboardTab(requested) ? requested : 'overview');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPaymentId(params.get('payment'));
    setGuestId(params.get('guest'));
    setReservationId(params.get('reservation'));
  }, []);

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
        const requestedEmailTab = params.get('emailTab');
        setEmailTab(isEmailTab(requestedEmailTab) ? requestedEmailTab : undefined);
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
    if (!role || !selectedProperty) return;
    let active = true;
    setCapabilities(undefined);
    void fetch(`/api/tenants/${tenantId}/properties/${selectedProperty.id}/capabilities/mine`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) return [];
        const value: unknown = await response.json();
        return Array.isArray(value) &&
          value.every((item): item is string => typeof item === 'string')
          ? value
          : [];
      })
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

  const canSeeBookings =
    !!role && (role !== 'STAFF' || capabilities?.includes('bookings.view') === true);
  // New reservations this person has not opened yet show as a count on the Bookings item.
  const unseen = useUnseenBookings(
    tenantId,
    selectedProperty?.id,
    !!selectedProperty && canSeeBookings,
  );
  const navigation =
    selectedProperty && role
      ? dashboardNavigation(tenantId, selectedProperty.id, role, section, capabilities ?? [], {
          reservations: unseen.count,
        })
      : [];
  const sectionLabel =
    section === 'account'
      ? 'My account'
      : (dashboardSections.find((candidate) => candidate.section === section)?.label ??
        'Dashboard');
  const canViewSection = role ? canAccessSection(role, capabilities ?? [], section) : false;
  const hasCapability = (capability: string) =>
    role !== 'STAFF' || capabilities?.includes(capability) === true;
  const canAccessQuickBooking = hasCapability('bookings.create');
  const canAccessSystemHealth = hasCapability('bookings.view');
  const visibleDashboardTab =
    (tab === 'quick-booking' && !canAccessQuickBooking) ||
    (tab === 'system-health' && !canAccessSystemHealth)
      ? 'overview'
      : tab;

  return (
    <AppShell
      homeHref="/dashboard"
      navigation={navigation}
      title={sectionLabel}
      accountLinks={
        selectedProperty
          ? [
              {
                label: 'Profile',
                href: `/dashboard/${tenantId}?propertyId=${encodeURIComponent(selectedProperty.id)}&section=account`,
              },
              {
                label: 'Settings',
                href: `/dashboard/${tenantId}?propertyId=${encodeURIComponent(selectedProperty.id)}&section=settings`,
              },
            ]
          : undefined
      }
      userEmail={user?.email}
      userRole={role ? roleLabels[role] : undefined}
      headerActions={
        <>
          {properties && properties.length > 1 && role !== 'STAFF' ? (
            <Select
              value={selectedProperty?.id ?? ''}
              onValueChange={(value) => {
                if (!value) return;
                setSelectedPropertyId(value);
                setSection('overview');
                setTab('overview');
                setSettingsArea(null);
                window.location.href = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(value)}&section=overview`;
              }}
            >
              <SelectTrigger aria-label="Switch property" className="h-10 w-auto min-w-44 gap-2">
                <Layers aria-hidden="true" className="size-4 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {properties.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : selectedProperty ? (
            <Chip icon={Layers}>{selectedProperty.name}</Chip>
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
            canAccessSystemHealth={canAccessSystemHealth}
            onSelectTab={(next) => {
              setTab(next);
              window.history.pushState(
                null,
                '',
                dashboardTabHref(tenantId, selectedProperty.id, next),
              );
            }}
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
          ) : visibleDashboardTab === 'system-health' ? (
            <SystemHealthTab tenantId={tenantId} propertyId={selectedProperty.id} />
          ) : visibleDashboardTab === 'quick-booking' ? (
            <AddReservation
              tenantId={tenantId}
              propertyId={selectedProperty.id}
              bookingMode={selectedProperty.bookingMode}
              paymentGateways={selectedProperty.paymentGateways}
              checkInTime={selectedProperty.checkInTime}
              canRecordPayment={hasCapability('payments.record')}
              canCheckPayment={hasCapability('bookings.edit')}
              canViewBooking={hasCapability('bookings.view')}
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
        <InventorySection
          key={selectedProperty.id}
          tenantId={tenantId}
          propertyId={selectedProperty.id}
          emailVerified={user?.emailVerified === true}
          currentUser={user ?? undefined}
          bookingMode={selectedProperty.bookingMode}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'reservations' ? (
        reservationId ? (
          <ReservationDetail
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            bookingId={reservationId}
            propertyName={selectedProperty.name}
            checkInTime={selectedProperty.checkInTime}
            checkOutTime={selectedProperty.checkOutTime}
            bookingMode={selectedProperty.bookingMode}
            canCancelBooking={hasCapability('bookings.cancel')}
            canRefundPayment={hasCapability('payments.refund')}
            canEditBooking={hasCapability('bookings.edit')}
          />
        ) : (
          <ReservationsPage
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            canCreateBooking={hasCapability('bookings.create')}
          />
        )
      ) : null}
      {selectedProperty && role && canViewSection && section === 'calendar' ? (
        <CalendarPage
          tenantId={tenantId}
          propertyId={selectedProperty.id}
          bookingMode={selectedProperty.bookingMode}
          canManageAvailability={hasCapability('calendar.block')}
          canCreateBooking={hasCapability('bookings.create')}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'payments' ? (
        paymentId ? (
          <PaymentDetail
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            bookingId={paymentId}
          />
        ) : (
          <DashboardPayments tenantId={tenantId} propertyId={selectedProperty.id} />
        )
      ) : null}
      {selectedProperty && role && canViewSection && section === 'guests' ? (
        guestId ? (
          <GuestDetail
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            guestId={guestId}
            canEditCountry={
              hasCapability('bookings.edit') &&
              hasCapability('guests.view') &&
              user?.emailVerified === true
            }
          />
        ) : (
          <DashboardGuests
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            canMergeGuests={hasCapability('guests.merge')}
          />
        )
      ) : null}
      {selectedProperty && role && canViewSection && section === 'account' ? (
        <MyAccount
          tenantId={tenantId}
          email={user?.email}
          role={role ? roleLabels[role] : undefined}
          hotelName={selectedProperty.name}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'audit' ? (
        <ActivityAudit tenantId={tenantId} propertyId={selectedProperty.id} userId={user?.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'notifications' ? (
        <NotificationsInbox tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'accommodations' ? (
        <RoomManagement
          propertyId={selectedProperty.id}
          tenantId={tenantId}
          canManageAccommodations={hasCapability('accommodations.manage')}
          canManagePhotos={hasCapability('photos.manage')}
          canViewCalendar={hasCapability('calendar.view')}
          canBlockCalendar={hasCapability('calendar.block')}
          canCreateBooking={hasCapability('bookings.create')}
          canManageRates={hasCapability('rates.manage')}
          canManageInventorySource={role === 'OWNER' || role === 'ADMIN'}
          onNavigateSection={setSection}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'rates-pricing' ? (
        <RateManagement
          propertyId={selectedProperty.id}
          tenantId={tenantId}
          emailVerified={user?.emailVerified === true}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'staff' ? (
        <DashboardStaff tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'emails' ? (
        <EmailsWorkspace
          viewerId={user?.id}
          key={selectedProperty.id}
          tenantId={tenantId}
          propertyId={selectedProperty.id}
          canWrite={user?.emailVerified === true && hasCapability('settings.manage')}
        />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'reports' ? (
        <DashboardReports tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'settings' ? (
        settingsArea === 'email' ? (
          <EmailSettings
            viewerId={user?.id}
            tenantId={tenantId}
            propertyId={selectedProperty.id}
            initialTab={emailTab}
            canWrite={user?.emailVerified === true && hasCapability('settings.manage')}
          />
        ) : settingsArea ? (
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
