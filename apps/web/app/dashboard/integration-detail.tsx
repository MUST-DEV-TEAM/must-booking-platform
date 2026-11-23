'use client';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { CopyButton } from '../../components/ui/copy-button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { PaymentModeBadge } from '../../components/ui/payment-mode-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { formatDateTime } from '../../lib/hotel-format';
import { ClockSyncStatus } from './clock-sync';
import { credentialFieldsByProvider } from './integration-credential-fields';
import { HealthLine, StatusLine, type CatalogItem, type Connection } from './integration-catalog';
import { onBrevo } from './brevo-setup';
import type { EmailSendingProfile } from './email-sending-profile';

/** A secret is never shown: only its last four characters, so a person can tell which key is saved. */
export function maskedSecret(saved: string | undefined): string {
  if (!saved) return 'Not set';
  const tail = saved.replace(/[*•]/g, '').slice(-4);
  return tail ? `•••• ${tail}` : '••••';
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-3 border-b py-2 last:border-b-0 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** One saved value: shown in full with a copy button when it is safe to see, hidden when it is a secret. */
function CredentialRow({
  label,
  value,
  secret,
}: {
  label: string;
  value: string | undefined;
  secret?: boolean;
}) {
  return (
    <Row label={label}>
      {secret ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{maskedSecret(value)}</span>
          <Badge variant="muted">Hidden for security</Badge>
        </span>
      ) : value ? (
        <span className="flex items-center gap-1">
          <span className="min-w-0 break-all font-mono">{value}</span>
          <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
        </span>
      ) : (
        <span className="text-muted-foreground">Not set</span>
      )}
    </Row>
  );
}

/**
 * One integration in more detail. Before it is connected it says what it does and what is needed to connect it; once
 * connected it shows its status, the saved credentials (secrets hidden), the Clock synchronization and what is known
 * about its activity.
 */
export function IntegrationDetail({
  tenantId,
  propertyId,
  item,
  connection,
  assigned,
  canWrite,
  request,
  checking,
  onCheckNow,
  onChangeCredentials,
  onAddStripeAccount,
  onActivate,
}: {
  tenantId: string;
  propertyId: string;
  item: CatalogItem;
  connection: Connection | null;
  assigned: boolean;
  canWrite: boolean;
  request: (path: string, method: string) => Promise<unknown>;
  checking: boolean;
  onCheckNow: () => void;
  onChangeCredentials: () => void;
  onAddStripeAccount: () => void;
  onActivate: () => void;
}) {
  const [tab, setTab] = useState('overview');
  const provider = item.provider as keyof typeof credentialFieldsByProvider;
  const fields = credentialFieldsByProvider[provider] ?? [];
  const saved = useQuery({
    queryKey: ['dashboard', 'integration-credential-view', tenantId, connection?.id],
    enabled: !!connection && tab === 'credentials',
    refetchOnWindowFocus: false,
    queryFn: () =>
      request(`/integration-connections/${connection!.id}/credentials`, 'GET') as Promise<{
        fields: Record<string, string>;
      }>,
  });
  const setup = useQuery({
    queryKey: ['dashboard', 'integration-setup', tenantId],
    enabled: !!connection && tab === 'credentials' && provider === 'STRIPE',
    queryFn: () =>
      request('/integration-setup', 'GET') as Promise<{
        pokpayWebhookUrl: string;
        stripeWebhookBase?: string;
      }>,
  });
  const values = saved.data?.fields ?? {};
  const stripeWebhook =
    setup.data?.stripeWebhookBase && connection?.webhookPublicId
      ? `${setup.data.stripeWebhookBase}/${connection.webhookPublicId}`
      : undefined;
  return (
    <>
      <DialogTitle>{connection?.name ?? item.name}</DialogTitle>
      <DialogDescription className="flex flex-wrap items-center gap-2">
        <span>
          {item.role} · owns {item.owns}
        </span>
        {connection?.mode ? <PaymentModeBadge mode={connection.mode} /> : null}
      </DialogDescription>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {connection ? <TabsTrigger value="credentials">Credentials</TabsTrigger> : null}
          {connection && provider === 'CLOCK_PMS' ? (
            <TabsTrigger value="sync">Synchronization</TabsTrigger>
          ) : null}
          {connection ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-3 pt-3">
          <p className="m-0 text-sm">{item.what}</p>
          {connection ? (
            <dl className="m-0">
              <Row label="Status">
                <HealthLine connection={connection} />
              </Row>
              <Row label="This hotel">
                {assigned ? 'Enabled for this hotel' : 'Not enabled for this hotel'}
              </Row>
              {connection.mode ? (
                <Row label="Account">
                  {connection.mode === 'TEST'
                    ? 'Test account: payments are not real money.'
                    : 'Live account: real payments.'}
                </Row>
              ) : null}
              <Row label="Connection">{connection.name}</Row>
            </dl>
          ) : (
            <div className="space-y-2">
              <p className="m-0 text-sm font-semibold">What you need to connect it</p>
              <ul className="m-0 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {fields
                  .filter((field) => !field.options)
                  .map((field) => (
                    <li key={field.key}>{field.label}</li>
                  ))}
              </ul>
              <p className="m-0 text-xs text-muted-foreground">
                We check them with {item.name} before anything is saved.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {connection && canWrite ? (
              <Button size="sm" variant="outline" disabled={checking} onClick={onCheckNow}>
                {checking ? 'Checking…' : 'Check connection now'}
              </Button>
            ) : null}
            {!connection && canWrite ? (
              <Button size="sm" onClick={onActivate}>
                Activate
              </Button>
            ) : null}
          </div>
        </TabsContent>

        {connection ? (
          <TabsContent value="credentials" className="space-y-3 pt-3">
            <p className="m-0 text-xs text-muted-foreground">
              Account details are shown in full. Secrets such as keys and passwords are never shown;
              only their last four characters, so you can tell which one is saved.
            </p>
            {saved.isPending ? (
              <p className="m-0 text-sm text-muted-foreground">Loading…</p>
            ) : saved.isError ? (
              <p role="alert" className="m-0 text-sm text-destructive">
                Saved credentials could not be loaded. Close this and try again.
              </p>
            ) : (
              <dl className="m-0">
                {provider === 'POKPAY' ? (
                  <Row label="Environment">
                    {connection.mode === 'LIVE'
                      ? 'Production (real payments)'
                      : 'Staging (test payments)'}
                  </Row>
                ) : null}
                {fields
                  .filter((field) => !field.options)
                  .map((field) => (
                    <CredentialRow
                      key={field.key}
                      label={field.label}
                      secret={field.secret}
                      value={values[field.key]}
                    />
                  ))}
                {provider === 'STRIPE' ? (
                  <CredentialRow label="Webhook address" value={stripeWebhook} />
                ) : null}
                {provider === 'POKPAY' ? (
                  <CredentialRow label="Webhook address" value={values.webhookUrl} />
                ) : null}
              </dl>
            )}
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={onChangeCredentials}>
                  Change credentials
                </Button>
                {provider === 'STRIPE' ? (
                  <Button size="sm" variant="ghost" onClick={onAddStripeAccount}>
                    Add another Stripe account (test or live)
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                You can view this connection but not change its credentials.
              </p>
            )}
          </TabsContent>
        ) : null}

        {connection && provider === 'CLOCK_PMS' ? (
          <TabsContent value="sync" className="space-y-3 pt-3">
            <p className="m-0 text-xs text-muted-foreground">
              What is being brought in from Clock PMS+, how much there is, how much is left and
              about how long it will take. You can keep working meanwhile.
            </p>
            <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} details />
          </TabsContent>
        ) : null}

        {connection ? (
          <TabsContent value="activity" className="space-y-3 pt-3">
            <ul className="m-0 list-disc space-y-1 pl-5 text-sm">
              <li>Connection: {connection.name}</li>
              <li>
                Last check:{' '}
                {connection.lastTestedAt
                  ? `${formatDateTime(connection.lastTestedAt)}. ${connection.lastTestResult ?? ''}`
                  : 'not checked yet'}
              </li>
              <li>Now: {assigned ? 'enabled for this hotel' : 'not enabled for this hotel'}</li>
            </ul>
            <p className="m-0 text-xs text-muted-foreground">
              A full history of calls and errors is not recorded yet.
            </p>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

/** The Website card's detail view: where it stands, and the form that connects the hotel website. */
export function WebsiteDetail({
  origin,
  pairedAt,
  form,
  initialTab = 'overview',
}: {
  origin: string | null;
  pairedAt: string | null;
  form: ReactNode;
  initialTab?: 'overview' | 'connection';
}) {
  const [tab, setTab] = useState<string>(initialTab);
  return (
    <>
      <DialogTitle>Website</DialogTitle>
      <DialogDescription>
        Website · owns the booking pages and the link to your hotel website
      </DialogDescription>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-3 pt-3">
          <p className="m-0 text-sm">
            Your hotel website shows the booking pages and sends guests to them. It connects with
            its address and a one-time connection code.
          </p>
          <dl className="m-0">
            <Row label="Website address">
              {origin ? (
                <span className="break-all font-mono">{origin}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </Row>
            <Row label="Connection">
              {pairedAt ? `Connected on ${formatDateTime(pairedAt)}` : 'Not connected yet'}
            </Row>
          </dl>
        </TabsContent>
        <TabsContent value="connection" className="pt-3">
          {form}
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The Brevo logo with its name, as on the card. */
export function BrevoLogo({ size = 40 }: { size?: number }) {
  return (
    <span className="flex items-center gap-3">
      <img src="/integrations/brevo.svg" alt="" width={size} height={size} />
      <span className="text-2xl font-semibold">Brevo</span>
    </span>
  );
}

/**
 * The Brevo popup, built like every other integration's: Overview, Credentials and Activity once it is connected;
 * before that, Overview with what is needed and a button to connect. The setup form itself is its own dialog.
 */
export function BrevoDetail({
  profile,
  state,
  optionLabels,
  connectionLabels,
  emailsHref,
  canWrite,
  onConnect,
}: {
  profile: EmailSendingProfile | undefined;
  state: { tone: 'ok' | 'failed' | 'idle'; text: string };
  optionLabels: Record<string, string>;
  connectionLabels: Record<string, string>;
  emailsHref: string;
  canWrite: boolean;
  onConnect: () => void;
}) {
  const connected = !!profile && onBrevo(profile);
  const failed = connected && profile.connectionStatus === 'failed';
  const active =
    connected && profile.activeMode === profile.mode && profile.connectionStatus === 'verified';
  const smtp = connected && profile.mode === 'SMTP';
  const sendingNow = profile ? optionLabels[profile.activeMode] : undefined;
  return (
    <>
      <DialogTitle className="flex items-center gap-3">
        <img src="/integrations/brevo.svg" alt="" width={32} height={32} />
        Brevo
      </DialogTitle>
      <DialogDescription>
        Email · owns the hotel's own guest emails (confirmations, reminders, receipts)
      </DialogDescription>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {connected ? <TabsTrigger value="credentials">Credentials</TabsTrigger> : null}
          {connected ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-3 pt-3">
          <p className="m-0 text-sm">
            Brevo is an email platform. Connected to this hotel, it sends the hotel's guest emails
            from the hotel's own Brevo account.
          </p>
          {connected && profile ? (
            <dl className="m-0">
              <Row label="Status">
                <StatusLine tone={state.tone}>{state.text}</StatusLine>
              </Row>
              <Row label="Guest emails sent by">{sendingNow}</Row>
              <Row label="From address">
                {profile.fromAddress ? (
                  <span className="break-all font-mono">{profile.fromAddress}</span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </Row>
              <Row label="From address verified">
                {profile.fromVerifiedAt ? formatDateTime(profile.fromVerifiedAt) : 'Not yet'}
              </Row>
              <Row label="Connection">
                {connectionLabels[profile.connectionStatus] ?? profile.connectionStatus}
                {profile.connectionCheckedAt
                  ? ` · checked ${formatDateTime(profile.connectionCheckedAt)}`
                  : ''}
              </Row>
            </dl>
          ) : (
            <div className="space-y-2">
              <p className="m-0 text-sm font-semibold">What you need to connect it</p>
              <ul className="m-0 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                <li>An API key, or an SMTP login and an SMTP key</li>
                <li>A From address: a sender you have added in your Brevo account</li>
              </ul>
              <p className="m-0 text-xs text-muted-foreground">
                Saving does not switch guest emails over; that is finished under Emails, Sending.
              </p>
            </div>
          )}
          {failed ? (
            <Alert variant="destructive">
              <AlertDescription>
                Brevo may be blocking this server, or the key is wrong. If you restrict IP addresses
                in Brevo, authorise this one:{' '}
                <span className="font-mono">
                  {profile?.serverOutboundIp ?? 'ask MUST support for the address'}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {connected ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="m-0 text-sm text-muted-foreground">
                {active
                  ? 'Guest emails go out through Brevo. Manage sending under Emails, Sending.'
                  : failed
                    ? 'After fixing it, check the connection again under Emails, Sending.'
                    : 'Finish under Emails, Sending: check the connection, verify the From address, then switch it on.'}
              </p>
              {canWrite ? (
                <Button asChild size="sm" variant="outline">
                  <a href={emailsHref}>Open Sending</a>
                </Button>
              ) : null}
            </div>
          ) : canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onConnect}>
                Connect Brevo
              </Button>
            </div>
          ) : null}
        </TabsContent>

        {connected && profile ? (
          <TabsContent value="credentials" className="space-y-3 pt-3">
            <p className="m-0 text-xs text-muted-foreground">
              Account details are shown in full. Keys and logins are never shown; this setup only
              tells you whether they are saved.
            </p>
            <dl className="m-0">
              <Row label="Connection method">{smtp ? 'SMTP' : 'API key'}</Row>
              {smtp ? (
                <Row label="Server">
                  <span className="flex items-center gap-1">
                    <span className="font-mono">
                      {profile.smtpHost}:{profile.smtpPort}
                    </span>
                    <CopyButton value={profile.smtpHost ?? ''} label="Copy server" />
                  </span>
                </Row>
              ) : null}
              <Row label="From address">
                {profile.fromAddress ? (
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 break-all font-mono">{profile.fromAddress}</span>
                    <CopyButton value={profile.fromAddress} label="Copy from address" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </Row>
              {(smtp ? ['SMTP login', 'SMTP key'] : ['API key']).map((label) => (
                <Row key={label} label={label}>
                  {profile.credentialsPresent ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">••••••••</span>
                      <Badge variant="muted">Saved · hidden</Badge>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not saved</span>
                  )}
                </Row>
              ))}
            </dl>
            {canWrite ? (
              <Button size="sm" variant="outline" onClick={onConnect}>
                Change credentials
              </Button>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                You can view this connection but not change its credentials.
              </p>
            )}
          </TabsContent>
        ) : null}

        {connected && profile ? (
          <TabsContent value="activity" className="space-y-3 pt-3">
            <ul className="m-0 list-disc space-y-1 pl-5 text-sm">
              <li>Connection: Brevo ({smtp ? 'SMTP' : 'API key'})</li>
              <li>
                Last check:{' '}
                {profile.connectionCheckedAt
                  ? `${formatDateTime(profile.connectionCheckedAt)}. ${
                      connectionLabels[profile.connectionStatus] ?? profile.connectionStatus
                    }`
                  : 'not checked yet'}
              </li>
              <li>
                Now:{' '}
                {active
                  ? 'guest emails go out through Brevo'
                  : `guest emails are sent by ${sendingNow}`}
              </li>
            </ul>
            <p className="m-0 text-xs text-muted-foreground">
              A full history of calls and errors is not recorded yet. Brevo keeps the log of every
              message in your Brevo account.
            </p>
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
