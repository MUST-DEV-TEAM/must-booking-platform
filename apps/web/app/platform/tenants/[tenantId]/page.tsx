'use client';

import { AppShell, Badge, Button, Card, Heading, Stack, Text } from '@must/ui';
import { useEffect, useState } from 'react';

import { AuthRouteGuard } from '../../../auth-routing';
import styles from '../../platform.module.css';
import detailStyles from './tenant-detail.module.css';

const navigation = [
  { href: '/platform', label: 'Overview' },
  { href: '/platform/tenants', label: 'Tenants', current: true },
] as const;

export type PlatformTenantDetail = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  ownerEmail: string | null;
  createdAt: string;
  propertyCount: number;
  stripeEnabled: boolean;
  pokpayEnabled: boolean;
  payAtHotelEnabled: boolean;
  stripeEnabledPropertyCount: number;
  pokpayEnabledPropertyCount: number;
  payAtHotelEnabledPropertyCount: number;
};
type ProviderHealth = { status: 'checking' | 'healthy' | 'unhealthy' };

export function TenantDetailView({
  tenant,
  loading,
  notFound,
  health,
}: {
  tenant: PlatformTenantDetail | null;
  loading: boolean;
  notFound: boolean;
  health: { stripe: ProviderHealth; pokpay: ProviderHealth };
}) {
  if (loading)
    return (
      <Stack className={styles.page} gap="lg">
        <Text tone="secondary">Loading tenant…</Text>
      </Stack>
    );
  if (notFound)
    return (
      <Stack className={styles.page} gap="lg">
        <Heading>Tenant not found</Heading>
        <Text tone="secondary">
          This organization may have been removed or the link is incorrect.
        </Text>
        <a href="/platform/tenants">Back to tenants</a>
      </Stack>
    );
  if (!tenant) return null;

  return (
    <Stack className={styles.page} gap="lg">
      <a href="/platform/tenants">← Back to tenants</a>
      <header className={styles.header}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            TENANT DETAIL
          </Text>
          <Heading>{tenant.name}</Heading>
          <Text tone="secondary">Created {formatDate(tenant.createdAt)}</Text>
        </div>
        <Badge tone={tenant.status === 'ACTIVE' ? 'success' : 'warning'}>
          {tenant.status.toLowerCase()}
        </Badge>
      </header>
      <section className={detailStyles.grid}>
        <Card>
          <Heading level={2}>Owner</Heading>
          <Text>{tenant.ownerEmail ?? 'No owner email on file'}</Text>
        </Card>
        <Card>
          <Heading level={2}>Properties</Heading>
          <strong className={detailStyles.count}>{tenant.propertyCount}</strong>
          <Text tone="secondary">{tenant.propertyCount === 1 ? 'property' : 'properties'}</Text>
        </Card>
      </section>
      <Card>
        <Heading level={2}>Payment providers</Heading>
        <Text tone="secondary">
          Enabled if at least one property uses the provider. Health is the shared platform signal.
        </Text>
        <div className={detailStyles.providers}>
          <ProviderBadge
            name="Stripe"
            enabled={tenant.stripeEnabled}
            enabledPropertyCount={tenant.stripeEnabledPropertyCount}
            propertyCount={tenant.propertyCount}
            health={health.stripe.status}
          />
          <ProviderBadge
            name="PokPay"
            enabled={tenant.pokpayEnabled}
            enabledPropertyCount={tenant.pokpayEnabledPropertyCount}
            propertyCount={tenant.propertyCount}
            health={health.pokpay.status}
          />
          <ProviderBadge
            name="Pay at hotel"
            enabled={tenant.payAtHotelEnabled}
            enabledPropertyCount={tenant.payAtHotelEnabledPropertyCount}
            propertyCount={tenant.propertyCount}
          />
        </div>
      </Card>
      <Card>
        <Heading level={2}>Administrative actions</Heading>
        <Text tone="secondary">
          These controls will be available in the next dashboard updates.
        </Text>
        <div className={detailStyles.actions}>
          <Button disabled variant="secondary">
            {tenant.status === 'ACTIVE' ? 'Suspend tenant' : 'Reactivate tenant'}
          </Button>
          <Button disabled variant="secondary">
            Trigger password reset
          </Button>
        </div>
      </Card>
    </Stack>
  );
}

function ProviderBadge({
  name,
  enabled,
  enabledPropertyCount,
  propertyCount,
  health,
}: {
  name: string;
  enabled: boolean;
  enabledPropertyCount: number;
  propertyCount: number;
  health?: ProviderHealth['status'];
}) {
  const healthTone =
    health === 'healthy' ? 'success' : health === 'unhealthy' ? 'danger' : 'warning';
  return (
    <div className={detailStyles.provider}>
      <div>
        <strong>{name}</strong>
        <Text tone="secondary">
          {enabled
            ? `Enabled on ${enabledPropertyCount} of ${propertyCount} ${propertyCount === 1 ? 'property' : 'properties'}`
            : 'Not enabled'}
        </Text>
      </div>
      <div className={detailStyles.badges}>
        <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</Badge>
        {health ? <Badge tone={healthTone}>health: {health}</Badge> : null}
      </div>
    </div>
  );
}

export default function PlatformTenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const [tenant, setTenant] = useState<PlatformTenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [health, setHealth] = useState({
    stripe: { status: 'checking' as const },
    pokpay: { status: 'checking' as const },
  });

  useEffect(() => {
    let active = true;
    void params
      .then(async ({ tenantId }) => {
        const [response, healthResponse] = await Promise.all([
          fetch(`/api/platform/tenants/${tenantId}`, { credentials: 'include' }),
          fetch('/api/platform/provider-health', { credentials: 'include' }),
        ]);
        if (!active) return;
        if (response.status === 404) {
          setNotFound(true);
          return;
        }
        if (!response.ok) throw new Error('Unable to load tenant.');
        setTenant((await response.json()) as PlatformTenantDetail);
        if (healthResponse.ok) setHealth((await healthResponse.json()) as typeof health);
      })
      .catch(() => {
        if (active) setNotFound(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params]);

  return (
    <AuthRouteGuard audience="platform">
      <AppShell navigation={navigation} title="Platform operations">
        <TenantDetailView tenant={tenant} loading={loading} notFound={notFound} health={health} />
      </AppShell>
    </AuthRouteGuard>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
