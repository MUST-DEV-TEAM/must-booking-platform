'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { BrandingSettings, PaymentSettings, WebsiteSettings } from './settings-connection-forms';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';
import { DisplayCurrenciesSettings } from './display-currencies-settings';
import { IntegrationSettings } from './integration-settings';
import { toast } from 'sonner';
import { CheckInOutSettings, BookingRulesSettings, GeneralSettings } from './settings-forms';
import { settingsAreaHref } from './settings-hub';
import { settingsAreas, type Property, type SettingsArea } from './settings-areas';

export { isSettingsArea, settingsAreas, type SettingsArea } from './settings-areas';
export { SettingsHub } from './settings-hub';

type Connection = {
  id: string;
  kind: 'PAYMENT' | 'PMS';
  provider: 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
  status: 'PENDING' | 'CONNECTED' | 'FAILED';
};
type PropertyConnection = { connectionId: string; enabled: boolean };

type PlanUsage = { plan: { name: string } };

function dashboardSectionHref(tenantId: string, propertyId: string, section: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${section}`;
}

function SettingsAreaPanel({
  area,
  activeArea,
  children,
}: {
  area: SettingsArea;
  activeArea?: SettingsArea;
  children: ReactNode;
}) {
  return !activeArea || activeArea === area ? children : null;
}

export function DashboardSettings({
  tenantId,
  propertyId,
  settingsArea,
  canWrite = false,
  canManagePhotos = false,
  onPropertySaved,
}: {
  tenantId: string;
  propertyId: string;
  settingsArea?: SettingsArea;
  canWrite?: boolean;
  canManagePhotos?: boolean;
  onPropertySaved?: (property: Property) => void;
}) {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const base = `/api/tenants/${tenantId}`;
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['dashboard', 'settings', tenantId, propertyId],
    queryFn: async () => {
      const [propertiesResponse, planResponse, connectionsResponse, propertyConnectionsResponse] =
        await Promise.all([
          fetch(`${base}/properties`, { credentials: 'include' }),
          fetch(`${base}/plan-usage`, { credentials: 'include' }),
          fetch(`${base}/integration-connections`, { credentials: 'include' }),
          fetch(`${base}/properties/${propertyId}/integration-connections`, {
            credentials: 'include',
          }),
        ]);
      if (!propertiesResponse.ok || !connectionsResponse.ok || !propertyConnectionsResponse.ok)
        throw new Error('Unable to load property settings.');
      const properties = (await propertiesResponse.json()) as Property[];
      const property = properties.find((item) => item.id === propertyId);
      if (!property) throw new Error('Property settings were not found.');
      return {
        property,
        planName: planResponse.ok ? ((await planResponse.json()) as PlanUsage).plan.name : null,
        connections: (await connectionsResponse.json()) as Connection[],
        propertyConnections: (await propertyConnectionsResponse.json()) as PropertyConnection[],
      };
    },
  });
  const property = settingsQuery.data?.property ?? null;
  const planName = settingsQuery.data?.planName ?? null;
  const connectedPaymentProviders = new Set(
    (settingsQuery.data?.connections ?? [])
      .filter(
        (connection) =>
          connection.kind === 'PAYMENT' &&
          connection.status === 'CONNECTED' &&
          (settingsQuery.data?.propertyConnections ?? []).some(
            (assignment) => assignment.connectionId === connection.id && assignment.enabled,
          ),
      )
      .map((connection) => connection.provider),
  );
  const clockManaged = (settingsQuery.data?.connections ?? []).some(
    (c) =>
      c.provider === 'CLOCK_PMS' &&
      c.status === 'CONNECTED' &&
      (settingsQuery.data?.propertyConnections ?? []).some(
        (a) => a.connectionId === c.id && a.enabled,
      ),
  );
  const refreshSavedViews = () => {
    void queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === 'dashboard' &&
        q.queryKey.includes(tenantId) &&
        ['settings-hub', 'overview', 'hotels'].includes(String(q.queryKey[1])),
    });
  };
  const saveMutation = useMutation({
    mutationFn: async (update: Partial<Property>) => {
      const response = await fetch(`${base}/properties/${propertyId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error('Unable to save settings.');
      return (await response.json()) as Property;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<{ property: Property; planName: string | null }>(
        ['dashboard', 'settings', tenantId, propertyId],
        (current) =>
          current ? { ...current, property: { ...current.property, ...updated } } : current,
      );
      refreshSavedViews();
      onPropertySaved?.(updated);
      toast.success('Settings saved.');
    },
    onError: () => toast.error('Unable to save settings.'),
  });

  async function save(update: Partial<Property>) {
    if (!property || Object.keys(update).length === 0) return;
    saveMutation.mutate(update);
  }

  const publicWebsiteOriginMutation = useMutation({
    mutationFn: async (origin: string) => {
      const response = await fetch(`${base}/properties/${propertyId}/public-website-origin`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicWebsiteOrigin: origin || null }),
      });
      if (!response.ok) throw new Error('Unable to save the public website origin.');
      return (await response.json()) as Property;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<{ property: Property; planName: string | null }>(
        ['dashboard', 'settings', tenantId, propertyId],
        (current) =>
          current ? { ...current, property: { ...current.property, ...updated } } : current,
      );
      refreshSavedViews();
      toast.success('Public website origin saved.');
    },
    onError: () => toast.error('Unable to save the public website origin.'),
  });

  const wordpressPairingMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/properties/${propertyId}/wordpress-pairing`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to generate a connection code.');
      return (await response.json()) as { code: string };
    },
    onSuccess: (result) => {
      setPairingCode(result.code);
      toast.success('Connection code generated.');
    },
    onError: () => toast.error('Unable to generate a connection code.'),
  });

  async function copyPairingCode() {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      toast.success('Code copied.');
    } catch {
      toast.error('Unable to copy the code. Select and copy it manually.');
    }
  }

  if (settingsQuery.isPending)
    return (
      <section aria-label="Loading settings">
        <Text>Loading settings…</Text>
      </section>
    );
  if (settingsQuery.isError)
    return (
      <Card>
        <Text>{settingsQuery.error.message}</Text>
        <button className="must-button" type="button" onClick={() => void settingsQuery.refetch()}>
          Retry
        </button>
      </Card>
    );
  if (!property)
    return (
      <section aria-label="Loading settings">
        <Text>Loading settings…</Text>
      </section>
    );

  return (
    <UnsavedChangesBoundary>
      <Stack gap="lg">
        {settingsArea ? (
          <div className="flex flex-col gap-1">
            <a
              className="w-fit text-sm font-semibold text-muted-foreground no-underline hover:underline"
              href={settingsAreaHref(tenantId, propertyId)}
            >
              ← Back to Settings overview
            </a>
            <h1 className="m-0 text-2xl font-extrabold tracking-tight">
              {settingsAreas.find((area) => area.key === settingsArea)?.label ?? 'Settings'}
            </h1>
            <p className="m-0 text-muted-foreground">
              {settingsAreas.find((area) => area.key === settingsArea)?.description}
            </p>
          </div>
        ) : null}

        <SettingsAreaPanel activeArea={settingsArea} area="general">
          <GeneralSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
          />
          <DisplayCurrenciesSettings
            tenantId={tenantId}
            propertyId={propertyId}
            canWrite={canWrite}
            refreshKey={property.defaultCurrency}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="booking-rules">
          <BookingRulesSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="check-in-out">
          <CheckInOutSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="branding">
          <BrandingSettings
            property={property}
            tenantId={tenantId}
            canManagePhotos={canManagePhotos}
            canWrite={canWrite}
            saving={saveMutation.isPending}
            onSave={save}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="integrations">
          <IntegrationSettings tenantId={tenantId} propertyId={propertyId} canWrite={canWrite} />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="payments">
          <PaymentSettings
            property={property}
            canWrite={canWrite}
            saving={saveMutation.isPending}
            connectedProviders={connectedPaymentProviders}
            tenantId={tenantId}
            onPropertySave={(update, gateways) =>
              saveMutation.mutate({ ...update, paymentGateways: gateways })
            }
            connection={settingsQuery.data?.connections.find(
              (c) =>
                c.provider === 'POKPAY' &&
                settingsQuery.data?.propertyConnections.some(
                  (a) => a.connectionId === c.id && a.enabled,
                ),
            )}
            assigned={settingsQuery.data?.propertyConnections.some(
              (a) =>
                a.enabled &&
                a.connectionId ===
                  settingsQuery.data?.connections.find(
                    (c) =>
                      c.provider === 'POKPAY' &&
                      settingsQuery.data?.propertyConnections.some(
                        (a) => a.connectionId === c.id && a.enabled,
                      ),
                  )?.id,
            )}
            onConnectionChanged={async () => {
              await settingsQuery.refetch();
              refreshSavedViews();
            }}
            operationsHref={dashboardSectionHref(tenantId, propertyId, 'payments')}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="managed-pages">
          <WebsiteSettings
            property={property}
            canWrite={canWrite}
            saving={publicWebsiteOriginMutation.isPending}
            clockManaged={clockManaged}
            onSave={(origin) => publicWebsiteOriginMutation.mutate(origin)}
            pairingCode={pairingCode}
            pairing={wordpressPairingMutation.isPending}
            onPair={() => wordpressPairingMutation.mutate()}
            onCopy={() => void copyPairingCode()}
          />
        </SettingsAreaPanel>

        <SettingsAreaPanel activeArea={settingsArea} area="billing">
          <Card>
            <Stack gap="md">
              <Heading level={2}>Billing account</Heading>
              <Text tone="secondary">Current plan: {planName ?? 'Loading…'}</Text>
              <button
                className="must-button must-button--secondary"
                disabled
                title="Platform billing is not available yet"
              >
                Platform billing is not available yet
              </button>
            </Stack>
          </Card>
        </SettingsAreaPanel>
      </Stack>
    </UnsavedChangesBoundary>
  );
}
