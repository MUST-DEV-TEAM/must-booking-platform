'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
import { useUnsavedChanges, useUnsavedNavigation } from '../../components/ui/unsaved-changes';
import { createEmailWriter, emailRequest, EmailRequestError } from '../../lib/email-workspace';

type Mode = 'DEFAULT' | 'RESEND' | 'SMTP';
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
};
type CheckResult = { id: string; state: string; version: number; message: string };
type ProofResult = CheckResult & { deliveryStatus?: string };
const labels: Record<Mode, string> = {
  DEFAULT: 'Default MUST sender',
  RESEND: 'Own domain through Resend',
  SMTP: 'Custom SMTP',
};
const connectionLabels: Record<string, string> = {
  unknown: 'No current result',
  checking: 'Checking',
  verified: 'Connected',
  failed: 'Connection failed',
  stale: 'Setup changed',
};

/** Prepares write-only hotel sender setup and checks saved SMTP without activating custom delivery. */
export function EmailSendingSetup({ base, canWrite }: { base: string; canWrite: boolean }) {
  const guard = useUnsavedNavigation();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [proof, setProof] = useState<ProofResult | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const profile = useQuery({
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
        typeof row.fallbackGuest !== 'boolean'
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
      result={result}
      onResult={setResult}
      proof={proof}
      onProof={setProof}
      reload={() =>
        guard.request(() => {
          setReloadRevision((value) => value + 1);
          void profile.refetch();
        })
      }
      refresh={() => profile.refetch()}
    />
  );
}

function SendingEditor({
  base,
  profile,
  canWrite,
  reload,
  refresh,
  result,
  onResult,
  proof,
  onProof,
}: {
  base: string;
  profile: EmailSendingProfile;
  canWrite: boolean;
  reload: () => void;
  refresh: () => Promise<unknown>;
  result: CheckResult | null;
  onResult: (result: CheckResult | null) => void;
  proof: ProofResult | null;
  onProof: (result: ProofResult | null) => void;
}) {
  const [mode, setMode] = useState<Mode>(profile.mode),
    [name, setName] = useState(profile.fromName ?? ''),
    [address, setAddress] = useState(profile.fromAddress ?? ''),
    [domain, setDomain] = useState(profile.domain ?? ''),
    [host, setHost] = useState(profile.smtpHost ?? ''),
    [port, setPort] = useState(String(profile.smtpPort ?? 587)),
    [replace, setReplace] = useState(false),
    [username, setUsername] = useState(''),
    [secret, setSecret] = useState(''),
    [fallback, setFallback] = useState(profile.fallbackGuest),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [approval, setApproval] = useState<
      { kind: 'save'; body: Record<string, unknown> } | { kind: 'check'; version: number } | null
    >(null);
  const writer = useRef(createEmailWriter());
  const endpointChanged =
    mode !== profile.mode ||
    address.trim().toLowerCase() !== (profile.fromAddress ?? '') ||
    (mode === 'SMTP' &&
      (host.trim().toLowerCase() !== (profile.smtpHost ?? '') ||
        Number(port) !== profile.smtpPort)) ||
    (mode === 'RESEND' && domain.trim().toLowerCase() !== (profile.domain ?? ''));
  const needsCredentials =
    mode !== 'DEFAULT' && (endpointChanged || !profile.credentialsPresent || replace);
  const dirty =
    mode !== profile.mode ||
    name !== (profile.fromName ?? '') ||
    address !== (profile.fromAddress ?? '') ||
    domain !== (profile.domain ?? '') ||
    host !== (profile.smtpHost ?? '') ||
    port !== String(profile.smtpPort ?? 587) ||
    fallback !== profile.fallbackGuest ||
    replace ||
    !!username ||
    !!secret;
  const clean = useUnsavedChanges(dirty);
  const disabled = !canWrite || busy;
  const save = () => {
    setError('');
    if (mode !== 'DEFAULT' && (!address.trim() || !/^\S+@[^\s@]+\.[^\s@]+$/.test(address.trim()))) {
      setError('Enter a valid From email address.');
      return;
    }
    if (mode === 'SMTP' && !host.trim()) {
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
        smtpHost: mode === 'SMTP' ? host.trim() : undefined,
        smtpPort: mode === 'SMTP' ? Number(port) : undefined,
        smtpSecurity: mode === 'SMTP' ? (port === '465' ? 'TLS' : 'STARTTLS') : undefined,
        fallbackGuest: fallback,
        ...(needsCredentials
          ? { credentials: mode === 'SMTP' ? { username, password: secret } : { apiKey: secret } }
          : {}),
      },
    });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending options</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        <Alert>
          <AlertDescription>
            Saving prepares your setup; it does not activate custom sending. Current delivery
            continues with the sender shown above.
          </AlertDescription>
        </Alert>
        <FormField label="Sending option">
          <Combobox
            label="Sending option"
            value={mode}
            disabled={disabled}
            options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
            onChange={(value) => {
              if (value === 'DEFAULT' || value === 'RESEND' || value === 'SMTP') {
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
            ) : (
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
            )}
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
                  label={mode === 'SMTP' ? 'SMTP password / app password' : 'Resend API key'}
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
        {profile.mode === 'SMTP' ? (
          <>
            <DetailList
              items={[
                {
                  label: 'Saved SMTP connection',
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
              disabled={disabled || dirty || profile.connectionStatus === 'checking'}
              onClick={() => setApproval({ kind: 'check', version: profile.version })}
            >
              Check saved SMTP connection
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
                      caught instanceof Error ? caught.message : 'Connection result unavailable.',
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
        <div className="flex flex-wrap gap-2">
          <Button disabled={disabled || !dirty} onClick={save}>
            Save sending setup
          </Button>
          <Button variant="outline" disabled={busy} onClick={reload}>
            Reload sending setup
          </Button>
        </div>
        <ConfirmDialog
          open={!!approval}
          onOpenChange={(open) => {
            if (!open) setApproval(null);
          }}
          title={
            approval?.kind === 'check' ? 'Check saved SMTP connection?' : 'Save sending setup?'
          }
          description={
            approval?.kind === 'check'
              ? 'Checks DNS, encrypted connection and authentication only. No email is sent and the selected sender is unchanged.'
              : 'This stores pending setup. It does not activate custom delivery. Credentials are encrypted and never included in this confirmation.'
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
