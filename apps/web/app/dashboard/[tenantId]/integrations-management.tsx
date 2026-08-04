'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';

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
type CredentialField = { key: string; value: string };

const providerLabels: Record<ConnectionProvider, string> = {
  STRIPE: 'Stripe',
  POKPAY: 'PokPay',
  CLOCK_PMS: 'Clock PMS',
};

export function IntegrationsManagement({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ConnectionKind>('PAYMENT');
  const [provider, setProvider] = useState<ConnectionProvider>('STRIPE');
  const [name, setName] = useState('');
  const [credentialFields, setCredentialFields] = useState<CredentialField[]>([
    { key: '', value: '' },
  ]);

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

  const propertyConnectionsQueryKey = [
    'dashboard',
    'integration-connections',
    'property',
    tenantId,
    propertyId,
  ] as const;
  const propertyConnectionsQuery = useQuery({
    queryKey: propertyConnectionsQueryKey,
    queryFn: async (): Promise<PropertyConnection[]> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/integration-connections`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Unable to load property connections.');
      return (await response.json()) as PropertyConnection[];
    },
  });

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
      setCredentialFields([{ key: '', value: '' }]);
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
      void queryClient.invalidateQueries({ queryKey: propertyConnectionsQueryKey });
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
    mutationFn: async ({ connectionId, enabled }: { connectionId: string; enabled: boolean }) => {
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
      void queryClient.invalidateQueries({ queryKey: propertyConnectionsQueryKey });
      toast.success('Property assignment updated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update this property.'),
  });

  const connections = connectionsQuery.data ?? [];
  const propertyConnections = propertyConnectionsQuery.data ?? [];
  const enabledByConnectionId = new Map(
    propertyConnections.map((entry) => [entry.connectionId, entry.enabled]),
  );
  const activeClockConnectionId = propertyConnections.find(
    (entry) => entry.provider === 'CLOCK_PMS' && entry.enabled,
  )?.connectionId;

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const credentials: Record<string, string> = {};
    for (const field of credentialFields) {
      const trimmedKey = field.key.trim();
      if (trimmedKey) credentials[trimmedKey] = field.value;
    }
    createMutation.mutate({ kind, provider, name: trimmedName, credentials, form });
  }

  function updateCredentialField(index: number, patch: Partial<CredentialField>) {
    setCredentialFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)),
    );
  }

  return (
    <Stack gap="md">
      <Text tone="secondary">
        Connect your own Stripe, PokPay, or Clock PMS account. Payment connections can be enabled on
        several properties at once; a property can only have one active PMS connection.
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
          {connections.map((connection) => (
            <Card key={connection.id}>
              <Heading level={3}>{connection.name}</Heading>
              <Text tone="secondary">
                {providerLabels[connection.provider]} ·{' '}
                {connection.kind === 'PMS' ? 'PMS' : 'Payment'} · {connection.status}
              </Text>
              {connection.lastTestResult ? (
                <Text tone="secondary">{connection.lastTestResult}</Text>
              ) : null}
              <label className="must-field">
                <input
                  className="must-input"
                  type="checkbox"
                  checked={enabledByConnectionId.get(connection.id) ?? false}
                  disabled={propertyConnectionsQuery.isPending}
                  onChange={(event) =>
                    assignMutation.mutate({
                      connectionId: connection.id,
                      enabled: event.target.checked,
                    })
                  }
                />
                Enabled for this property
              </label>
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
            </Card>
          ))}
        </>
      ) : null}
      {activeClockConnectionId ? (
        <ClockCatalogSync tenantId={tenantId} propertyId={propertyId} />
      ) : null}
      <Card>
        <Heading level={3}>Add a connection</Heading>
        <form className="must-stack must-stack--md" onSubmit={submitConnection}>
          <label className="must-field">
            <span className="must-field__label">Type</span>
            <select
              className="must-input"
              value={kind}
              onChange={(event) => setKind(event.target.value as ConnectionKind)}
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
              onChange={(event) => setProvider(event.target.value as ConnectionProvider)}
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
            {credentialFields.map((field, index) => (
              <Stack gap="sm" key={index}>
                <input
                  className="must-input"
                  placeholder="Field name (e.g. secretKey)"
                  value={field.key}
                  onChange={(event) => updateCredentialField(index, { key: event.target.value })}
                />
                <input
                  className="must-input"
                  type="password"
                  placeholder="Value"
                  value={field.value}
                  onChange={(event) => updateCredentialField(index, { value: event.target.value })}
                />
              </Stack>
            ))}
            <button
              className="must-button must-button--secondary"
              type="button"
              onClick={() => setCredentialFields((current) => [...current, { key: '', value: '' }])}
            >
              Add credential field
            </button>
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

function ClockCatalogSync({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const queryClient = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/clock-catalog`;
  const mappingsQueryKey = ['dashboard', 'clock-catalog-mappings', tenantId, propertyId] as const;

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
      <Heading level={3}>Clock catalog sync</Heading>
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
    </Card>
  );
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
