'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { BrandingSettings, PaymentSettings, WebsiteSettings } from './settings-connection-forms';
import { PlanUsageSettings, type PlanUsageData } from './plan-usage-settings';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { UnsavedChangesBoundary } from '../../components/ui/unsaved-changes';
import { IntegrationSettings } from './integration-settings';
import { toast } from 'sonner';
import {
  BankTransferSettings,
  BookingRulesSettings,
  CheckInOutSettings,
  GeneralSettings,
  ScheduledEmailSettings,
} from './settings-forms';
import { type Property } from './settings-areas';
import { type SettingsTab } from './settings-registry';

export { isSettingsArea, settingsAreas, type SettingsArea } from './settings-areas';
export { SettingsOverview } from './settings-overview';
export { SettingsFrame } from './settings-frame';

type Connection = {
  id: string;
  kind: 'PAYMENT' | 'PMS';
  provider: 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
  status: 'PENDING' | 'CONNECTED' | 'FAILED';
};
type PropertyConnection = { connectionId: string; enabled: boolean };

function dashboardSectionHref(tenantId: string, propertyId: string, section: string) {
  return `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${section}`;
}

/** Shows its form on its tab; with no tab (tests, embedding) every form is shown. */
function SettingsAreaPanel({
  area,
  activeArea,
  children,
}: {
  area: SettingsTab;
  activeArea?: SettingsTab;
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
  settingsArea?: SettingsTab;
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
      const planUsage = planResponse.ok ? ((await planResponse.json()) as PlanUsageData) : null;
      return {
        property,
        planUsage,
        connections: (await connectionsResponse.json()) as Connection[],
        propertyConnections: (await propertyConnectionsResponse.json()) as PropertyConnection[],
      };
    },
  });
  const property = settingsQuery.data?.property ?? null;
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
      queryClient.setQueryData<{ property: Property }>(
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
      queryClient.setQueryData<{ property: Property }>(
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

  if (settingsQuery.isError)
    return (
      <ErrorPanel
        title="Settings are unavailable"
        description={settingsQuery.error.message}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  if (settingsQuery.isPending || !property)
    return (
      <section aria-label="Loading settings">
        <ListSkeleton rows={4} />
      </section>
    );

  return (
    <UnsavedChangesBoundary>
      <div className="flex flex-col gap-6">
        <SettingsAreaPanel activeArea={settingsArea} area="profile">
          <GeneralSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
            tenantId={tenantId}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="booking-rules">
          <BookingRulesSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
            tenantId={tenantId}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="policies">
          <CheckInOutSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
          />
          <ScheduledEmailSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="contact-brand">
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
          <IntegrationSettings
            tenantId={tenantId}
            propertyId={propertyId}
            canWrite={canWrite}
            website={{
              origin: property.publicWebsiteOrigin ?? null,
              pairedAt: property.wordpressConnectedAt ?? null,
              form: (
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
              ),
            }}
          />
        </SettingsAreaPanel>
        <SettingsAreaPanel activeArea={settingsArea} area="payment-methods">
          <PaymentSettings
            property={property}
            canWrite={canWrite}
            saving={saveMutation.isPending}
            connectedProviders={connectedPaymentProviders}
            clockConnected={clockManaged}
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
            operationsHref={dashboardSectionHref(tenantId, propertyId, 'payments')}
          />
          <BankTransferSettings
            canWrite={canWrite}
            property={property}
            saving={saveMutation.isPending}
            onSave={(update) => void save(update)}
          />
        </SettingsAreaPanel>

        <SettingsAreaPanel activeArea={settingsArea} area="plan-usage">
          <PlanUsageSettings
            data={settingsQuery.data?.planUsage ?? null}
            hotel={{ rooms: property.roomCount, staff: property.staffCount }}
          />
        </SettingsAreaPanel>
      </div>
    </UnsavedChangesBoundary>
  );
}
