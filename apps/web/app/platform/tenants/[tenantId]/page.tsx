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

export type PlatformIntegrationConnection = {
  id: string;
  kind: 'PAYMENT' | 'PMS';
  provider: 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
  name: string;
  status: 'PENDING' | 'CONNECTED' | 'FAILED';
  lastTestedAt: string | null;
  lastTestResult: string | null;
};
export type ManualReviewItemSummary = {
  id: string;
  category: string;
  referenceType: string;
  referenceId: string | null;
  message: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
};
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
  properties: Array<{ id: string; name: string }>;
  connections: PlatformIntegrationConnection[];
  manualReviewItems: ManualReviewItemSummary[];
};
const categoryLabels: Record<string, string> = {
  UNKNOWN_RESULT: 'Unknown result',
  DUPLICATE: 'Duplicate',
  MISSING_MAPPING: 'Missing mapping',
  SIMULTANEOUS_CHANGE: 'Simultaneous change',
  PAYMENT_BOOKING_MISMATCH: 'Payment/booking mismatch',
  UNKNOWN_STATUS: 'Unknown status',
  SCHEMA_MISMATCH: 'Schema mismatch',
};
const providerLabels: Record<PlatformIntegrationConnection['provider'], string> = {
  STRIPE: 'Stripe',
  POKPAY: 'PokPay',
  CLOCK_PMS: 'Clock PMS',
};
type ProviderHealth = { status: 'checking' | 'healthy' | 'unhealthy' | 'unavailable' };
type ProviderHealthResponse = { stripe: ProviderHealth; pokpay: ProviderHealth };
const checkingHealth: ProviderHealthResponse = {
  stripe: { status: 'checking' as const },
  pokpay: { status: 'checking' as const },
};
const unavailableHealth: ProviderHealthResponse = {
  stripe: { status: 'unavailable' as const },
  pokpay: { status: 'unavailable' as const },
};

export function TenantDetailView({
  tenant,
  loading,
  notFound,
  health,
  onTransition,
  onPasswordReset,
  onResolveManualReview,
  onDeleteProperty,
}: {
  tenant: PlatformTenantDetail | null;
  loading: boolean;
  notFound: boolean;
  health: { stripe: ProviderHealth; pokpay: ProviderHealth };
  onTransition?: (status: 'ACTIVE' | 'SUSPENDED') => Promise<void>;
  onPasswordReset?: (userId: string) => Promise<void>;
  onResolveManualReview?: (itemId: string) => Promise<void>;
  onDeleteProperty?: (property: { id: string; name: string }) => Promise<void>;
}) {
  const [transitionPending, setTransitionPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const [deletingPropertyId, setDeletingPropertyId] = useState<string | null>(null);
  const [propertyDeleteError, setPropertyDeleteError] = useState<string | null>(null);
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
        <Heading level={2}>Properties</Heading>
        <Text tone="secondary">
          Deleting a property is permanent and is only available when it has no dependent records.
        </Text>
        {propertyDeleteError ? <Text className={styles.error}>{propertyDeleteError}</Text> : null}
        <div className={detailStyles.providers}>
          {tenant.properties.map((property) => (
            <div className={detailStyles.provider} key={property.id}>
              <strong>{property.name}</strong>
              <Button
                disabled={deletingPropertyId !== null || !onDeleteProperty}
                onClick={async () => {
                  const confirmationName = window.prompt(
                    `Type "${property.name}" to permanently delete this property.`,
                  );
                  if (confirmationName === null || !onDeleteProperty) return;
                  setDeletingPropertyId(property.id);
                  setPropertyDeleteError(null);
                  try {
                    await onDeleteProperty({ ...property, name: confirmationName });
                  } catch (error) {
                    setPropertyDeleteError(
                      error instanceof Error ? error.message : 'Unable to delete property.',
                    );
                  } finally {
                    setDeletingPropertyId(null);
                  }
                }}
                variant="secondary"
              >
                {deletingPropertyId === property.id ? 'Deleting…' : 'Delete property'}
              </Button>
            </div>
          ))}
        </div>
      </Card>
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
        <Heading level={2}>Integration connections</Heading>
        <Text tone="secondary">
          Oversight only — which of this tenant&apos;s own connections are configured, for
          support/troubleshooting. Credentials are never exposed here.
        </Text>
        {tenant.connections.length === 0 ? (
          <Text tone="secondary">No integration connections configured.</Text>
        ) : (
          <div className={detailStyles.providers}>
            {tenant.connections.map((connection) => (
              <div className={detailStyles.provider} key={connection.id}>
                <div>
                  <strong>{connection.name}</strong>
                  <Text tone="secondary">
                    {providerLabels[connection.provider]} ·{' '}
                    {connection.kind === 'PMS' ? 'PMS' : 'Payment'}
                    {connection.lastTestedAt
                      ? ` · last tested ${formatDate(connection.lastTestedAt)}`
                      : ''}
                  </Text>
                </div>
                <div className={detailStyles.badges}>
                  <Badge
                    tone={
                      connection.status === 'CONNECTED'
                        ? 'success'
                        : connection.status === 'FAILED'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {connection.status.toLowerCase()}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <Heading level={2}>Manual review</Heading>
        <Text tone="secondary">
          Clock results MUST could not confidently classify — an unknown result is never treated as
          success automatically.
        </Text>
        {tenant.manualReviewItems.length === 0 ? (
          <Text tone="secondary">Nothing needs review.</Text>
        ) : (
          <div className={detailStyles.providers}>
            {tenant.manualReviewItems.map((item) => (
              <div className={detailStyles.provider} key={item.id}>
                <div>
                  <strong>{categoryLabels[item.category] ?? item.category}</strong>
                  <Text tone="secondary">
                    {item.message}
                    {item.referenceId ? ` · ${item.referenceType} ${item.referenceId}` : ''}
                    {` · ${formatDate(item.createdAt)}`}
                  </Text>
                </div>
                <div className={detailStyles.badges}>
                  <Badge tone={item.status === 'OPEN' ? 'warning' : 'success'}>
                    {item.status.toLowerCase()}
                  </Badge>
                  {item.status === 'OPEN' && onResolveManualReview ? (
                    <Button
                      disabled={resolvingItemId === item.id}
                      onClick={async () => {
                        setResolvingItemId(item.id);
                        try {
                          await onResolveManualReview(item.id);
                        } finally {
                          setResolvingItemId(null);
                        }
                      }}
                      variant="secondary"
                    >
                      {resolvingItemId === item.id ? 'Marking…' : 'Mark reviewed'}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
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
    health === 'healthy'
      ? 'success'
      : health === 'unhealthy'
        ? 'danger'
        : health === 'unavailable'
          ? 'neutral'
          : 'warning';
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
  const [health, setHealth] = useState<ProviderHealthResponse>(checkingHealth);
  const [userEmail, setUserEmail] = useState<string>();

  useEffect(() => {
    void fetchSessionUser()
      .then((user) => setUserEmail(user?.email))
      .catch(() => undefined);
  }, []);

  const refreshTenant = async (tenantId: string) => {
    const result = await loadTenantDetail(tenantId);
    setNotFound(result.notFound);
    setTenant(result.tenant);
    setHealth(result.health);
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
          onResolveManualReview={async (itemId) => {
            if (!tenant) return;
            const response = await fetch(
              `/api/platform/tenants/${tenant.id}/manual-review/${itemId}/resolve`,
              { credentials: 'include', method: 'POST' },
            );
            if (!response.ok) throw new Error('Unable to mark this item reviewed.');
            await refreshTenant(tenant.id);
          }}
          onDeleteProperty={async (property) => {
            if (!tenant) return;
            const response = await fetch(
              `/api/platform/tenants/${tenant.id}/properties/${property.id}`,
              {
                credentials: 'include',
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ confirmationName: property.name }),
              },
            );
            if (response.ok) {
              await refreshTenant(tenant.id);
              return;
            }
            const result = (await response.json().catch(() => null)) as {
              message?: string;
              blockers?: Array<{ resource: string; count: number }>;
            } | null;
            const blockers = result?.blockers
              ?.map((blocker) => `${blocker.count} ${blocker.resource}`)
              .join(', ');
            throw new Error(
              blockers
                ? `Cannot delete this property: ${blockers}.`
                : (result?.message ?? 'Unable to delete property.'),
            );
          }}
        />
      </AppShell>
    </AuthRouteGuard>
  );
}

export async function loadTenantDetail(
  tenantId: string,
  request: typeof fetch = fetch,
): Promise<{
  tenant: PlatformTenantDetail | null;
  notFound: boolean;
  health: ProviderHealthResponse;
}> {
  const [tenantResult, healthResult] = await Promise.allSettled([
    request(`/api/platform/tenants/${tenantId}`, { credentials: 'include' }),
    request('/api/platform/provider-health', { credentials: 'include' }),
  ]);
  if (tenantResult.status === 'rejected') throw new Error('Unable to load tenant.');
  const tenantResponse = tenantResult.value;
  if (tenantResponse.status === 404)
    return { tenant: null, notFound: true, health: checkingHealth };
  if (!tenantResponse.ok) throw new Error('Unable to load tenant.');

  let health: ProviderHealthResponse = unavailableHealth;
  if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
    try {
      health = (await healthResult.value.json()) as ProviderHealthResponse;
    } catch {
      health = unavailableHealth;
    }
  }
  return {
    tenant: (await tenantResponse.json()) as PlatformTenantDetail,
    notFound: false,
    health,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
