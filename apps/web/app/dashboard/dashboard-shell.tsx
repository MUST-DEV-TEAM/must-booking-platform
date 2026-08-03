'use client';

import { AppShell, type NavigationItem } from '@must/ui';
import {
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileChartColumn,
  Hotel,
  LayoutDashboard,
  Settings,
  Tags,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { fetchSessionUser, type SessionUser } from '../auth-routing';
import styles from './dashboard-shell.module.css';
import { DashboardOverview } from './overview';
import { DashboardCalendar } from './calendar';
import { WalkInBooking } from './walk-in-booking';
import { DashboardPayments } from './payments';
import { DashboardGuests } from './guests';
import { DashboardStaff } from './staff';
import { DashboardReservations } from './reservations';
import { DashboardSettings } from './settings';
import { DashboardNotifications } from './notifications';
import { DashboardReports } from './reports';
import { RoomManagement } from './[tenantId]/room-management';
import { RateManagement } from './[tenantId]/rate-management';

type TenantRole = 'OWNER' | 'ADMIN' | 'STAFF';
type Membership = { tenantId: string; role: TenantRole };
type Property = { id: string; name: string };

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
  { section: 'overview', label: 'Overview', icon: LayoutDashboard },
  {
    section: 'reservations',
    label: 'Reservations',
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
  { section: 'accommodations', label: 'Accommodations', icon: Hotel },
  { section: 'rates-pricing', label: 'Rates & Pricing', icon: Tags },
  { section: 'staff', label: 'Staff', icon: Users },
  { section: 'reports', label: 'Reports', icon: FileChartColumn, capabilities: ['reports.view'] },
  { section: 'settings', label: 'Settings', icon: Settings },
] as const;

const dashboardSections: readonly DashboardNavigationDefinition[] = [
  ...operationalNavigation,
  ...managementNavigation,
];

// Tenant-administration sections: never delegable to a STAFF-role user via a capability
// grant, regardless of what a custom template happens to include. Matches this milestone's
// established scoping (tasks 16/18/20/21) and the backend's unconditional @Roles(Owner, Admin)
// on every one of these sections' endpoints.
const ownerAdminOnlySections = new Set(['accommodations', 'rates-pricing', 'staff', 'settings']);

function canAccessSection(role: TenantRole, capabilities: readonly string[], section: string) {
  if (role !== 'STAFF' || section === 'overview') return true;
  if (ownerAdminOnlySections.has(section)) return false;
  const item = dashboardSections.find((candidate) => candidate.section === section);
  return !!item?.capabilities?.some((capability) => capabilities.includes(capability));
}

export function dashboardNavigation(
  tenantId: string,
  propertyId: string,
  role: TenantRole,
  currentSection = 'overview',
  capabilities: readonly string[] = [],
): NavigationItem[] {
  const items = [
    ...operationalNavigation.slice(0, 3),
    ...managementNavigation.slice(0, 2),
    ...operationalNavigation.slice(3),
    ...managementNavigation.slice(2),
  ].filter((item) => canAccessSection(role, capabilities, item.section));
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
        const requestedPropertyId = new URLSearchParams(window.location.search).get('propertyId');
        setSection(new URLSearchParams(window.location.search).get('section') ?? 'overview');
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

  return (
    <AppShell
      homeHref="/dashboard"
      navigation={navigation}
      title={selectedProperty?.name ?? 'Hotel operations'}
      userEmail={user?.email}
      headerActions={
        selectedProperty && role ? (
          <DashboardNotifications tenantId={tenantId} propertyId={selectedProperty.id} />
        ) : undefined
      }
    >
      {properties && properties.length > 1 && role !== 'STAFF' ? (
        <label className={styles.propertySwitcher}>
          <span>Property</span>
          <select
            aria-label="Switch property"
            value={selectedProperty?.id ?? ''}
            onChange={(event) => {
              setSelectedPropertyId(event.target.value);
              setSection('overview');
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
      {selectedProperty && role && canViewSection && section === 'overview' ? (
        <DashboardOverview tenantId={tenantId} propertyId={selectedProperty.id} role={role} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'reservations' ? (
        <DashboardReservations tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'calendar' ? (
        <DashboardCalendar tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty &&
      role &&
      (role !== 'STAFF' || capabilities?.includes('bookings.manage')) &&
      section === 'walk-in' ? (
        <WalkInBooking tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'payments' ? (
        <DashboardPayments tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
      {selectedProperty && role && canViewSection && section === 'guests' ? (
        <DashboardGuests tenantId={tenantId} propertyId={selectedProperty.id} />
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
        <DashboardSettings tenantId={tenantId} propertyId={selectedProperty.id} />
      ) : null}
    </AppShell>
  );
}
