'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';

type Property = { id: string; name: string };
type ConnectionKind = 'PAYMENT' | 'PMS';
type ConnectionProvider = 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';
type Connection = {
  id: string;
  kind: ConnectionKind;
  provider: ConnectionProvider;
  name: string;
  status: 'PENDING' | 'CONNECTED' | 'FAILED';
  lastTestedAt: string | null;
  lastTestResult: string | null;
};
type PropertyConnection = {
  connectionId: string;
  kind: ConnectionKind;
  provider: ConnectionProvider;
  name: string;
  enabled: boolean;
};

const providerLabels: Record<ConnectionProvider, string> = {
  STRIPE: 'Stripe',
  POKPAY: 'PokPay',
  CLOCK_PMS: 'Clock PMS',
};

// Real per-provider credential shape, matching each provider's actual parser
// (clock-credentials.ts, pokpay-payment.provider.ts, stripe-connection-tester.ts)
// instead of a generic key/value list. Milestone 11.5 Task 11.
const credentialFieldsByProvider: Record<
  ConnectionProvider,
  Array<{ key: string; label: string; secret?: boolean }>
> = {
  STRIPE: [
    { key: 'secretKey', label: 'Secret key', secret: true },
    { key: 'webhookSecret', label: 'Webhook secret', secret: true },
  ],
  POKPAY: [
    { key: 'keyId', label: 'Key ID' },
    { key: 'keySecret', label: 'Key secret', secret: true },
    { key: 'merchantId', label: 'Merchant ID' },
    { key: 'webhookUrl', label: 'Webhook URL' },
  ],
  CLOCK_PMS: [
    { key: 'host', label: 'Host' },
    { key: 'accountId', label: 'Account ID' },
    { key: 'subscriptionId', label: 'Subscription ID' },
    { key: 'apiUser', label: 'API user' },
    { key: 'apiKey', label: 'API key', secret: true },
  ],
};

export function IntegrationsManagement({
  tenantId,
  properties,
}: {
  tenantId: string;
  properties: Property[];
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ConnectionKind>('PAYMENT');
  const [provider, setProvider] = useState<ConnectionProvider>('STRIPE');
  const [name, setName] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  const connectionsQueryKey = ['dashboard', 'integration-connections', tenantId] as const;
  const connectionsQuery = useQuery({
    queryKey: connectionsQueryKey,
    queryFn: async (): Promise<Connection[]> => {
      const response = await fetch(`/api/tenants/${tenantId}/integration-connections`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to load integration connections.');
      return (await response.json()) as Connection[];
    },
  });

  // A connection can be assigned to any subset of the tenant's properties, so
  // load each property's assignment list in parallel rather than assuming one
  // fixed property (this component lives in the tenant-scoped Hotels section,
  // not a single property's Settings page).
  const propertyConnectionQueries = useQueries({
    queries: properties.map((property) => ({
      queryKey: ['dashboard', 'integration-connections', 'property', tenantId, property.id],
      queryFn: async (): Promise<PropertyConnection[]> => {
        const response = await fetch(
          `/api/tenants/${tenantId}/properties/${property.id}/integration-connections`,
          { credentials: 'include' },
        );
        if (!response.ok) throw new Error('Unable to load property connections.');
        return (await response.json()) as PropertyConnection[];
      },
    })),
  });

  const invalidatePropertyConnections = () =>
    Promise.all(
      properties.map((property) =>
        queryClient.invalidateQueries({
          queryKey: ['dashboard', 'integration-connections', 'property', tenantId, property.id],
        }),
      ),
    );

  const createMutation = useMutation({
    mutationFn: async (input: {
      kind: ConnectionKind;
      provider: ConnectionProvider;
      name: string;
      credentials: Record<string, string>;
      form: HTMLFormElement;
    }) => {
      const response = await fetch(`/api/tenants/${tenantId}/integration-connections`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: input.kind,
          provider: input.provider,
          name: input.name,
          credentials: input.credentials,
        }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to create the connection.'));
    },
    onSuccess: (_result, { form }) => {
      form.reset();
      setName('');
      setCredentials({});
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
      toast.success('Connection created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to create the connection.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/integration-connections/${connectionId}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to delete the connection.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
      void invalidatePropertyConnections();
      toast.success('Connection deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete the connection.'),
  });

  const testMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/integration-connections/${connectionId}/test`,
        { method: 'POST', credentials: 'include' },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to test the connection.'));
      return (await response.json()) as Connection;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
      if (result.status === 'CONNECTED') toast.success(result.lastTestResult ?? 'Connected.');
      else toast.error(result.lastTestResult ?? 'Connection test failed.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to test the connection.'),
  });

  const assignMutation = useMutation({
    mutationFn: async ({
      connectionId,
      propertyId,
      enabled,
    }: {
      connectionId: string;
      propertyId: string;
      enabled: boolean;
    }) => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/integration-connections/${connectionId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update this property.'));
    },
    onSuccess: () => {
      void invalidatePropertyConnections();
      toast.success('Property assignment updated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update this property.'),
  });

  const connections = connectionsQuery.data ?? [];
  // Map: connectionId -> Set of propertyIds where it's enabled.
  const enabledPropertyIdsByConnectionId = new Map<string, Set<string>>();
  properties.forEach((property, index) => {
    const data = propertyConnectionQueries[index]?.data ?? [];
    for (const entry of data) {
      if (!entry.enabled) continue;
      const set = enabledPropertyIdsByConnectionId.get(entry.connectionId) ?? new Set<string>();
      set.add(property.id);
      enabledPropertyIdsByConnectionId.set(entry.connectionId, set);
    }
  });
  const clockPropertiesByConnectionId = new Map<string, Property[]>();
  for (const [connectionId, propertyIds] of enabledPropertyIdsByConnectionId) {
    const connection = connections.find((entry) => entry.id === connectionId);
    if (connection?.provider !== 'CLOCK_PMS') continue;
    clockPropertiesByConnectionId.set(
      connectionId,
      properties.filter((property) => propertyIds.has(property.id)),
    );
  }

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedCredentials: Record<string, string> = {};
    for (const field of credentialFieldsByProvider[provider]) {
      const value = credentials[field.key];
      if (value) trimmedCredentials[field.key] = field.secret ? value : value.trim();
    }
    createMutation.mutate({
      kind,
      provider,
      name: trimmedName,
      credentials: trimmedCredentials,
      form,
    });
  }

  return (
    <Stack gap="md">
      <Text tone="secondary">
        Connect your own Stripe, PokPay, or Clock PMS account. Each connection can be assigned to
        any of your properties; payment connections may be enabled on several at once, while a
        property can only have one active PMS connection.
      </Text>
      {connectionsQuery.isPending ? <Text>Loading connections…</Text> : null}
      {connectionsQuery.isError ? (
        <Card>
          <Text>{connectionsQuery.error.message}</Text>
          <button
            className="must-button"
            type="button"
            onClick={() => void connectionsQuery.refetch()}
          >
            Retry
          </button>
        </Card>
      ) : null}
      {!connectionsQuery.isPending && !connectionsQuery.isError ? (
        <>
          {connections.length === 0 ? <Text>No connections yet.</Text> : null}
          {connections.map((connection) => {
            const enabledPropertyIds =
              enabledPropertyIdsByConnectionId.get(connection.id) ?? new Set<string>();
            return (
              <Card key={connection.id}>
                <Heading level={3}>{connection.name}</Heading>
                <Text tone="secondary">
                  {providerLabels[connection.provider]} ·{' '}
                  {connection.kind === 'PMS' ? 'PMS' : 'Payment'} · {connection.status}
                </Text>
                {connection.lastTestResult ? (
                  <Text tone="secondary">{connection.lastTestResult}</Text>
                ) : null}
                <fieldset>
                  <legend>Assigned properties</legend>
                  {properties.map((property) => (
                    <label className="must-field" key={property.id}>
                      <input
                        className="must-input"
                        type="checkbox"
                        checked={enabledPropertyIds.has(property.id)}
                        onChange={(event) =>
                          assignMutation.mutate({
                            connectionId: connection.id,
                            propertyId: property.id,
                            enabled: event.target.checked,
                          })
                        }
                      />
                      {property.name}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="must-button must-button--secondary"
                  type="button"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate(connection.id)}
                >
                  Test connection
                </button>
                <button
                  className="must-button must-button--danger"
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(connection.id)}
                >
                  Delete
                </button>
                {clockPropertiesByConnectionId.get(connection.id)?.map((property) => (
                  <ClockCatalogSync key={property.id} tenantId={tenantId} property={property} />
                ))}
              </Card>
            );
          })}
        </>
      ) : null}
      <Card>
        <Heading level={3}>Add a connection</Heading>
        <form className="must-stack must-stack--md" onSubmit={submitConnection}>
          <label className="must-field">
            <span className="must-field__label">Type</span>
            <select
              className="must-input"
              value={kind}
              onChange={(event) => {
                const nextKind = event.target.value as ConnectionKind;
                setKind(nextKind);
                setProvider(nextKind === 'PMS' ? 'CLOCK_PMS' : 'STRIPE');
                setCredentials({});
              }}
            >
              <option value="PAYMENT">Payment gateway</option>
              <option value="PMS">Property Management System</option>
            </select>
          </label>
          <label className="must-field">
            <span className="must-field__label">Provider</span>
            <select
              className="must-input"
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as ConnectionProvider);
                setCredentials({});
              }}
            >
              {kind === 'PMS' ? (
                <option value="CLOCK_PMS">Clock PMS</option>
              ) : (
                <>
                  <option value="STRIPE">Stripe</option>
                  <option value="POKPAY">PokPay</option>
                </>
              )}
            </select>
          </label>
          <label className="must-field">
            <span className="must-field__label">Name</span>
            <input
              className="must-input"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Main Stripe account"
            />
          </label>
          <fieldset>
            <legend>Credentials</legend>
            {credentialFieldsByProvider[provider].map((field) => (
              <label className="must-field" key={field.key}>
                <span className="must-field__label">{field.label}</span>
                <input
                  className="must-input"
                  type={field.secret ? 'password' : 'text'}
                  required
                  value={credentials[field.key] ?? ''}
                  onChange={(event) =>
                    setCredentials((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </fieldset>
          <button className="must-button must-button--primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Add connection'}
          </button>
        </form>
      </Card>
    </Stack>
  );
}

type ClockCatalogMapping = {
  id: string;
  entityType: 'ROOM_TYPE' | 'ROOM';
  externalEntityId: string;
  externalParentId: string | null;
  externalName: string;
  syncStatus: 'PROPOSED' | 'CONFIRMED' | 'REJECTED';
  localEntityId: string | null;
};
type ClockPolicyCatalog = {
  propertyFreeCancellationDays: number;
  policies: Array<{ id: string; name: string; freeCancellationDaysBeforeArrival: number }>;
  ratePlans: Array<{ id: string; name: string; cancellationPolicyId: string | null }>;
};

function ClockCatalogSync({ tenantId, property }: { tenantId: string; property: Property }) {
  const queryClient = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${property.id}/clock-catalog`;
  const mappingsQueryKey = ['dashboard', 'clock-catalog-mappings', tenantId, property.id] as const;

  const mappingsQuery = useQuery({
    queryKey: mappingsQueryKey,
    queryFn: async (): Promise<ClockCatalogMapping[]> => {
      const response = await fetch(`${base}/mappings`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load Clock catalog mappings.');
      return (await response.json()) as ClockCatalogMapping[];
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/sync`, { method: 'POST', credentials: 'include' });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to sync the Clock catalog.'));
      return (await response.json()) as { proposed: number; updated: number };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKey });
      toast.success(`Synced: ${result.proposed} new, ${result.updated} updated.`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to sync the Clock catalog.'),
  });

  const decisionMutation = useMutation({
    mutationFn: async ({
      mappingId,
      decision,
    }: {
      mappingId: string;
      decision: 'confirm' | 'reject';
    }) => {
      const response = await fetch(`${base}/mappings/${mappingId}/${decision}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update this mapping.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKey });
      toast.success('Mapping updated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update this mapping.'),
  });

  const proposed = (mappingsQuery.data ?? []).filter(
    (mapping) => mapping.syncStatus === 'PROPOSED',
  );

  return (
    <Card>
      <Heading level={3}>Clock catalog sync — {property.name}</Heading>
      <Text tone="secondary">
        Pulls room types and rooms from Clock. Nothing is applied to your local catalog until you
        confirm each one below.
      </Text>
      <button
        className="must-button must-button--primary"
        type="button"
        disabled={syncMutation.isPending}
        onClick={() => syncMutation.mutate()}
      >
        {syncMutation.isPending ? 'Syncing…' : 'Sync catalog from Clock'}
      </button>
      {mappingsQuery.isPending ? <Text>Loading mappings…</Text> : null}
      {proposed.length === 0 && !mappingsQuery.isPending ? (
        <Text tone="secondary">No pending proposals.</Text>
      ) : null}
      {proposed.map((mapping) => (
        <div key={mapping.id} className="must-field">
          <Text>
            {mapping.entityType === 'ROOM_TYPE' ? 'Room type' : 'Room'}: {mapping.externalName}
          </Text>
          <button
            className="must-button must-button--primary"
            type="button"
            disabled={decisionMutation.isPending}
            onClick={() => decisionMutation.mutate({ mappingId: mapping.id, decision: 'confirm' })}
          >
            Confirm
          </button>
          <button
            className="must-button must-button--secondary"
            type="button"
            disabled={decisionMutation.isPending}
            onClick={() => decisionMutation.mutate({ mappingId: mapping.id, decision: 'reject' })}
          >
            Reject
          </button>
        </div>
      ))}
      <ClockCancellationPolicies base={base} tenantId={tenantId} propertyId={property.id} />
    </Card>
  );
}

function ClockCancellationPolicies({
  base,
  tenantId,
  propertyId,
}: {
  base: string;
  tenantId: string;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const key = ['dashboard', 'clock-cancellation-policies', tenantId, propertyId] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<ClockPolicyCatalog> => {
      const response = await fetch(`${base}/cancellation-policies`, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load cancellation policies.');
      return (await response.json()) as ClockPolicyCatalog;
    },
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: async (body: { name: string; freeCancellationDaysBeforeArrival: number }) => {
      const response = await fetch(`${base}/cancellation-policies`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to create cancellation policy.'));
    },
    onSuccess: () => {
      refresh();
      toast.success('Cancellation policy created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to create cancellation policy.'),
  });
  const update = useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { name: string; freeCancellationDaysBeforeArrival: number };
    }) => {
      const response = await fetch(`${base}/cancellation-policies/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update cancellation policy.'));
    },
    onSuccess: () => {
      refresh();
      toast.success('Cancellation policy saved.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update cancellation policy.'),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${base}/cancellation-policies/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to delete cancellation policy.'));
    },
    onSuccess: () => {
      refresh();
      toast.success('Cancellation policy deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete cancellation policy.'),
  });
  const assign = useMutation({
    mutationFn: async ({
      ratePlanId,
      cancellationPolicyId,
    }: {
      ratePlanId: string;
      cancellationPolicyId: string | null;
    }) => {
      const response = await fetch(`${base}/cancellation-policies/rate-plans/${ratePlanId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancellationPolicyId }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to assign cancellation policy.'));
    },
    onSuccess: () => {
      refresh();
      toast.success('Cancellation policy assigned.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to assign cancellation policy.'),
  });
  const catalog = query.data;
  if (query.isPending) return <Text>Loading named cancellation policies…</Text>;
  if (!catalog) return <Text tone="secondary">Cancellation policies are unavailable.</Text>;
  const policies = catalog.policies ?? [];
  const ratePlans = catalog.ratePlans ?? [];
  const propertyWindow = catalog.propertyFreeCancellationDays ?? 0;
  const quickStarts = [
    ['Flexible', 3],
    ['Standard', 7],
    ['Moderate', 14],
    ['Strict', 30],
    ['Non-refundable', 0],
  ] as const;
  return (
    <section className="must-field" aria-label="Named cancellation policies">
      <Text>
        <strong>Named cancellation policies</strong>
      </Text>
      <Text tone="secondary">
        Policies may not exceed this property&apos;s {propertyWindow}-day self-service cancellation
        window.
      </Text>
      <div>
        {quickStarts.map(([name, days]) => (
          <button
            key={name}
            className="must-button must-button--secondary"
            type="button"
            disabled={create.isPending}
            onClick={() => create.mutate({ name, freeCancellationDaysBeforeArrival: days })}
          >
            {name} ({days} days)
          </button>
        ))}
      </div>
      <form
        className="must-field"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          create.mutate({
            name: String(form.get('name') ?? ''),
            freeCancellationDaysBeforeArrival: Number(form.get('days')),
          });
          event.currentTarget.reset();
        }}
      >
        <input className="must-input" name="name" placeholder="Policy name" required />
        <input
          className="must-input"
          name="days"
          type="number"
          min="0"
          step="1"
          required
          aria-label="Free cancellation days"
        />
        <button
          className="must-button must-button--primary"
          type="submit"
          disabled={create.isPending}
        >
          Create policy
        </button>
      </form>
      {policies.map((policy) => (
        <form
          key={policy.id}
          className="must-field"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            update.mutate({
              id: policy.id,
              body: {
                name: String(form.get('name') ?? ''),
                freeCancellationDaysBeforeArrival: Number(form.get('days')),
              },
            });
          }}
        >
          <input
            className="must-input"
            name="name"
            defaultValue={policy.name}
            required
            aria-label={`Policy name ${policy.name}`}
          />
          <input
            className="must-input"
            name="days"
            type="number"
            min="0"
            step="1"
            defaultValue={policy.freeCancellationDaysBeforeArrival}
            required
            aria-label={`Free cancellation days for ${policy.name}`}
          />
          <button
            className="must-button must-button--secondary"
            type="submit"
            disabled={update.isPending}
          >
            Save
          </button>
          <button
            className="must-button must-button--secondary"
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate(policy.id)}
          >
            Delete
          </button>
        </form>
      ))}
      {ratePlans.length === 0 ? (
        <Text tone="secondary">No Clock-managed rate plans are available yet.</Text>
      ) : (
        ratePlans.map((ratePlan) => (
          <label className="must-field" key={ratePlan.id}>
            <span className="must-field__label">{ratePlan.name}</span>
            <select
              className="must-input"
              value={ratePlan.cancellationPolicyId ?? ''}
              onChange={(event) =>
                assign.mutate({
                  ratePlanId: ratePlan.id,
                  cancellationPolicyId: event.target.value || null,
                })
              }
              disabled={assign.isPending}
            >
              <option value="">No free cancellation</option>
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name} ({policy.freeCancellationDaysBeforeArrival} days)
                </option>
              ))}
            </select>
          </label>
        ))
      )}
    </section>
  );
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
