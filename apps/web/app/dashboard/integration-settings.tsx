'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardHeader, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { PaymentModeBadge } from '../../components/ui/payment-mode-badge';
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
import { RestaurantIntegrationCard } from './venues/restaurant-integration-card';
type Connection = {
  id: string;
  provider: 'CLOCK_PMS' | 'POKPAY' | 'STRIPE';
  name: string;
  status: string;
  /** TEST or LIVE for a payment account; null for Clock. */
  mode?: 'TEST' | 'LIVE' | null;
  /** Random id in this connection's public webhook address (Stripe). */
  webhookPublicId?: string;
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
  const [edit, setEdit] = useState<{
    provider: 'CLOCK_PMS' | 'POKPAY' | 'STRIPE';
    id?: string;
  } | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [environmentDrafts, setEnvironmentDrafts] = useState<
    Record<string, { id?: string; credentials: Record<string, string>; name: string }>
  >({});
  const [category, setCategory] = useState('All');
  const [syncOpen, setSyncOpen] = useState(false);
  const [switchConfirm, setSwitchConfirm] = useState<{
    /** Which payment provider is being switched, for the wording. */
    provider: 'POKPAY' | 'STRIPE';
    replacing: string;
    /** The account being switched to: a test or a live one. */
    toMode: 'TEST' | 'LIVE';
    run: () => void;
  } | null>(null);
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
  // What happened to Clock's live updates (webhook) when a Clock connection was linked or the setup was run again.
  const liveUpdatesNotice = (result?: { state?: string; message?: string }) => {
    if (!result?.state) return;
    if (result.state === 'enabled') toast.success('Live updates from Clock are on.');
    else toast.warning(result.message || 'Live updates from Clock are not on yet.');
  };
  const action = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      request(path, method, body),
    onSuccess: async (data) => {
      if (data.status === 'FAILED')
        toast.error('Connection verification failed. Review the connection details.');
      else if (data.state && data.message) liveUpdatesNotice(data);
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
    enabled: edit?.provider === 'POKPAY' || edit?.provider === 'STRIPE',
    queryFn: () =>
      request('/integration-setup', 'GET') as Promise<{
        pokpayWebhookUrl: string;
        stripeWebhookBase?: string;
      }>,
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
        (f) => !edit.id || editableKeys(edit.provider).includes(f.key),
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
        // A connection that never got linked to the hotel is removed again, so a failed attempt
        // leaves no duplicate cards behind.
        const discard = () =>
          request(`/integration-connections/${created.id}`, 'DELETE').catch(() => undefined);
        const tested = await request(`/integration-connections/${created.id}/test`, 'POST').catch(
          async (e: unknown) => {
            await discard();
            throw e;
          },
        );
        if (tested.status !== 'CONNECTED') {
          await discard();
          await refresh();
          throw Error(
            'Verification failed. Nothing was saved and the current connection was kept.',
          );
        }
        try {
          const linked = await request(
            `/properties/${propertyId}/integration-connections/${created.id}`,
            'PATCH',
            {
              enabled: true,
            },
          );
          liveUpdatesNotice(linked.liveUpdates);
        } catch (e) {
          await discard();
          await refresh();
          throw e;
        }
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
  // The connection of this payment provider the hotel is using now, other than the one being switched to.
  const otherEnabled = (provider: 'POKPAY' | 'STRIPE', exceptId?: string) =>
    query.data!.connections.find(
      (c) => c.provider === provider && c.id !== exceptId && assigned(c.id),
    );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Connect this hotel's own accounts. Credentials are encrypted. Secret values are shown only
        by their last four characters. Use sandbox or staging accounts for testing.
      </p>
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {['All', 'Property systems', 'Payments', 'Channels', 'Email', 'Services'].map((value) => (
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
                    <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      {connection?.name || item.category}
                      {connection?.mode ? <PaymentModeBadge mode={connection.mode} /> : null}
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
                      {connection.mode === 'TEST'
                        ? 'PokPay test account (staging): payments are not real money.'
                        : 'PokPay live account (production): real payments.'}
                    </p>
                  ) : null}
                  {connection?.provider === 'STRIPE' ? (
                    <p className="text-xs text-muted-foreground">
                      {connection.mode === 'TEST'
                        ? 'Stripe test keys (sandbox): payments are not real money.'
                        : 'Stripe live keys: real payments.'}
                    </p>
                  ) : null}
                  {connection?.lastTestResult ? (
                    <p className="text-xs text-muted-foreground">{connection.lastTestResult}</p>
                  ) : null}
                  {canWrite && item.available ? (
                    connection ? (
                      <>
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
                                provider: item.provider as 'CLOCK_PMS' | 'POKPAY' | 'STRIPE',
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
                            onClick={() => {
                              const run = () =>
                                action.mutate({
                                  path: `/properties/${propertyId}/integration-connections/${connection.id}`,
                                  method: 'PATCH',
                                  body: { enabled: !assigned(connection.id) },
                                });
                              const replacing =
                                connection.provider === 'POKPAY' || connection.provider === 'STRIPE'
                                  ? otherEnabled(connection.provider, connection.id)
                                  : undefined;
                              if (
                                (connection.provider === 'POKPAY' ||
                                  connection.provider === 'STRIPE') &&
                                !assigned(connection.id) &&
                                replacing
                              )
                                setSwitchConfirm({
                                  provider: connection.provider,
                                  replacing: replacing.name,
                                  toMode: connection.mode ?? 'LIVE',
                                  run,
                                });
                              else run();
                            }}
                          >
                            {assigned(connection.id)
                              ? 'Disable'
                              : (connection.provider === 'POKPAY' ||
                                    connection.provider === 'STRIPE') &&
                                  otherEnabled(connection.provider, connection.id)
                                ? connection.mode === 'TEST'
                                  ? 'Switch to test'
                                  : 'Switch to live'
                                : 'Enable'}
                          </Button>
                        </div>
                        {item.provider === 'STRIPE' &&
                        connection.id === connections[connections.length - 1]!.id ? (
                          <Button
                            className="w-full"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEdit({ provider: 'STRIPE' });
                              setCredentials({});
                              setName('Stripe');
                              setEnvironmentDrafts({});
                            }}
                          >
                            Add another Stripe account (test or live)
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => {
                          setEdit({ provider: item.provider as 'CLOCK_PMS' | 'POKPAY' | 'STRIPE' });
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
        {category === 'All' || category === 'Services' ? (
          <RestaurantIntegrationCard
            tenantId={tenantId}
            propertyId={propertyId}
            canWrite={canWrite}
          />
        ) : null}
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
      <Dialog open={!!switchConfirm} onOpenChange={(open) => !open && setSwitchConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>
            {switchConfirm?.toMode === 'TEST'
              ? `Switch ${providerLabel(switchConfirm.provider)} to test?`
              : `Go live with ${providerLabel(switchConfirm?.provider)}?`}
          </DialogTitle>
          <DialogDescription>
            This hotel is using “{switchConfirm?.replacing}” now. From this moment guests pay
            through the {switchConfirm?.toMode === 'TEST' ? 'test' : 'live'} account, and “
            {switchConfirm?.replacing}” is switched off. It keeps its keys, so you can switch back
            at any time.{' '}
            {switchConfirm?.toMode === 'TEST'
              ? 'While on test, card payments are test payments, not real money.'
              : 'The live account takes real payments.'}{' '}
            Payments already taken stay with the account that took them, including their refunds.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSwitchConfirm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const run = switchConfirm?.run;
                setSwitchConfirm(null);
                run?.();
              }}
            >
              {switchConfirm?.toMode === 'TEST' ? 'Switch to test' : 'Go live'}
            </Button>
          </div>
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
              const replacing =
                !edit?.id && (edit?.provider === 'POKPAY' || edit?.provider === 'STRIPE')
                  ? otherEnabled(edit.provider)
                  : undefined;
              if (replacing && edit && edit.provider !== 'CLOCK_PMS')
                setSwitchConfirm({
                  provider: edit.provider,
                  replacing: replacing.name,
                  toMode:
                    edit.provider === 'STRIPE'
                      ? /^[sr]k_test_/.test((credentials.secretKey ?? '').trim())
                        ? 'TEST'
                        : 'LIVE'
                      : credentials.baseUrl === 'https://api.pokpay.io'
                        ? 'LIVE'
                        : 'TEST',
                  run: () => save.mutate(),
                });
              else save.mutate();
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
                  Staging is PokPay&apos;s test account; production takes real payments and needs
                  production credentials and a public HTTPS address. Test and live are two separate
                  accounts: both stay saved, and you switch between them on the PokPay cards.
                </p>
              </FormField>
            ) : edit?.provider === 'STRIPE' ? (
              <p className="text-xs text-muted-foreground">
                Test and live are two separate sets of keys: a key starting with sk_test_ or
                rk_test_ is a test (sandbox) account, sk_live_ or rk_live_ takes real money. Both
                stay saved and you switch between them on the Stripe cards. Live keys are accepted
                once Stripe is opened for real hotels. The publishable key (pk_test_ or pk_live_,
                public by design) is optional: with it, the hotel&apos;s website can show
                Stripe&apos;s payment window inside its own page instead of opening a new tab.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Clock account and environment follow its configured host, account ID and
                subscription ID.
              </p>
            )}
            {edit?.provider === 'STRIPE' ? (
              <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {edit.id ? (
                  <>
                    In the Stripe Dashboard open Developers, then Webhooks, add this address and
                    choose the events checkout.session.completed and
                    checkout.session.async_payment_succeeded. Then copy the signing secret (whsec_…)
                    into Webhook secret below. Without it, paid bookings are not confirmed.
                    <span className="mt-1 block break-all font-mono">
                      {setup.data?.stripeWebhookBase &&
                      query.data?.connections.find((c) => c.id === edit.id)?.webhookPublicId
                        ? `${setup.data.stripeWebhookBase}/${
                            query.data.connections.find((c) => c.id === edit.id)!.webhookPublicId
                          }`
                        : 'Loading…'}
                    </span>
                  </>
                ) : (
                  'After the keys are saved, this connection gets its own webhook address to add in the Stripe Dashboard, and you paste the signing secret here.'
                )}
              </p>
            ) : null}
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
                  // The Environment dropdown above already chooses staging or production, and the notification
                  // address is set up automatically, so neither is asked for again as a text box.
                  .filter(
                    (f) =>
                      !(
                        edit.provider === 'POKPAY' && ['webhookUrl', 'environment'].includes(f.key)
                      ) && !(edit.provider === 'STRIPE' && !edit.id && f.key === 'webhookSecret'),
                  )
                  .map((f) => {
                    const editable = !edit.id || editableKeys(edit.provider).includes(f.key);
                    return (
                      <FormField key={f.key} label={f.label}>
                        <Input
                          aria-label={f.label}
                          type={f.secret ? 'password' : 'text'}
                          required={
                            !edit.id &&
                            !(
                              edit.provider === 'STRIPE' &&
                              ['webhookSecret', 'publishableKey'].includes(f.key)
                            )
                          }
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
            {edit?.id && edit.provider === 'CLOCK_PMS' ? (
              <div className="space-y-1 rounded-lg border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Live updates from Clock</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={action.isPending || save.isPending}
                    onClick={() =>
                      action.mutate({
                        path: `/integration-connections/${edit.id}/live-updates`,
                        method: 'POST',
                      })
                    }
                  >
                    {action.isPending ? 'Working...' : 'Turn on live updates'}
                  </Button>
                </div>
                <p className="m-0 text-xs text-muted-foreground">
                  Switched on by itself when the connection is saved. Use this if Clock was not
                  ready then, for example before it granted the webhook right.
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
  { provider: 'STRIPE', name: 'Stripe', category: 'Payments', available: true },
  { provider: 'PAYPAL', name: 'PayPal', category: 'Payments', available: false },
  { provider: 'BOOKING', name: 'Booking.com', category: 'Channels', available: false },
  { provider: 'AIRBNB', name: 'Airbnb', category: 'Channels', available: false },
  { provider: 'SMTP', name: 'SMTP email', category: 'Email', available: false },
];

/** The credential fields that can be replaced on a saved connection (the account itself cannot). */
function editableKeys(provider: 'CLOCK_PMS' | 'POKPAY' | 'STRIPE'): string[] {
  if (provider === 'CLOCK_PMS') return ['apiUser', 'apiKey'];
  if (provider === 'STRIPE') return ['secretKey', 'webhookSecret', 'publishableKey'];
  return ['keyId', 'keySecret'];
}

function providerLabel(provider: 'POKPAY' | 'STRIPE' | undefined): string {
  return provider === 'STRIPE' ? 'Stripe' : 'PokPay';
}
