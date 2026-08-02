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

type TenantRole = 'OWNER' | 'ADMIN' | 'STAFF';
type Membership = { tenantId: string; role: TenantRole };
type Property = { id: string; name: string };

type InitialDashboardData = {
  user: SessionUser | null;
  role: TenantRole;
  properties: Property[];
};

const operationalNavigation = [
  { section: 'overview', label: 'Overview', icon: LayoutDashboard },
  { section: 'reservations', label: 'Reservations', icon: ClipboardList },
  { section: 'calendar', label: 'Calendar', icon: CalendarDays },
  { section: 'payments', label: 'Payments', icon: CreditCard },
  { section: 'guests', label: 'Guests', icon: UserRound },
] as const;

const managementNavigation = [
  { section: 'accommodations', label: 'Accommodations', icon: Hotel },
  { section: 'rates-pricing', label: 'Rates & Pricing', icon: Tags },
  { section: 'staff', label: 'Staff', icon: Users },
  { section: 'reports', label: 'Reports', icon: FileChartColumn },
  { section: 'settings', label: 'Settings', icon: Settings },
] as const;

export function dashboardNavigation(
  tenantId: string,
  propertyId: string,
  role: TenantRole,
): NavigationItem[] {
  const items =
    role === 'STAFF'
      ? operationalNavigation
      : [
          ...operationalNavigation.slice(0, 3),
          ...managementNavigation.slice(0, 2),
          ...operationalNavigation.slice(3),
          ...managementNavigation.slice(2),
        ];
  return items.map((item) => ({
    href: `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${item.section}`,
    label: item.label,
    current: item.section === 'overview',
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

  const navigation =
    selectedProperty && role ? dashboardNavigation(tenantId, selectedProperty.id, role) : [];

  return (
    <AppShell
      homeHref="/dashboard"
      navigation={navigation}
      title={selectedProperty?.name ?? 'Hotel operations'}
      userEmail={user?.email}
    >
      {properties && properties.length > 1 ? (
        <label className={styles.propertySwitcher}>
          <span>Property</span>
          <select
            aria-label="Switch property"
            value={selectedProperty?.id ?? ''}
            onChange={(event) => {
              setSelectedPropertyId(event.target.value);
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
    </AppShell>
  );
}
