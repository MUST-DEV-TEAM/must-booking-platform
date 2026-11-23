'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { SettingToggle } from '../../components/ui/setting-toggle';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { useUnsavedChanges, useUnsavedNavigation } from '../../components/ui/unsaved-changes';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BREVO_SMTP_HOST, BREVO_SMTP_PORT, brevoStartMode, onBrevo } from './brevo-setup';
import { EmailSenderActivation } from './email-sender-activation';
import { EmailSenderTest } from './email-sender-test';
import {
  createEmailWriter,
  emailRequest,
  EmailRequestError,
  verifiedEmailSenderSetup,
} from '../../lib/email-workspace';
import {
  EmailDomainSetup,
  validEmailDnsRecords,
  type EmailDnsRecord,
  type EmailDomainOperation,
  type EmailDmarcEvidence,
  validEmailDmarc,
} from './email-domain-setup';

type Mode = 'DEFAULT' | 'RESEND' | 'SMTP' | 'BREVO';
export type SendingMode = Mode;
/** Senders proven by a From-mailbox code and a saved connection check. */
const mailboxMode = (mode: Mode) => mode === 'SMTP' || mode === 'BREVO';
export type EmailSendingProfile = {
  version: number;
  mode: Mode;
  activeMode: Mode;
  fromName: string | null;
  fromAddress: string | null;
  domain: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecurity: string | null;
  fallbackGuest: boolean;
  credentialsPresent: boolean;
  fromVerifiedAt: string | null;
  connectionCheckedAt: string | null;
  connectionStatus: string;
  connectionOperationId: string | null;
  connectionExpiresAt: string | null;
  domainStatus: string;
  domainCheckedAt?: string | null;
  dnsRecords?: EmailDnsRecord[];
  dmarcEvidence?: EmailDmarcEvidence | null;
  serverOutboundIp?: string | null;
};
type CheckResult = { id: string; state: string; version: number; message: string };
type ProofResult = CheckResult & { deliveryStatus?: string };
const labels: Record<Mode, string> = {
  DEFAULT: 'Default MUST sender',
  RESEND: 'Own domain through Resend',
  SMTP: 'Custom SMTP',
  BREVO: 'Own Brevo account',
};
const connectionLabels: Record<string, string> = {
  unknown: 'No current result',
  checking: 'Checking',
  verified: 'Connected',
  failed: 'Connection failed',
  stale: 'Setup changed',
};

// The labels are exported under longer names so other screens use the same words.
export { labels as sendingOptionLabels, connectionLabels as sendingConnectionLabels };

/** The hotel's sending setup. The Emails page and the Brevo card on Integrations read the same saved answer. */
export function useEmailSendingProfile(base: string) {
  return useQuery({
    queryKey: ['emails', base, 'sending-profile'],
    queryFn: async () => {
      const row = await emailRequest<EmailSendingProfile>(base + '/email-configuration/sending');
      if (
        !row ||
        !Number.isSafeInteger(row.version) ||
        row.version < 1 ||
        !Object.hasOwn(labels, row.mode) ||
        !Object.hasOwn(labels, row.activeMode) ||
        typeof row.credentialsPresent !== 'boolean' ||
        typeof row.fallbackGuest !== 'boolean' ||
        (row.dnsRecords !== undefined && !validEmailDnsRecords(row.dnsRecords)) ||
        (row.dmarcEvidence !== undefined && !validEmailDmarc(row.dmarcEvidence))
      )
        throw new EmailRequestError(
          'Sending setup returned an invalid response. Reload before editing.',
          502,
          null,
        );
      return row;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    retry: false,
  });
}

/** Prepares write-only hotel sender setup and checks saved SMTP without activating custom delivery. */
export function EmailSendingSetup({
  base,
  canWrite,
  brevo = false,
  emailsHref,
  goLive = false,
  integrationsHref,
}: {
  base: string;
  canWrite: boolean;
  /** Show only the Brevo setup: the credentials Brevo provides (an API key, or an SMTP login and key). */
  brevo?: boolean;
  /** Where the Emails page is: checking, verifying and switching on happen there. */
  emailsHref?: string;
  /** The Sending tab: the setup as a numbered go-live flow, with Brevo's credentials kept in Integrations. */
  goLive?: boolean;
  /** Where Brevo's credentials are entered. */
  integrationsHref?: string;
}) {
  const queryClient = useQueryClient();
  const guard = useUnsavedNavigation();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [domainResult, setDomainResult] = useState<EmailDomainOperation | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const profile = useEmailSendingProfile(base);
  if (profile.error)
    return (
      <ErrorPanel
        title="Sending setup unavailable"
        description={profile.error.message}
        reference={
          profile.error instanceof EmailRequestError
            ? (profile.error.reference ?? undefined)
            : undefined
        }
        onRetry={() => void profile.refetch()}
      />
    );
  if (!profile.data) return <ListSkeleton />;
  return (
    <SendingEditor
      key={`${profile.data.version}/${reloadRevision}`}
      base={base}
      profile={profile.data}
      canWrite={canWrite}
      brevo={brevo}
      emailsHref={emailsHref}
      goLive={goLive}
      integrationsHref={integrationsHref}
      result={result}
      onResult={setResult}
      proof={proof}
      onProof={setProof}
      domainResult={domainResult}
      onDomainResult={setDomainResult}
      reload={() =>
        guard.request(() => {
          setReloadRevision((value) => value + 1);
          void profile.refetch();
        })
      }
      refresh={async () => {
        await profile.refetch();
        await queryClient.invalidateQueries({ queryKey: ['emails', base, 'overview'] });
      }}
    />
  );
}

function SendingEditor({
  base,
  profile,
  canWrite,
  brevo,
  emailsHref,
  goLive,
  integrationsHref,
  reload,
  refresh,
  result,
  onResult,
  proof,
  onProof,
  domainResult,
  onDomainResult,
}: {
  base: string;
  profile: EmailSendingProfile;
  canWrite: boolean;
  brevo: boolean;
  emailsHref?: string;
  goLive: boolean;
  integrationsHref?: string;
  reload: () => void;
  refresh: () => Promise<unknown>;
  result: CheckResult | null;
  onResult: (result: CheckResult | null) => void;
  proof: ProofResult | null;
  onProof: (result: ProofResult | null) => void;
  domainResult: EmailDomainOperation | null;
  onDomainResult: (result: EmailDomainOperation) => void;
}) {
  const [mode, setMode] = useState<Mode>(brevo ? brevoStartMode(profile) : profile.mode),
    [name, setName] = useState(profile.fromName ?? ''),
    [address, setAddress] = useState(profile.fromAddress ?? ''),
    [domain, setDomain] = useState(profile.domain ?? ''),
    [host, setHost] = useState(profile.smtpHost ?? ''),
    [port, setPort] = useState(String(profile.smtpPort ?? 587)),
    [replace, setReplace] = useState(false),
    [username, setUsername] = useState(''),
    [secret, setSecret] = useState(''),
    [fallback, setFallback] = useState(profile.fallbackGuest),
    [changeProvider, setChangeProvider] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [approval, setApproval] = useState<
      { kind: 'save'; body: Record<string, unknown> } | { kind: 'check'; version: number } | null
    >(null);
  const writer = useRef(createEmailWriter());
  // Brevo's relay address and port are fixed by Brevo; in the Brevo setup the hotel never types them.
  const smtpHost = brevo ? BREVO_SMTP_HOST : host.trim();
  const smtpPort = brevo ? BREVO_SMTP_PORT : Number(port);
  const endpointChanged =
    mode !== profile.mode ||
    address.trim().toLowerCase() !== (profile.fromAddress ?? '') ||
    (mode === 'SMTP' &&
      (smtpHost.toLowerCase() !== (profile.smtpHost ?? '') || smtpPort !== profile.smtpPort)) ||
    (mode === 'RESEND' && domain.trim().toLowerCase() !== (profile.domain ?? ''));
  const needsCredentials =
    mode !== 'DEFAULT' && (endpointChanged || !profile.credentialsPresent || replace);
  // The Brevo setup opens on its start method; that alone is not a change the hotel has made.
  const untouchedStart =
    brevo &&
    mode === brevoStartMode(profile) &&
    mode !== profile.mode &&
    !username &&
    !secret &&
    !replace &&
    name === (profile.fromName ?? '') &&
    address === (profile.fromAddress ?? '') &&
    fallback === profile.fallbackGuest;
  const dirty =
    !untouchedStart &&
    (mode !== profile.mode ||
      name !== (profile.fromName ?? '') ||
      address !== (profile.fromAddress ?? '') ||
      domain !== (profile.domain ?? '') ||
      host !== (profile.smtpHost ?? '') ||
      port !== String(profile.smtpPort ?? 587) ||
      fallback !== profile.fallbackGuest ||
      replace ||
      !!username ||
      !!secret);
  const clean = useUnsavedChanges(dirty);
  const disabled = !canWrite || busy;
  // In the go-live flow Brevo's credentials are kept in Integrations; this page only runs the steps after them.
  const managedByIntegrations = goLive && onBrevo(profile) && !changeProvider;
  const steps = goLiveSteps(profile);
  const stepNumber = (id: StepId) => steps.findIndex((step) => step.id === id) + 1;
  const save = () => {
    setError('');
    if (mode !== 'DEFAULT' && (!address.trim() || !/^\S+@[^\s@]+\.[^\s@]+$/.test(address.trim()))) {
      setError('Enter a valid From email address.');
      return;
    }
    if (mode === 'SMTP' && !brevo && !host.trim()) {
      setError('Enter the SMTP hostname.');
      return;
    }
    if (mode === 'RESEND' && !domain.trim()) {
      setError('Enter the sending domain.');
      return;
    }
    if (needsCredentials && (!secret.length || (mode === 'SMTP' && !username.length))) {
      setError('Enter complete replacement credentials. Saved secrets are never shown.');
      return;
    }
    setApproval({
      kind: 'save',
      body: {
        version: profile.version,
        mode,
        fromName: mode === 'DEFAULT' ? null : name.trim() || null,
        fromAddress: mode === 'DEFAULT' ? null : address.trim(),
        domain: mode === 'RESEND' ? domain.trim() : undefined,
        smtpHost: mode === 'SMTP' ? smtpHost : undefined,
        smtpPort: mode === 'SMTP' ? smtpPort : undefined,
        smtpSecurity: mode === 'SMTP' ? (!brevo && port === '465' ? 'TLS' : 'STARTTLS') : undefined,
        fallbackGuest: fallback,
        ...(needsCredentials
          ? { credentials: mode === 'SMTP' ? { username, password: secret } : { apiKey: secret } }
          : {}),
      },
    });
  };
  const genericTop = (
    <>
      {goLive ? null : (
        <DetailList
          items={[
            { label: 'Currently sending with', value: labels[profile.activeMode] },
            { label: 'Saved setup', value: labels[profile.mode] },
            {
              label: 'Custom credentials',
              value: profile.credentialsPresent ? 'Saved — replace to rotate' : 'Not saved',
            },
          ]}
        />
      )}
      <Alert>
        <AlertDescription>
          Saving does not activate a sender. Changing credentials, endpoint or From address pauses
          new custom delivery and requires verification again. Already frozen attempts keep their
          original sender.
        </AlertDescription>
      </Alert>
      <FormField label="Sending option">
        <Combobox
          label="Sending option"
          value={mode}
          disabled={disabled}
          options={Object.entries(labels)
            .filter(([value]) => !goLive || value !== 'BREVO')
            .map(([value, label]) => ({ value, label }))}
          onChange={(value) => {
            if (
              value === 'DEFAULT' ||
              value === 'RESEND' ||
              value === 'SMTP' ||
              value === 'BREVO'
            ) {
              setMode(value);
              setSecret('');
              setUsername('');
              setReplace(false);
            }
          }}
        />
      </FormField>
      {mode !== 'DEFAULT' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              label="Custom From name"
              htmlFor="sending-from-name"
              hint="Leave blank to use the hotel name."
            >
              <Input
                id="sending-from-name"
                value={name}
                maxLength={100}
                disabled={disabled}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Custom From address" htmlFor="sending-from-address" required>
              <Input
                id="sending-from-address"
                type="email"
                required
                value={address}
                disabled={disabled}
                onChange={(e) => setAddress(e.target.value)}
              />
            </FormField>
          </div>
          {mode === 'RESEND' ? (
            <FormField
              label="Sending domain"
              htmlFor="sending-domain"
              required
              hint="The From address must belong to this exact domain."
            >
              <Input
                id="sending-domain"
                required
                value={domain}
                disabled={disabled}
                onChange={(e) => setDomain(e.target.value)}
              />
            </FormField>
          ) : mode === 'SMTP' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label="SMTP hostname"
                htmlFor="sending-smtp-host"
                required
                hint="Use a public hostname. Internal addresses and unencrypted connections are blocked."
              >
                <Input
                  id="sending-smtp-host"
                  required
                  value={host}
                  disabled={disabled}
                  onChange={(e) => setHost(e.target.value)}
                />
              </FormField>
              <FormField label="SMTP port and security">
                <Combobox
                  label="SMTP port and security"
                  value={port}
                  disabled={disabled}
                  onChange={setPort}
                  options={[
                    { value: '465', label: '465 — SSL/TLS' },
                    { value: '587', label: '587 — required STARTTLS' },
                    { value: '2525', label: '2525 — required STARTTLS' },
                  ]}
                />
              </FormField>
            </div>
          ) : null}
          {mode === 'BREVO' ? (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  In Brevo, create an API key under SMTP &amp; API → API keys. The From address must
                  be an active sender in that Brevo account.
                </span>
                <span>
                  If your Brevo account blocks unknown IP addresses, add MUST&apos;s server under
                  Security → Authorised IPs:{' '}
                  <strong>{profile.serverOutboundIp ?? 'ask MUST support for the address'}</strong>
                </span>
                <span>
                  Authenticate your domain in Brevo (Senders, domains → Domains). Until then, Brevo
                  shows its own address as the sender instead of yours.
                </span>
                <div className="flex flex-wrap gap-3">
                  <a
                    className="underline"
                    href="https://app.brevo.com/settings/keys/api"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Brevo API keys
                  </a>
                  <a
                    className="underline"
                    href="https://app.brevo.com/security/authorised_ips"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Brevo authorised IPs
                  </a>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {mode === 'SMTP' ? (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  Gmail / Google Workspace: enable 2-Step Verification and use an app password, if
                  your account administrator allows it. Use your full email as the username. Your
                  normal Google password will not work here.
                </span>
                <span>
                  Personal Gmail has a 500-message daily limit. Workspace allows up to 2,000
                  messages in a rolling 24 hours; trial accounts are limited to 500. Other account
                  and recipient limits can be lower. These limits include mail sent outside MUST.
                </span>
                <span>
                  Google or Microsoft sign-in is not available yet. Check your account policy before
                  choosing SMTP.
                </span>
                <div className="flex flex-wrap gap-3">
                  <a
                    className="underline"
                    href="https://support.google.com/accounts/answer/185833"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google app-password setup
                  </a>
                  <a
                    className="underline"
                    href="https://support.google.com/mail/answer/22839"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Personal Gmail limits
                  </a>
                  <a
                    className="underline"
                    href="https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Workspace sending limits
                  </a>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          {profile.credentialsPresent && !endpointChanged ? (
            <SettingToggle
              label="Replace saved credentials"
              checked={replace}
              disabled={disabled}
              onChange={(value) => {
                setReplace(value);
                setSecret('');
                setUsername('');
              }}
            />
          ) : null}
          {needsCredentials ? (
            <div className="grid gap-4 md:grid-cols-2">
              {mode === 'SMTP' ? (
                <FormField label="SMTP username" htmlFor="sending-smtp-username" required>
                  <Input
                    id="sending-smtp-username"
                    required
                    autoComplete="off"
                    value={username}
                    disabled={disabled}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </FormField>
              ) : null}
              <FormField
                label={
                  mode === 'SMTP'
                    ? 'SMTP password / app password'
                    : mode === 'BREVO'
                      ? 'Brevo API key'
                      : 'Resend API key'
                }
                htmlFor="sending-secret"
                required
                hint="Encrypted for this hotel. Never returned; rotate by replacement."
              >
                <Input
                  id="sending-secret"
                  required
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  disabled={disabled}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </FormField>
            </div>
          ) : null}
          <SettingToggle
            label="Fall back to MUST for guest transactional mail when custom sending fails"
            checked={fallback}
            disabled={disabled}
            onChange={setFallback}
          />
          <Alert>
            <AlertDescription>
              This preference applies when custom sending is activated. Fallback is recorded. A
              message will not be sent twice when delivery is uncertain.
            </AlertDescription>
          </Alert>
        </>
      ) : null}
    </>
  );
  const goLiveTop = (
    <>
      {profile.mode !== 'DEFAULT' ? (
        <GoLiveSteps steps={steps.filter((step) => step.tracked)} />
      ) : null}
      <StepSection
        n={profile.mode === 'DEFAULT' && !onBrevo(profile) ? undefined : 1}
        title={profile.mode === 'DEFAULT' ? 'Choose your provider' : 'Provider and credentials'}
      >
        {managedByIntegrations ? (
          <>
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <p className="m-0 text-sm">
                Brevo is connected.{' '}
                {mode === 'SMTP' ? 'Its SMTP login and key are' : 'Its API key is'} kept in
                Integrations, not here.
              </p>
              {integrationsHref ? (
                <Button asChild size="sm" variant="outline" className="self-start">
                  <a href={integrationsHref}>Open Brevo in Integrations</a>
                </Button>
              ) : null}
              <SettingToggle
                label="If Brevo fails, send guest booking and payment emails through MUST instead"
                checked={fallback}
                disabled={disabled}
                onChange={setFallback}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={disabled || !dirty} onClick={save}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setChangeProvider(true);
                    setMode('DEFAULT');
                  }}
                >
                  Use a different provider
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            {!onBrevo(profile) && integrationsHref ? (
              <p className="m-0 text-sm text-muted-foreground">
                Using Brevo?{' '}
                <a className="underline" href={integrationsHref}>
                  Connect it in Integrations
                </a>
                , then come back here to switch it on.
              </p>
            ) : null}
            {genericTop}
          </>
        )}
      </StepSection>
    </>
  );
  return (
    <Card className={brevo || goLive ? 'border-0 py-0 shadow-none' : undefined}>
      {brevo || goLive ? null : (
        <CardHeader>
          <CardTitle>Sending options</CardTitle>
        </CardHeader>
      )}
      <CardContent className={brevo || goLive ? 'flex flex-col gap-4 px-0' : 'flex flex-col gap-4'}>
        {brevo ? (
          <>
            {!onBrevo(profile) && profile.mode !== 'DEFAULT' ? (
              <Alert>
                <AlertDescription>
                  This hotel currently sends with {labels[profile.mode]}. Saving a Brevo setup
                  replaces it.
                </AlertDescription>
              </Alert>
            ) : null}
            <FormField
              label="Connection method"
              hint={
                mode === 'SMTP'
                  ? 'Brevo SMTP relay: an SMTP login and an SMTP key.'
                  : 'Recommended: one API key from your Brevo account.'
              }
            >
              <SegmentedControl
                fullWidth
                label="Connection method"
                disabled={disabled}
                value={mode === 'SMTP' ? 'SMTP' : 'BREVO'}
                onChange={(value) => {
                  setMode(value);
                  setSecret('');
                  setUsername('');
                  setReplace(false);
                  if (value === 'SMTP') {
                    setHost(BREVO_SMTP_HOST);
                    setPort(String(BREVO_SMTP_PORT));
                  } else {
                    setHost(profile.smtpHost ?? '');
                    setPort(String(profile.smtpPort ?? 587));
                  }
                }}
                options={[
                  { value: 'BREVO', label: 'API key' },
                  { value: 'SMTP', label: 'SMTP' },
                ]}
              />
            </FormField>
            {mode === 'SMTP' ? (
              <DetailList
                items={[
                  {
                    label: 'Server',
                    value: `${BREVO_SMTP_HOST} · port ${BREVO_SMTP_PORT} · STARTTLS`,
                  },
                ]}
              />
            ) : null}
            {!profile.fromAddress ? (
              <FormField
                label="From address"
                htmlFor="sending-from-address"
                required
                hint="The address guests see. It must be a sender you have added in your Brevo account."
              >
                <Input
                  id="sending-from-address"
                  type="email"
                  required
                  value={address}
                  disabled={disabled}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </FormField>
            ) : null}
            {profile.credentialsPresent && onBrevo(profile) && !endpointChanged ? (
              <SettingToggle
                label="Replace saved credentials"
                checked={replace}
                disabled={disabled}
                onChange={(value) => {
                  setReplace(value);
                  setSecret('');
                  setUsername('');
                }}
              />
            ) : null}
            {needsCredentials ? (
              <div className="grid gap-4 md:grid-cols-2">
                {mode === 'SMTP' ? (
                  <FormField label="SMTP login" htmlFor="sending-smtp-username" required>
                    <Input
                      id="sending-smtp-username"
                      required
                      autoComplete="off"
                      value={username}
                      disabled={disabled}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </FormField>
                ) : null}
                <FormField
                  label={mode === 'SMTP' ? 'SMTP key' : 'API key'}
                  htmlFor="sending-secret"
                  required
                  hint="Encrypted for this hotel. Never shown again; replace it to change it."
                >
                  <Input
                    id="sending-secret"
                    required
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    disabled={disabled}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </FormField>
              </div>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                The credentials are saved and hidden. Turn on Replace saved credentials to change
                them. Brevo sending then pauses until the sender is verified again under Emails,
                Sending.
              </p>
            )}
            <p className="m-0 text-xs text-muted-foreground">
              Saving does not switch guest emails over. Finish under Emails, Sending: check the
              connection, verify the From address, then switch it on. That is also where you go back
              to the MUST sender.
            </p>
            {emailsHref ? (
              <Button asChild size="sm" variant="outline" className="self-start">
                <a href={emailsHref}>Open Sending</a>
              </Button>
            ) : null}
          </>
        ) : goLive ? (
          goLiveTop
        ) : (
          genericTop
        )}
        {!brevo && !goLive ? (
          <>
            {profile.activeMode !== 'DEFAULT' ? (
              <Alert>
                <AlertDescription>
                  Pause custom sending before running saved domain or connection diagnostics. The
                  current verification evidence is shown below.
                </AlertDescription>
              </Alert>
            ) : null}
            {!mailboxMode(profile.mode) ? (
              <EmailDomainSetup
                base={base}
                version={profile.version}
                mode={profile.mode}
                status={profile.domainStatus}
                records={profile.dnsRecords}
                dmarc={profile.dmarcEvidence}
                disabled={disabled || dirty || profile.activeMode !== 'DEFAULT'}
                busy={busy}
                setBusy={setBusy}
                result={domainResult}
                onResult={onDomainResult}
                refresh={refresh}
              />
            ) : null}
            {mailboxMode(profile.mode) ? (
              <>
                <DetailList
                  items={[
                    {
                      label:
                        profile.mode === 'BREVO'
                          ? 'Saved Brevo connection'
                          : 'Saved SMTP connection',
                      value: (
                        <Badge variant="outline">
                          {connectionLabels[
                            result && result.id === profile.connectionOperationId
                              ? result.state
                              : profile.connectionStatus
                          ] ?? 'No current result'}
                        </Badge>
                      ),
                    },
                    {
                      label: 'From mailbox',
                      value: profile.fromVerifiedAt ? 'Verified' : 'Not verified',
                    },
                  ]}
                />
                <Button
                  variant="outline"
                  disabled={
                    disabled ||
                    dirty ||
                    profile.activeMode !== 'DEFAULT' ||
                    profile.connectionStatus === 'checking'
                  }
                  onClick={() => setApproval({ kind: 'check', version: profile.version })}
                >
                  {profile.mode === 'BREVO'
                    ? 'Check saved Brevo connection'
                    : 'Check saved SMTP connection'}
                </Button>
                {dirty ? (
                  <p className="m-0 text-xs text-muted-foreground">
                    Save or reload setup before checking the saved connection.
                  </p>
                ) : null}
                <MailboxVerification
                  base={base}
                  profile={profile}
                  disabled={disabled || dirty}
                  busy={busy}
                  setBusy={setBusy}
                  result={proof}
                  onResult={onProof}
                  refresh={refresh}
                />
                {profile.connectionOperationId ? (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        const response = await emailRequest<CheckResult>(
                          base +
                            '/email-configuration/sending/operations/' +
                            profile.connectionOperationId,
                        );
                        onResult(response);
                        if (!dirty) await refresh();
                      } catch (caught) {
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : 'Connection result unavailable.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Refresh connection result
                  </Button>
                ) : null}
              </>
            ) : null}
            <EmailSenderActivation
              base={base}
              profile={profile}
              disabled={disabled || dirty}
              setBusy={setBusy}
              refresh={refresh}
            />
            <EmailSenderTest
              key={base}
              base={base}
              profile={profile}
              disabled={disabled || dirty}
              busy={busy}
              setBusy={setBusy}
            />
          </>
        ) : null}
        {goLive && profile.mode !== 'DEFAULT' ? (
          <>
            {profile.activeMode !== 'DEFAULT' ? (
              <Alert>
                <AlertDescription>
                  Pause custom sending before running saved domain or connection diagnostics. The
                  current verification evidence is shown below.
                </AlertDescription>
              </Alert>
            ) : null}
            {profile.mode === 'RESEND' ? (
              <StepSection n={stepNumber('domain')} title="Verify the sending domain">
                <EmailDomainSetup
                  base={base}
                  version={profile.version}
                  mode={profile.mode}
                  status={profile.domainStatus}
                  records={profile.dnsRecords}
                  dmarc={profile.dmarcEvidence}
                  disabled={disabled || dirty || profile.activeMode !== 'DEFAULT'}
                  busy={busy}
                  setBusy={setBusy}
                  result={domainResult}
                  onResult={onDomainResult}
                  refresh={refresh}
                />
              </StepSection>
            ) : null}
            {mailboxMode(profile.mode) ? (
              <>
                <StepSection n={stepNumber('check')} title="Check the connection">
                  <DetailList
                    items={[
                      {
                        label:
                          profile.mode === 'BREVO'
                            ? 'Saved Brevo connection'
                            : 'Saved SMTP connection',
                        value: (
                          <Badge variant="outline">
                            {connectionLabels[
                              result && result.id === profile.connectionOperationId
                                ? result.state
                                : profile.connectionStatus
                            ] ?? 'No current result'}
                          </Badge>
                        ),
                      },
                      {
                        label: 'From mailbox',
                        value: profile.fromVerifiedAt ? 'Verified' : 'Not verified',
                      },
                    ]}
                  />
                  <Button
                    variant="outline"
                    disabled={
                      disabled ||
                      dirty ||
                      profile.activeMode !== 'DEFAULT' ||
                      profile.connectionStatus === 'checking'
                    }
                    onClick={() => setApproval({ kind: 'check', version: profile.version })}
                  >
                    {profile.mode === 'BREVO'
                      ? 'Check saved Brevo connection'
                      : 'Check saved SMTP connection'}
                  </Button>
                  {dirty ? (
                    <p className="m-0 text-xs text-muted-foreground">
                      Save or reload setup before checking the saved connection.
                    </p>
                  ) : null}
                </StepSection>
                <StepSection n={stepNumber('verify')} title="Verify the From address">
                  <MailboxVerification
                    base={base}
                    profile={profile}
                    disabled={disabled || dirty}
                    busy={busy}
                    setBusy={setBusy}
                    result={proof}
                    onResult={onProof}
                    refresh={refresh}
                  />
                  {profile.connectionOperationId ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          const response = await emailRequest<CheckResult>(
                            base +
                              '/email-configuration/sending/operations/' +
                              profile.connectionOperationId,
                          );
                          onResult(response);
                          if (!dirty) await refresh();
                        } catch (caught) {
                          setError(
                            caught instanceof Error
                              ? caught.message
                              : 'Connection result unavailable.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Refresh connection result
                    </Button>
                  ) : null}
                </StepSection>
              </>
            ) : null}
            <StepSection n={stepNumber('test')} title="Send a test email" optional>
              <EmailSenderTest
                key={base}
                base={base}
                profile={profile}
                disabled={disabled || dirty}
                busy={busy}
                setBusy={setBusy}
              />
            </StepSection>
            <StepSection n={stepNumber('activate')} title="Switch it on">
              <EmailSenderActivation
                base={base}
                profile={profile}
                disabled={disabled || dirty}
                setBusy={setBusy}
                refresh={refresh}
              />
            </StepSection>
          </>
        ) : null}
        {result &&
        (result.id === profile.connectionOperationId ||
          (result.state === 'stale' && result.version === profile.version)) ? (
          <Alert variant={result.state === 'failed' ? 'destructive' : 'default'}>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {managedByIntegrations ? null : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled || !dirty} onClick={save}>
              {brevo ? 'Save Brevo setup' : 'Save sending setup'}
            </Button>
            {brevo ? null : (
              <Button variant="outline" disabled={busy} onClick={reload}>
                Reload sending setup
              </Button>
            )}
          </div>
        )}
        <ConfirmDialog
          open={!!approval}
          onOpenChange={(open) => {
            if (!open) setApproval(null);
          }}
          title={approval?.kind === 'check' ? 'Check saved connection?' : 'Save sending setup?'}
          description={
            approval?.kind === 'check'
              ? 'Checks DNS, encrypted connection and authentication only. No email is sent and the selected sender is unchanged.'
              : 'Saving does not activate a sender. Changing credentials, endpoint or From address pauses new custom sending and clears verification. Cosmetic edits preserve activation. Frozen attempts keep their original sender. Credentials are encrypted and never included here.'
          }
          confirmLabel={approval?.kind === 'check' ? 'Check connection' : 'Save setup'}
          reasonLabel="Reason"
          reasonRequired
          confirmDisabled={!canWrite}
          reasonPlaceholder="Why you are changing or checking this setup"
          onConfirm={async (reason) => {
            if (!approval) return;
            setBusy(true);
            try {
              if (approval.kind === 'save') {
                await writer.current<EmailSendingProfile>(
                  base + '/email-configuration/sending',
                  { ...approval.body, reason },
                  'PUT',
                );
                setSecret('');
                setUsername('');
                setReplace(false);
                writer.current = createEmailWriter();
                onResult(null);
                clean();
              } else {
                const checked = await writer.current<CheckResult>(
                  base + '/email-configuration/sending/check',
                  { version: approval.version, reason },
                );
                onResult(checked);
              }
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

/** Verifies a saved SMTP mailbox without activating sending or retaining its secret in cache. */
function MailboxVerification({
  base,
  profile,
  disabled,
  busy,
  setBusy,
  result,
  onResult,
  refresh,
}: {
  base: string;
  profile: EmailSendingProfile;
  disabled: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  result: ProofResult | null;
  onResult: (value: ProofResult | null) => void;
  refresh: () => Promise<unknown>;
}) {
  const [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [requesting, setRequesting] = useState(false);
  const requestWriter = useRef(createEmailWriter()),
    confirmWriter = useRef(createEmailWriter());
  const endpoint = base + '/email-configuration/sending/verify-from';
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (!fragment.has('sender-proof')) return;
    const copied = fragment.get('sender-proof') ?? '';
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
    if (copied.length <= 100) setCode(copied);
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted-foreground">
        Prove that you can receive email at the saved From address. MUST sends a code valid for 30
        minutes. Verification does not activate custom sending.
      </p>
      <Button
        variant="outline"
        disabled={disabled || profile.connectionStatus !== 'verified'}
        onClick={() => setRequesting(true)}
      >
        Email a verification code
      </Button>
      <FormField
        label="Sender verification code"
        htmlFor="sender-verification-code"
        hint="Paste the complete code from the email."
      >
        <Input
          id="sender-verification-code"
          value={code}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => setCode(e.target.value)}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled || !code.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const response = await confirmWriter.current<ProofResult>(endpoint + '/confirm', {
                version: profile.version,
                code: code.trim(),
              });
              onResult(response);
              if (response.state === 'verified') {
                setCode('');
                confirmWriter.current = createEmailWriter();
                await refresh();
              }
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Verification unavailable.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Verify From address
        </Button>
        {result ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                onResult(await emailRequest<ProofResult>(endpoint + '/' + result.id));
              } catch (caught) {
                setError(
                  caught instanceof Error ? caught.message : 'Verification status unavailable.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh verification status
          </Button>
        ) : null}
      </div>
      {result ? (
        <Alert
          variant={
            ['invalid', 'locked', 'expired', 'superseded'].includes(result.state)
              ? 'destructive'
              : 'default'
          }
        >
          <AlertDescription>
            {result.version === profile.version
              ? result.message
              : 'Saved sender setup changed. Refresh verification status.'}
            {result.deliveryStatus
              ? ` Email delivery: ${result.deliveryStatus.toLowerCase()}.`
              : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={requesting}
        onOpenChange={setRequesting}
        title="Verify the saved From address?"
        description={`MUST will email a code to ${profile.fromAddress ?? 'the saved address'}. This does not activate custom sending. Three requests per rolling hour are allowed.`}
        confirmLabel="Send verification code"
        cancelLabel="Cancel"
        reasonRequired
        reasonLabel="Reason"
        reasonPlaceholder="Why this hotel needs mailbox verification"
        confirmDisabled={disabled}
        onConfirm={async (reason) => {
          setBusy(true);
          setError('');
          try {
            const response = await requestWriter.current<ProofResult>(endpoint, {
              version: profile.version,
              reason,
            });
            onResult(response);
            setCode('');
            await refresh();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

type StepId = 'provider' | 'check' | 'domain' | 'verify' | 'test' | 'activate';
type GoLiveStep = { id: StepId; label: string; done: boolean; tracked: boolean };

/** The steps from choosing a provider to switching it on, for the saved setup. */
function goLiveSteps(profile: EmailSendingProfile): GoLiveStep[] {
  const active = profile.activeMode !== 'DEFAULT' && profile.activeMode === profile.mode;
  if (mailboxMode(profile.mode))
    return [
      {
        id: 'provider',
        label: 'Credentials saved',
        done: profile.credentialsPresent,
        tracked: true,
      },
      {
        id: 'check',
        label: 'Connection checked',
        done: profile.connectionStatus === 'verified',
        tracked: true,
      },
      {
        id: 'verify',
        label: 'From address verified',
        done: !!profile.fromVerifiedAt,
        tracked: true,
      },
      { id: 'test', label: 'Test email', done: false, tracked: false },
      { id: 'activate', label: 'Switched on', done: active, tracked: true },
    ];
  return [
    { id: 'provider', label: 'Provider saved', done: profile.credentialsPresent, tracked: true },
    {
      id: 'domain',
      label: 'Domain verified',
      done: verifiedEmailSenderSetup(profile),
      tracked: true,
    },
    { id: 'test', label: 'Test email', done: false, tracked: false },
    { id: 'activate', label: 'Switched on', done: active, tracked: true },
  ];
}

/** How far the go-live steps have got. */
function GoLiveSteps({ steps }: { steps: GoLiveStep[] }) {
  return (
    <ol
      aria-label="Go-live progress"
      className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-2 p-0"
    >
      {steps.map((step, index) => (
        <li key={step.id} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
              step.done ? 'border-success bg-success text-white' : 'text-muted-foreground',
            )}
          >
            {step.done ? <Check className="size-3" /> : index + 1}
          </span>
          <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>
            {step.label}
            {step.done ? <span className="sr-only"> (done)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One numbered part of the go-live flow. */
function StepSection({
  n,
  title,
  optional = false,
  children,
}: {
  n?: number;
  title: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={n ? `Step ${n}: ${title}` : title}
      className="flex flex-col gap-3 border-t pt-4"
    >
      <h3 className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold">
        {n ? (
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-full bg-muted text-xs"
          >
            {n}
          </span>
        ) : null}
        {title}
        {optional ? <Badge variant="muted">Optional</Badge> : null}
      </h3>
      {children}
    </section>
  );
}
