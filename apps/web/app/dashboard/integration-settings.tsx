'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { credentialFieldsByProvider } from './integration-credential-fields';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatDateTime } from '../../lib/hotel-format';
import { IntegrationCard } from '../../components/ui/integration-card';
import {
  CATEGORIES,
  HealthLine,
  StatusLine,
  brevoState,
  INTEGRATIONS,
  type CatalogItem,
  type Connection,
  type ConnectionProvider,
} from './integration-catalog';
import { BrevoDetail, BrevoLogo, IntegrationDetail, WebsiteDetail } from './integration-detail';
import {
  EmailSendingSetup,
  sendingConnectionLabels,
  sendingOptionLabels,
  useEmailSendingProfile,
} from './email-sending-profile';
import { emailsSendingHref } from './settings-hub';
import { onBrevo } from './brevo-setup';
import { IntegrationRequestDialog } from './integration-request';
import { ClockSyncStatus } from './clock-sync';
import { RestaurantIntegrationCard } from './venues/restaurant-integration-card';
export function IntegrationSettings({
  tenantId,
  propertyId,
  canWrite,
  website,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
  /** The hotel website's state and the form that connects it; shown as the Website card. */
  website?: { origin: string | null; pairedAt: string | null; form: ReactNode };
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
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<{ provider: string; connectionId?: string } | null>(null);
  const [websiteDialog, setWebsiteDialog] = useState<'overview' | 'connection' | null>(null);
  const [brevoDetailOpen, setBrevoDetailOpen] = useState(false);
  const [brevoFormOpen, setBrevoFormOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const emailBase = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const sending = useEmailSendingProfile(emailBase);
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
  const startActivation = (item: CatalogItem) => {
    setEdit({ provider: item.provider as ConnectionProvider });
    setCredentials(item.provider === 'POKPAY' ? { baseUrl: 'https://api-staging.pokpay.io' } : {});
    setName(item.name);
  };
  /** The main button of a card: activate, or switch the connection on or off for this hotel. */
  const mainAction = (item: CatalogItem, connection: Connection | null) => {
    if (!canWrite || !item.available) return null;
    if (!connection)
      return (
        <Button size="sm" variant="outline" onClick={() => startActivation(item)}>
          Activate
        </Button>
      );
    const paymentProvider =
      connection.provider === 'POKPAY' || connection.provider === 'STRIPE'
        ? connection.provider
        : null;
    const replacing = paymentProvider ? otherEnabled(paymentProvider, connection.id) : undefined;
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={
          action.isPending || (!assigned(connection.id) && connection.status !== 'CONNECTED')
        }
        onClick={() => {
          const run = () =>
            action.mutate({
              path: `/properties/${propertyId}/integration-connections/${connection.id}`,
              method: 'PATCH',
              body: { enabled: !assigned(connection.id) },
            });
          if (paymentProvider && !assigned(connection.id) && replacing)
            setSwitchConfirm({
              provider: paymentProvider,
              replacing: replacing.name,
              toMode: connection.mode ?? 'LIVE',
              run,
            });
          else run();
        }}
      >
        {assigned(connection.id)
          ? 'Disable'
          : replacing
            ? connection.mode === 'TEST'
              ? 'Switch to test'
              : 'Switch to live'
            : 'Enable'}
      </Button>
    );
  };
  const detailItem = detail ? INTEGRATIONS.find((i) => i.provider === detail.provider) : undefined;
  const detailConnection = detail?.connectionId
    ? (query.data!.connections.find((c) => c.id === detail.connectionId) ?? null)
    : null;
  const brevo = brevoState(sending.data, !!sending.error, sendingOptionLabels);
  const brevoConnected = !!sending.data && onBrevo(sending.data);
  const emailsHref = emailsSendingHref(tenantId, propertyId);
  const needle = search.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) =>
    !needle || parts.some((part) => part?.toLowerCase().includes(needle));
  const inCategory = (value: string) => category === 'All' || category === value;
  const comingSoon = INTEGRATIONS.filter(
    (item) =>
      !item.available && inCategory(item.category) && matches(item.name, item.role, item.owns),
  );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Connect this hotel's own accounts. Credentials are encrypted. Secret values are shown only
        by their last four characters. Use sandbox or staging accounts for testing.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={category} onValueChange={setCategory}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            {CATEGORIES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          type="search"
          aria-label="Search integrations"
          placeholder="Search integrations"
          className="w-full sm:w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.filter(
          (item) =>
            item.available &&
            inCategory(item.category) &&
            matches(item.name, item.role, item.owns, item.category),
        ).flatMap((item) => {
          const connections = query.data!.connections.filter((c) => c.provider === item.provider);
          return (connections.length ? connections : [null]).map((connection) => {
            const enabled = !!connection && assigned(connection.id);
            const main = mainAction(item, connection);
            return (
              <IntegrationCard
                key={connection?.id ?? item.provider}
                headerClassName={item.provider === 'POKPAY' ? 'bg-[#151c2c]' : undefined}
                header={
                  <img
                    src={`/integrations/${item.provider.toLowerCase()}.svg`}
                    width={190}
                    height={64}
                    alt={item.name}
                    className="max-h-16 max-w-[190px] object-contain"
                  />
                }
                title={connection?.name ?? item.name}
                badges={
                  <>
                    {connection?.mode ? <PaymentModeBadge mode={connection.mode} /> : null}
                    <Badge variant={enabled ? 'success' : 'secondary'}>
                      {connection
                        ? enabled
                          ? 'Enabled for this hotel'
                          : connection.status === 'CONNECTED'
                            ? 'Disabled'
                            : connection.status
                        : 'Not connected'}
                    </Badge>
                  </>
                }
                role={item.role}
                owns={item.owns}
                health={<HealthLine connection={connection} />}
                footer={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className={main ? undefined : 'col-span-2'}
                      onClick={() =>
                        setDetail({ provider: item.provider, connectionId: connection?.id })
                      }
                    >
                      Details
                    </Button>
                    {main}
                  </>
                }
              />
            );
          });
        })}
        {website && inCategory('Website') && matches('website', 'booking pages', 'widget') ? (
          <IntegrationCard
            header={<span className="text-2xl font-semibold">Website</span>}
            title="Website"
            badges={
              <Badge variant={website.pairedAt ? 'success' : 'secondary'}>
                {website.pairedAt ? 'Connected' : 'Not connected'}
              </Badge>
            }
            role="Website"
            owns="the booking pages and the link to your hotel website"
            health={<WebsiteHealth origin={website.origin} pairedAt={website.pairedAt} />}
            footer={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className={canWrite ? undefined : 'col-span-2'}
                  onClick={() => setWebsiteDialog('overview')}
                >
                  Details
                </Button>
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setWebsiteDialog('connection')}
                  >
                    {website.pairedAt ? 'Manage' : 'Connect'}
                  </Button>
                ) : null}
              </>
            }
          />
        ) : null}
        {inCategory('Email') && matches('brevo', 'email', 'guest emails', 'sending') ? (
          <IntegrationCard
            header={<BrevoLogo />}
            title="Brevo"
            badges={<Badge variant={brevo.active ? 'success' : 'secondary'}>{brevo.badge}</Badge>}
            role="Email"
            owns="the hotel's own guest emails (confirmations, reminders, receipts)"
            health={<StatusLine tone={brevo.tone}>{brevo.text}</StatusLine>}
            footer={
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className={canWrite ? undefined : 'col-span-2'}
                  onClick={() => setBrevoDetailOpen(true)}
                >
                  Details
                </Button>
                {canWrite ? (
                  brevoConnected ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={emailsHref}>Manage in Emails</a>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setBrevoFormOpen(true)}>
                      Connect
                    </Button>
                  )
                ) : null}
              </>
            }
          />
        ) : null}
        {inCategory('Restaurants') && matches('restaurants', 'restaurant', 'venues', 'tables') ? (
          <RestaurantIntegrationCard
            tenantId={tenantId}
            propertyId={propertyId}
            canWrite={canWrite}
          />
        ) : null}
      </div>
      <section
        aria-label={comingSoon.length ? 'Coming soon' : 'More integrations'}
        className="space-y-3"
      >
        <h3 className="m-0 text-sm font-semibold">
          {comingSoon.length ? 'Coming soon' : 'More integrations'}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {comingSoon.map((item) => (
            <div
              key={item.provider}
              className="flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/30 p-3"
            >
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-semibold">{item.name}</p>
                <p className="m-0 truncate text-xs text-muted-foreground">{item.role}</p>
              </div>
              <Badge variant="muted">Soon</Badge>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold">Need another integration?</p>
              <p className="m-0 text-xs text-muted-foreground">Tell us which system you use.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
              Request
            </Button>
          </div>
        </div>
      </section>
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {detail && detailItem ? (
            <IntegrationDetail
              key={detail.connectionId ?? detail.provider}
              tenantId={tenantId}
              propertyId={propertyId}
              item={detailItem}
              connection={detailConnection}
              assigned={!!detailConnection && assigned(detailConnection.id)}
              canWrite={canWrite}
              request={(path, method) => request(path, method)}
              checking={action.isPending}
              onCheckNow={() =>
                detailConnection &&
                action.mutate({
                  path: `/integration-connections/${detailConnection.id}/test`,
                  method: 'POST',
                })
              }
              onChangeCredentials={() => {
                if (!detailConnection) return;
                setEdit({ provider: detailConnection.provider, id: detailConnection.id });
                setCredentials({});
                setName(detailConnection.name);
                setEnvironmentDrafts({});
                setDetail(null);
              }}
              onAddStripeAccount={() => {
                setEdit({ provider: 'STRIPE' });
                setCredentials({});
                setName('Stripe');
                setEnvironmentDrafts({});
                setDetail(null);
              }}
              onActivate={() => {
                startActivation(detailItem);
                setDetail(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {website ? (
        <Dialog open={!!websiteDialog} onOpenChange={(open) => !open && setWebsiteDialog(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            {websiteDialog ? (
              <WebsiteDetail
                key={websiteDialog}
                origin={website.origin}
                pairedAt={website.pairedAt}
                form={website.form}
                initialTab={websiteDialog}
              />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
      <Dialog open={brevoDetailOpen} onOpenChange={setBrevoDetailOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {brevoDetailOpen ? (
            <BrevoDetail
              profile={sending.data}
              state={brevo}
              optionLabels={sendingOptionLabels}
              connectionLabels={sendingConnectionLabels}
              emailsHref={emailsHref}
              canWrite={canWrite}
              onConnect={() => {
                setBrevoDetailOpen(false);
                setBrevoFormOpen(true);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={brevoFormOpen} onOpenChange={setBrevoFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>{brevoConnected ? 'Brevo credentials' : 'Connect Brevo'}</DialogTitle>
          <DialogDescription>
            Enter what Brevo provides. Keys and logins are encrypted and never shown again.
          </DialogDescription>
          {brevoFormOpen ? (
            <EmailSendingSetup base={emailBase} canWrite={canWrite} brevo emailsHref={emailsHref} />
          ) : null}
        </DialogContent>
      </Dialog>
      {requestOpen ? (
        <IntegrationRequestDialog open onOpenChange={(open) => !open && setRequestOpen(false)} />
      ) : null}
      <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} />
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
          {!edit?.id && edit ? (
            <ol className="m-0 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Enter the account details below.</li>
              <li>
                We check them with {INTEGRATIONS.find((i) => i.provider === edit.provider)?.name}.
                Nothing is saved if the check fails.
              </li>
              <li>
                If they work, it is switched on for this hotel.
                {edit.provider === 'STRIPE' || edit.provider === 'POKPAY'
                  ? ' Test accounts stay in test mode, so no real money moves.'
                  : ''}
              </li>
            </ol>
          ) : null}
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

/** The credential fields that can be replaced on a saved connection (the account itself cannot). */
function editableKeys(provider: 'CLOCK_PMS' | 'POKPAY' | 'STRIPE'): string[] {
  if (provider === 'CLOCK_PMS') return ['apiUser', 'apiKey'];
  if (provider === 'STRIPE') return ['secretKey', 'webhookSecret', 'publishableKey'];
  return ['keyId', 'keySecret'];
}

/** Where the hotel website stands: connected, address saved but not connected, or nothing yet. */
function WebsiteHealth({ origin, pairedAt }: { origin: string | null; pairedAt: string | null }) {
  const text = pairedAt
    ? `Connected ${formatDateTime(pairedAt)}`
    : origin
      ? 'Address saved, not connected yet'
      : 'Website address not set';
  return (
    <p className="m-0 flex items-start gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={`mt-1 size-2 shrink-0 rounded-full ${pairedAt ? 'bg-success' : 'bg-muted-foreground/40'}`}
      />
      <span>{text}</span>
    </p>
  );
}

function providerLabel(provider: 'POKPAY' | 'STRIPE' | undefined): string {
  return provider === 'STRIPE' ? 'Stripe' : 'PokPay';
}
