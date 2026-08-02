'use client';

import { AppShell, Badge, Button, Card, Heading, Stack, Text } from '@must/ui';
import { Building2, History, LayoutDashboard } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AuthRouteGuard, fetchSessionUser } from '../../../auth-routing';
import styles from '../../platform.module.css';
import detailStyles from './tenant-detail.module.css';

export const navigation = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/tenants', label: 'Tenants', current: true, icon: Building2 },
  { href: '/platform/audit', label: 'Audit Log', icon: History },
] as const;

export type PlatformTenantDetail = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  ownerEmail: string | null;
  ownerUserId: string | null;
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
  onTransition,
  onPasswordReset,
}: {
  tenant: PlatformTenantDetail | null;
  loading: boolean;
  notFound: boolean;
  health: { stripe: ProviderHealth; pokpay: ProviderHealth };
  onTransition?: (status: 'ACTIVE' | 'SUSPENDED') => Promise<void>;
  onPasswordReset?: (userId: string) => Promise<void>;
}) {
  const [transitionPending, setTransitionPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
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
          Tenant status changes are audit-logged and applied from the platform service.
        </Text>
        {transitionError ? <Text className={styles.error}>{transitionError}</Text> : null}
        {resetError ? <Text className={styles.error}>{resetError}</Text> : null}
        {resetSuccess ? (
          <Text tone="secondary">Password-reset email queued for the tenant owner.</Text>
        ) : null}
        <div className={detailStyles.actions}>
          <Button
            disabled={transitionPending || !onTransition}
            onClick={async () => {
              if (!onTransition) return;
              setTransitionPending(true);
              setTransitionError(null);
              try {
                await onTransition(tenant.status);
              } catch (error) {
                setTransitionError(
                  error instanceof Error && 'status' in error && error.status === 409
                    ? 'This tenant status changed elsewhere. Refreshing the latest state is required.'
                    : 'Unable to update tenant status. Please try again.',
                );
              } finally {
                setTransitionPending(false);
              }
            }}
            variant="secondary"
          >
            {transitionPending
              ? 'Updating…'
              : tenant.status === 'ACTIVE'
                ? 'Suspend tenant'
                : 'Reactivate tenant'}
          </Button>
          <Button
            disabled={resetPending || !tenant.ownerUserId || !onPasswordReset}
            onClick={async () => {
              if (!tenant.ownerUserId || !onPasswordReset) return;
              setResetPending(true);
              setResetSuccess(false);
              setResetError(null);
              try {
                await onPasswordReset(tenant.ownerUserId);
                setResetSuccess(true);
              } catch {
                setResetError('Unable to queue a password-reset email. Please try again.');
              } finally {
                setResetPending(false);
              }
            }}
            variant="secondary"
            title={!tenant.ownerUserId ? 'No tenant owner is available to reset.' : undefined}
          >
            {resetPending
              ? 'Sending…'
              : resetSuccess
                ? 'Reset email queued'
                : 'Reset owner password'}
          </Button>
          {!tenant.ownerUserId ? (
            <Text tone="secondary">Password reset unavailable: this tenant has no owner.</Text>
          ) : null}
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
  const [userEmail, setUserEmail] = useState<string>();

  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setUserEmail(user?.email))
      .catch(() => undefined);
  }, []);

  const refreshTenant = async (tenantId: string) => {
    const [response, healthResponse] = await Promise.all([
      fetch(`/api/platform/tenants/${tenantId}`, { credentials: 'include' }),
      fetch('/api/platform/provider-health', { credentials: 'include' }),
    ]);
    if (response.status === 404) {
      setNotFound(true);
      return;
    }
    if (!response.ok) throw new Error('Unable to load tenant.');
    setTenant((await response.json()) as PlatformTenantDetail);
    if (healthResponse.ok) setHealth((await healthResponse.json()) as typeof health);
  };

  useEffect(() => {
    let active = true;
    void params
      .then(async ({ tenantId }) => {
        if (!active) return;
        await refreshTenant(tenantId);
        return tenantId;
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
      <AppShell navigation={navigation} title="Platform operations" userEmail={userEmail}>
        <TenantDetailView
          tenant={tenant}
          loading={loading}
          notFound={notFound}
          health={health}
          onTransition={async (status) => {
            if (!tenant) return;
            const action = status === 'ACTIVE' ? 'suspend' : 'reactivate';
            const response = await fetch(`/api/platform/tenants/${tenant.id}/${action}`, {
              credentials: 'include',
              method: 'POST',
            });
            if (!response.ok) {
              const error = new Error('Unable to update tenant status.') as Error & {
                status?: number;
              };
              error.status = response.status;
              if (response.status === 409) await refreshTenant(tenant.id);
              throw error;
            }
            await refreshTenant(tenant.id);
          }}
          onPasswordReset={async (userId) => {
            const response = await fetch(
              `/api/platform/tenants/${tenant?.id}/users/${userId}/reset-password`,
              {
                credentials: 'include',
                method: 'POST',
              },
            );
            if (!response.ok) throw new Error('Unable to queue password reset.');
          }}
        />
      </AppShell>
    </AuthRouteGuard>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
