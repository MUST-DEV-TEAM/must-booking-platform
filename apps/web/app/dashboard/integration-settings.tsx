'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { FormField } from '../../components/ui/form-field';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { credentialFieldsByProvider } from './[tenantId]/integrations-management';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ClockSyncStatus } from './clock-sync';
type Connection = {
  id: string;
  provider: 'CLOCK_PMS' | 'POKPAY' | 'STRIPE';
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
};
export function IntegrationSettings({
  tenantId,
  propertyId,
  canWrite,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
}) {
  const base = `/api/tenants/${tenantId}`;
  const client = useQueryClient();
  const [edit, setEdit] = useState<{ provider: 'CLOCK_PMS' | 'POKPAY'; id?: string } | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [environmentDrafts, setEnvironmentDrafts] = useState<
    Record<string, { id?: string; credentials: Record<string, string>; name: string }>
  >({});
  const [category, setCategory] = useState('All');
  const [syncOpen, setSyncOpen] = useState(false);
  const query = useQuery({
    queryKey: ['dashboard', 'integration-settings', tenantId, propertyId],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        fetch(base + '/integration-connections', { credentials: 'include' }),
        fetch(`${base}/properties/${propertyId}/integration-connections`, {
          credentials: 'include',
        }),
      ]);
      if (!a.ok || !b.ok) throw Error('Connections could not be loaded.');
      return {
        connections: (await a.json()) as Connection[],
        assignments: (await b.json()) as Array<{ connectionId: string; enabled: boolean }>,
      };
    },
  });
  const request = async (path: string, method: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.message || 'Connection action could not finish.');
    return data;
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const action = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      request(path, method, body),
    onSuccess: async (data) => {
      if (data.status === 'FAILED')
        toast.error('Connection verification failed. Review the connection details.');
      else toast.success('Connection updated');
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const storedCredentials = useQuery({
    queryKey: ['dashboard', 'integration-credential-details', tenantId, edit?.id],
    enabled: !!edit?.id,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      request(`/integration-connections/${edit!.id}/credentials`, 'GET') as Promise<{
        fields: Record<string, string>;
      }>,
  });
  useEffect(() => {
    if (!edit?.id || !storedCredentials.data) return;
    setCredentials(
      Object.fromEntries(
        Object.entries(storedCredentials.data.fields ?? {}).filter(
          ([key]) => !['apiKey', 'keySecret', 'secretKey', 'webhookSecret'].includes(key),
        ),
      ),
    );
  }, [edit?.id, storedCredentials.data]);
  const setup = useQuery({
    queryKey: ['dashboard', 'integration-setup', tenantId],
    enabled: edit?.provider === 'POKPAY',
    queryFn: () => request('/integration-setup', 'GET') as Promise<{ pokpayWebhookUrl: string }>,
  });
  function selectEnvironment(environment: string) {
    const current = credentials.baseUrl === 'https://api.pokpay.io' ? 'production' : 'staging';
    if (environment === current) return;
    setEnvironmentDrafts((drafts) => ({
      ...drafts,
      [current]: { id: edit?.id, credentials: { ...credentials }, name },
    }));
    const target = environmentDrafts[environment];
    setEdit({ provider: 'POKPAY', ...(target?.id ? { id: target.id } : {}) });
    setCredentials(
      target?.credentials || {
        baseUrl:
          environment === 'production' ? 'https://api.pokpay.io' : 'https://api-staging.pokpay.io',
      },
    );
    setName(target?.name || `PokPay ${environment === 'production' ? 'Production' : 'Staging'}`);
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!edit) return;
      const fields = credentialFieldsByProvider[edit.provider].filter(
        (f) =>
          !edit.id ||
          (edit.provider === 'CLOCK_PMS' ? ['apiUser', 'apiKey'] : ['keyId', 'keySecret']).includes(
            f.key,
          ),
      );
      const supplied = Object.fromEntries(
        fields
          .filter(
            (f) =>
              credentials[f.key]?.trim() &&
              (!edit.id || credentials[f.key].trim() !== storedCredentials.data?.fields?.[f.key]),
          )
          .map((f) => [f.key, credentials[f.key].trim()]),
      );
      if (!edit.id && edit.provider === 'POKPAY')
        supplied.baseUrl = credentials.baseUrl || 'https://api-staging.pokpay.io';
      if (edit.id)
        await request(`/integration-connections/${edit.id}/credentials`, 'PATCH', {
          credentials: supplied,
        });
      else {
        const created = await request('/integration-connections', 'POST', {
          provider: edit.provider,
          kind: edit.provider === 'CLOCK_PMS' ? 'PMS' : 'PAYMENT',
          name,
          credentials: supplied,
        });
        const tested = await request(`/integration-connections/${created.id}/test`, 'POST');
        if (tested.status !== 'CONNECTED') {
          await refresh();
          throw Error(
            'Connection saved but verification failed. The current hotel connection was kept.',
          );
        }
        await request(`/properties/${propertyId}/integration-connections/${created.id}`, 'PATCH', {
          enabled: true,
        });
      }
    },
    onSuccess: async () => {
      setEdit(null);
      setCredentials({});
      toast.success('Connection verified and saved');
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  if (query.isPending) return <ListSkeleton />;
  if (query.error)
    return (
      <ErrorPanel
        title="Connections unavailable"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  const assigned = (id: string) =>
    query.data!.assignments.some((a) => a.connectionId === id && a.enabled);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Connect this hotel's own accounts. Credentials are encrypted. Secret values are shown only
        by their last four characters. Use sandbox or staging accounts for testing.
      </p>
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {['All', 'Property systems', 'Payments', 'Channels', 'Email'].map((value) => (
            <TabsTrigger key={value} value={value}>
              {value}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.filter((item) => category === 'All' || item.category === category).flatMap(
          (item) => {
            const connections = query.data!.connections.filter((c) => c.provider === item.provider);
            return (connections.length ? connections : [null]).map((connection) => (
              <Card key={connection?.id ?? item.provider} className="overflow-hidden">
                <CardHeader
                  className={`flex h-36 items-center justify-center ${item.provider === 'POKPAY' ? 'bg-[#151c2c]' : 'bg-muted/30'}`}
                >
                  <img
                    src={`/integrations/${item.provider.toLowerCase()}.${item.provider === 'PAYPAL' ? 'jpg' : 'svg'}`}
                    width={190}
                    height={64}
                    alt={item.name}
                    className="max-h-16 max-w-[190px] object-contain"
                  />
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {connection?.name || item.category}
                    </span>
                    <Badge
                      variant={connection && assigned(connection.id) ? 'success' : 'secondary'}
                    >
                      {!item.available
                        ? 'Coming soon'
                        : connection
                          ? assigned(connection.id)
                            ? 'Enabled for this hotel'
                            : connection.status === 'CONNECTED'
                              ? 'Disabled'
                              : connection.status
                          : 'Not connected'}
                    </Badge>
                  </div>
                  {connection?.provider === 'POKPAY' ? (
                    <p className="text-xs text-muted-foreground">
                      Environment and account details in Credentials
                    </p>
                  ) : null}
                  {connection?.lastTestResult ? (
                    <p className="text-xs text-muted-foreground">{connection.lastTestResult}</p>
                  ) : null}
                  {canWrite && item.available ? (
                    connection ? (
                      <div
                        className={`grid gap-2 ${item.provider === 'CLOCK_PMS' ? 'grid-cols-3' : 'grid-cols-2'}`}
                      >
                        {item.provider === 'CLOCK_PMS' ? (
                          <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
                            Synchronization
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEdit({
                              provider: item.provider as 'CLOCK_PMS' | 'POKPAY',
                              id: connection.id,
                            });
                            setCredentials({});
                            setName(connection.name);
                            setEnvironmentDrafts({});
                          }}
                        >
                          Credentials
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            action.isPending ||
                            (!assigned(connection.id) && connection.status !== 'CONNECTED')
                          }
                          onClick={() =>
                            action.mutate({
                              path: `/properties/${propertyId}/integration-connections/${connection.id}`,
                              method: 'PATCH',
                              body: { enabled: !assigned(connection.id) },
                            })
                          }
                        >
                          {assigned(connection.id) ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => {
                          setEdit({ provider: item.provider as 'CLOCK_PMS' | 'POKPAY' });
                          setCredentials(
                            item.provider === 'POKPAY'
                              ? { baseUrl: 'https://api-staging.pokpay.io' }
                              : {},
                          );
                          setName(item.name);
                        }}
                      >
                        Activate
                      </Button>
                    )
                  ) : !item.available ? (
                    <p className="text-xs text-muted-foreground">
                      Not available for activation yet.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ));
          },
        )}
      </div>
      <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} />
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>Clock synchronization</DialogTitle>
          <DialogDescription>
            What is being brought in from Clock PMS+, how much there is, how much is left and about
            how long it will take. You can keep working meanwhile.
          </DialogDescription>
          <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} details />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !save.isPending) {
            setEdit(null);
            setCredentials({});
            setEnvironmentDrafts({});
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>{edit?.id ? 'Connection credentials' : 'Activate integration'}</DialogTitle>
          <DialogDescription>
            {edit?.id
              ? 'Applies to every hotel using this connection. New credentials are verified before replacing the working credentials. To change provider accounts, create a separate connection.'
              : 'A new connection is tested before assignment. Only one Clock connection can be enabled for a hotel.'}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {edit?.provider === 'POKPAY' ? (
              <FormField label="Environment">
                <Select
                  value={
                    (credentials.baseUrl || 'https://api-staging.pokpay.io') ===
                    'https://api.pokpay.io'
                      ? 'production'
                      : 'staging'
                  }
                  disabled={save.isPending || (!!edit?.id && storedCredentials.isPending)}
                  onValueChange={selectEnvironment}
                >
                  <SelectTrigger className="w-full" aria-label="PokPay environment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Production uses real payments and requires production credentials and a public
                  HTTPS webhook. Environment and merchant changes need a separate connection to
                  protect payment history.
                </p>
              </FormField>
            ) : (
              <p className="text-xs text-muted-foreground">
                Clock account and environment follow its configured host, account ID and
                subscription ID.
              </p>
            )}
            {edit?.provider === 'POKPAY' ? (
              <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                Payment notifications are set up automatically by MUST.{' '}
                {edit.id
                  ? 'The saved connection keeps its original callback.'
                  : 'The callback uses the public address configured for this installation.'}
                <span className="mt-1 block break-all">
                  {edit.id ? credentials.webhookUrl : setup.data?.pokpayWebhookUrl}
                </span>
              </p>
            ) : null}
            {!edit?.id ? (
              <FormField label="Connection name">
                <Input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
            ) : null}
            {storedCredentials.isError && edit?.id ? (
              <p role="alert">Saved credentials could not be loaded. Close and try again.</p>
            ) : null}
            {edit
              ? credentialFieldsByProvider[edit.provider]
                  .filter((f) => !(edit.provider === 'POKPAY' && f.key === 'webhookUrl'))
                  .map((f) => {
                    const editable =
                      !edit.id ||
                      (edit.provider === 'CLOCK_PMS'
                        ? ['apiUser', 'apiKey']
                        : ['keyId', 'keySecret']
                      ).includes(f.key);
                    return (
                      <FormField key={f.key} label={f.label}>
                        <Input
                          aria-label={f.label}
                          type={f.secret ? 'password' : 'text'}
                          required={!edit.id}
                          readOnly={!editable}
                          disabled={!!edit.id && storedCredentials.isPending}
                          value={f.secret ? credentials[f.key] || '' : credentials[f.key] || ''}
                          placeholder={
                            f.secret && edit.id
                              ? `${storedCredentials.data?.fields?.[f.key] || 'Stored securely'} ? leave blank to keep`
                              : undefined
                          }
                          onChange={(event) =>
                            setCredentials({ ...credentials, [f.key]: event.target.value })
                          }
                        />
                        {f.secret && edit.id ? (
                          <p className="text-xs text-muted-foreground">
                            Saved: {storedCredentials.data?.fields?.[f.key] || 'Loading?'}. Enter a
                            new value only to replace it.
                          </p>
                        ) : !editable ? (
                          <p className="text-xs text-muted-foreground">
                            Account setting; changing it requires a separate connection.
                          </p>
                        ) : null}
                      </FormField>
                    );
                  })
              : null}
            {save.error ? <p role="alert">{save.error.message}</p> : null}
            {edit?.id ? (
              <div className="space-y-1 rounded-lg border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Test the saved connection</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={action.isPending || save.isPending}
                    onClick={() =>
                      action.mutate({
                        path: `/integration-connections/${edit.id}/test`,
                        method: 'POST',
                      })
                    }
                  >
                    {action.isPending ? 'Testing...' : 'Test connection'}
                  </Button>
                </div>
                <p className="m-0 text-xs text-muted-foreground" role="status">
                  {query.data?.connections.find((c) => c.id === edit.id)?.lastTestResult ||
                    'Checks the credentials that are saved now, without changing anything.'}
                </p>
              </div>
            ) : null}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Verifying...' : 'Verify and save'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const INTEGRATIONS = [
  { provider: 'CLOCK_PMS', name: 'Clock PMS+', category: 'Property systems', available: true },
  { provider: 'POKPAY', name: 'PokPay', category: 'Payments', available: true },
  { provider: 'STRIPE', name: 'Stripe', category: 'Payments', available: false },
  { provider: 'PAYPAL', name: 'PayPal', category: 'Payments', available: false },
  { provider: 'BOOKING', name: 'Booking.com', category: 'Channels', available: false },
  { provider: 'AIRBNB', name: 'Airbnb', category: 'Channels', available: false },
  { provider: 'SMTP', name: 'SMTP email', category: 'Email', available: false },
];
