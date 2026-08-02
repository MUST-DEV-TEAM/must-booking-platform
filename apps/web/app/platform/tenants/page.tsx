'use client';

import { AppShell, Badge, Card, Heading, Stack, Text, TextInput } from '@must/ui';
import { Building2, History, LayoutDashboard } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AuthRouteGuard, fetchSessionUser } from '../../auth-routing';
import styles from '../platform.module.css';
import listStyles from './tenant-list.module.css';

export const navigation = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/tenants', label: 'Tenants', current: true, icon: Building2 },
  { href: '/platform/audit', label: 'Audit Log', icon: History },
] as const;

export type PlatformTenant = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  ownerEmail: string | null;
  createdAt: string;
};

export function TenantListView({
  tenants,
  loading,
  search,
  onSearchChange,
}: {
  tenants: PlatformTenant[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.header}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            PLATFORM OPERATIONS
          </Text>
          <Heading>Tenants</Heading>
          <Text tone="secondary">Search organizations by name or owner email.</Text>
        </div>
      </header>
      <Card>
        <TextInput
          aria-label="Search tenants"
          label="Search"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Organization or owner email"
          value={search}
        />
      </Card>
      <Card>
        {loading ? <Text tone="secondary">Loading tenants…</Text> : null}
        {!loading && tenants.length === 0 ? (
          <Text tone="secondary">No tenants match this search.</Text>
        ) : null}
        {!loading && tenants.length > 0 ? (
          <div className={listStyles.tableWrap}>
            <table className={listStyles.table}>
              <caption className={listStyles.caption}>Tenant organizations</caption>
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className={listStyles.visuallyHidden}>Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <th scope="row">
                      <a href={`/platform/tenants/${tenant.id}`}>{tenant.name}</a>
                      <Text tone="secondary">Joined {formatDate(tenant.createdAt)}</Text>
                    </th>
                    <td>{tenant.ownerEmail ?? '—'}</td>
                    <td>
                      <Badge tone={tenant.status === 'ACTIVE' ? 'success' : 'warning'}>
                        {tenant.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td>
                      <a className={listStyles.openLink} href={`/platform/tenants/${tenant.id}`}>
                        View
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </Stack>
  );
}

export default function PlatformTenantsPage() {
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>();

  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setUserEmail(user?.email))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch(`/api/platform/tenants${search ? `?search=${encodeURIComponent(search)}` : ''}`, {
        credentials: 'include',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Unable to load tenants.');
          return (await response.json()) as PlatformTenant[];
        })
        .then(setTenants)
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : 'Unable to load tenants.'),
        )
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <AuthRouteGuard audience="platform">
      <AppShell navigation={navigation} title="Platform operations" userEmail={userEmail}>
        {error ? <Text className={styles.error}>{error}</Text> : null}
        <TenantListView
          tenants={tenants}
          loading={loading}
          search={search}
          onSearchChange={setSearch}
        />
      </AppShell>
    </AuthRouteGuard>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
