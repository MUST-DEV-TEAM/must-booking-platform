'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import styles from './settings.module.css';
import { CheckInOutSettings, BookingRulesSettings, GeneralSettings } from './settings-forms';
import { settingsAreaHref } from './settings-hub';
import {
  settingsAreas,
  type PaymentGateways,
  type Property,
  type SettingsArea,
} from './settings-areas';

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

type EmailBrandingFields = Pick<Property, 'logoUrl' | 'phone' | 'supportEmail'>;

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
}: {
  tenantId: string;
  propertyId: string;
  settingsArea?: SettingsArea;
}) {
  const [emailBranding, setEmailBranding] = useState<EmailBrandingFields | null>(null);
  const [paymentGateways, setPaymentGateways] = useState<PaymentGateways | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [publicWebsiteOrigin, setPublicWebsiteOrigin] = useState('');
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
  const unavailablePaymentProviders = [
    ...(paymentGateways?.stripe && !connectedPaymentProviders.has('STRIPE') ? ['Stripe'] : []),
    ...(paymentGateways?.pokpay && !connectedPaymentProviders.has('POKPAY') ? ['PokPay'] : []),
  ];

  useEffect(() => {
    if (!property) return;
    setEmailBranding({
      logoUrl: property.logoUrl,
      phone: property.phone,
      supportEmail: property.supportEmail,
    });
    setPaymentGateways(property.paymentGateways);
    setPublicWebsiteOrigin(property.publicWebsiteOrigin ?? '');
  }, [property]);

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
        (current) => ({ property: updated, planName: current?.planName ?? null }),
      );
      toast.success('Settings saved.');
    },
    onError: () => toast.error('Unable to save settings.'),
  });

  async function save(update: Partial<Property>) {
    if (!property || Object.keys(update).length === 0) return;
    saveMutation.mutate(update);
  }

  const paymentGatewaysMutation = useMutation({
    mutationFn: async (update: PaymentGateways) => {
      const response = await fetch(`${base}/properties/${propertyId}/payment-gateways`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error('Unable to save payment methods.');
      return update;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<{ property: Property; planName: string | null }>(
        ['dashboard', 'settings', tenantId, propertyId],
        (current) =>
          current
            ? { ...current, property: { ...current.property, paymentGateways: updated } }
            : current,
      );
      toast.success('Payment methods saved.');
    },
    onError: () => toast.error('Unable to save payment methods.'),
  });

  function savePaymentGateways(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentGateways) return;
    paymentGatewaysMutation.mutate(paymentGateways);
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
        (current) => (current ? { ...current, property: updated } : current),
      );
      toast.success('Public website origin saved.');
    },
    onError: () => toast.error('Unable to save the public website origin.'),
  });

  function savePublicWebsiteOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    publicWebsiteOriginMutation.mutate(publicWebsiteOrigin.trim());
  }

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

  function saveEmailBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!property || !emailBranding) return;
    const update = (Object.keys(emailBranding) as Array<keyof EmailBrandingFields>).reduce<
      Partial<Property>
    >(
      (result, key) =>
        emailBranding[key] === property[key] ? result : { ...result, [key]: emailBranding[key] },
      {},
    );
    void save(update);
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
  if (!property || !emailBranding || !paymentGateways)
    return (
      <section aria-label="Loading settings">
        <Text>Loading settings…</Text>
      </section>
    );

  return (
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
          property={property}
          saving={saveMutation.isPending}
          onSave={(update) => void save(update)}
        />
      </SettingsAreaPanel>
      <SettingsAreaPanel activeArea={settingsArea} area="booking-rules">
        <BookingRulesSettings
          property={property}
          saving={saveMutation.isPending}
          onSave={(update) => void save(update)}
        />
      </SettingsAreaPanel>
      <SettingsAreaPanel activeArea={settingsArea} area="check-in-out">
        <CheckInOutSettings
          property={property}
          saving={saveMutation.isPending}
          onSave={(update) => void save(update)}
        />
      </SettingsAreaPanel>
      <SettingsAreaPanel activeArea={settingsArea} area="branding">
        <Card>
          <Stack gap="md">
            <Heading level={2}>Email branding</Heading>
            <Text tone="secondary">
              Booking emails use this hotel name, logo, and contact information. Leave any optional
              field empty to omit it from the email.
            </Text>
            <form className="must-stack must-stack--md" onSubmit={saveEmailBranding}>
              <label className="must-field">
                <span className="must-field__label">Logo URL</span>
                <input
                  className="must-input"
                  aria-label="Logo URL"
                  type="url"
                  placeholder="https://your-hotel-site.com/logo.png"
                  value={emailBranding.logoUrl ?? ''}
                  onChange={(event) =>
                    setEmailBranding({ ...emailBranding, logoUrl: event.target.value || null })
                  }
                />
              </label>
              <label className="must-field">
                <span className="must-field__label">Support email</span>
                <input
                  className="must-input"
                  aria-label="Support email"
                  type="email"
                  value={emailBranding.supportEmail ?? ''}
                  onChange={(event) =>
                    setEmailBranding({ ...emailBranding, supportEmail: event.target.value || null })
                  }
                />
              </label>
              <label className="must-field">
                <span className="must-field__label">Phone</span>
                <input
                  className="must-input"
                  aria-label="Hotel phone"
                  type="tel"
                  value={emailBranding.phone ?? ''}
                  onChange={(event) =>
                    setEmailBranding({ ...emailBranding, phone: event.target.value || null })
                  }
                />
              </label>
              <button
                className="must-button must-button--primary"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 aria-hidden="true" size={16} /> Saving…
                  </>
                ) : (
                  'Save email branding'
                )}
              </button>
            </form>
          </Stack>
        </Card>
      </SettingsAreaPanel>

      <SettingsAreaPanel activeArea={settingsArea} area="payments">
        <Card>
          <Stack gap="md">
            <Heading level={2}>Payment methods</Heading>
            <Text tone="secondary">
              Choose which payment methods guests and staff can use for bookings at this property.
              Stripe and PokPay also need a working connection under Integrations.
            </Text>
            <a
              className="must-button must-button--secondary"
              href={dashboardSectionHref(tenantId, propertyId, 'payments')}
            >
              Open payment operations
            </a>
            {unavailablePaymentProviders.length > 0 ? (
              <div role="alert">
                <Text>
                  {unavailablePaymentProviders.join(' and ')}{' '}
                  {unavailablePaymentProviders.length === 1 ? 'is' : 'are'} enabled but not
                  connected and assigned to this property. Guests will not be offered{' '}
                  {unavailablePaymentProviders.join(' or ')} until that is fixed in Integrations.
                </Text>
              </div>
            ) : null}
            <form className="must-stack must-stack--md" onSubmit={savePaymentGateways}>
              <label className="must-field">
                <input
                  type="checkbox"
                  checked={paymentGateways.payAtHotel}
                  onChange={(event) =>
                    setPaymentGateways({ ...paymentGateways, payAtHotel: event.target.checked })
                  }
                />
                <span className="must-field__label">Pay at hotel</span>
              </label>
              <label className="must-field">
                <input
                  type="checkbox"
                  checked={paymentGateways.stripe}
                  onChange={(event) =>
                    setPaymentGateways({ ...paymentGateways, stripe: event.target.checked })
                  }
                />
                <span className="must-field__label">Stripe</span>
              </label>
              <label className="must-field">
                <input
                  type="checkbox"
                  checked={paymentGateways.pokpay}
                  onChange={(event) =>
                    setPaymentGateways({ ...paymentGateways, pokpay: event.target.checked })
                  }
                />
                <span className="must-field__label">PokPay</span>
              </label>
              <button
                className="must-button must-button--primary"
                disabled={paymentGatewaysMutation.isPending}
              >
                {paymentGatewaysMutation.isPending ? (
                  <>
                    <Loader2 aria-hidden="true" size={16} /> Saving…
                  </>
                ) : (
                  'Save payment methods'
                )}
              </button>
            </form>
          </Stack>
        </Card>
      </SettingsAreaPanel>

      <SettingsAreaPanel activeArea={settingsArea} area="managed-pages">
        <Card>
          <Stack gap="md">
            <Heading level={2}>Connect WordPress site</Heading>
            <Text tone="secondary">
              Generate a one-time connection code and paste it into the MUST Booking plugin's
              settings screen on your WordPress site to link it to this property.
            </Text>
            {property.wordpressConnectedAt && (
              <Text tone="secondary">
                Connected on {new Date(property.wordpressConnectedAt).toLocaleString()}
              </Text>
            )}
            <form className="must-stack must-stack--md" onSubmit={savePublicWebsiteOrigin}>
              <label className="must-field">
                <span className="must-field__label">Public website origin</span>
                <input
                  className="must-input"
                  aria-label="Public website origin"
                  type="url"
                  placeholder="https://your-hotel-site.com"
                  value={publicWebsiteOrigin}
                  onChange={(event) => setPublicWebsiteOrigin(event.target.value)}
                />
              </label>
              <Text tone="secondary">
                Must exactly match your WordPress site&apos;s address (scheme + domain, no path).
                Required before guests can complete a booking through the connected site — without
                it, booking creation is rejected.
              </Text>
              <button
                className="must-button must-button--primary"
                disabled={publicWebsiteOriginMutation.isPending}
              >
                {publicWebsiteOriginMutation.isPending ? (
                  <>
                    <Loader2 aria-hidden="true" size={16} /> Saving…
                  </>
                ) : (
                  'Save public website origin'
                )}
              </button>
            </form>
            {pairingCode && (
              <Stack gap="sm">
                <label className="must-field">
                  <span className="must-field__label">Connection code</span>
                  <input
                    className="must-input"
                    aria-label="Connection code"
                    readOnly
                    value={pairingCode}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <button
                  className="must-button"
                  type="button"
                  onClick={() => void copyPairingCode()}
                >
                  Copy code
                </button>
                <Text tone="secondary">
                  Expires in 30 minutes and can only be used once. Generating a new code invalidates
                  this one.
                </Text>
              </Stack>
            )}
            <button
              className="must-button must-button--primary"
              type="button"
              disabled={wordpressPairingMutation.isPending}
              onClick={() => wordpressPairingMutation.mutate()}
            >
              {wordpressPairingMutation.isPending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} /> Generating…
                </>
              ) : property.wordpressConnectedAt || pairingCode ? (
                'Generate new code'
              ) : (
                'Generate connection code'
              )}
            </button>
          </Stack>
        </Card>
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
  );
}
