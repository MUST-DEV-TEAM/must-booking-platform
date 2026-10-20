'use client';
import type {
  NotificationSettingsResponse,
  NotificationTopicSettings,
  NotificationRecipientRule,
} from '@must/domain-contracts';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { SettingToggle as Toggle } from '../../components/ui/setting-toggle';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { RecordDirectory } from '../../components/ui/record-directory';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MultiSelect } from '../../components/ui/multi-select';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { emailRequest, createEmailWriter } from '../../lib/email-workspace';
import { EmailSendingSetup } from './email-sending-profile';

type Configuration = {
  version: number;
  senderName: string | null;
  replyTo: string | null;
  defaultLanguage: 'en' | 'sq';
};
type Preferences = {
  version: number;
  muteOptionalEmails: boolean;
  optionalEmails: { topic: string; label: string }[];
};
type Reviews = { links: Record<string, string>; sites: { key: string; label: string }[] };
export function EmailConfiguration({
  tenantId,
  base,
  canWrite,
}: {
  tenantId: string;
  base: string;
  canWrite: boolean;
}) {
  const config = useQuery({
    queryKey: ['emails', base, 'configuration'],
    queryFn: () => emailRequest<Configuration>(`${base}/email-configuration`),
  });
  const topics = useQuery({
    queryKey: ['emails', base, 'topics'],
    queryFn: () => emailRequest<NotificationSettingsResponse>(`${base}/notification-settings`),
  });
  const reviews = useQuery({
    queryKey: ['emails', base, 'reviews'],
    queryFn: () => emailRequest<Reviews>(`${base}/review-links`),
  });
  const sender = useQuery({
    queryKey: ['emails', base, 'sender'],
    queryFn: () =>
      emailRequest<{ fromAddress: string | null; replyTo: string | null; hotelName: string }>(
        `${base}/email-sender`,
      ),
  });
  const preferences = useQuery({
    queryKey: ['emails', tenantId, 'preferences'],
    queryFn: () => emailRequest<Preferences>(`/api/tenants/${tenantId}/my-email-preferences`),
  });
  const error = config.error ?? topics.error ?? reviews.error ?? sender.error ?? preferences.error;
  const refresh = () => {
    void config.refetch();
    void topics.refetch();
    void reviews.refetch();
    void sender.refetch();
    void preferences.refetch();
  };
  if (error)
    return (
      <ErrorPanel
        title="Email configuration unavailable"
        description={error.message}
        onRetry={refresh}
      />
    );
  if (!config.data || !topics.data || !reviews.data || !sender.data || !preferences.data)
    return <ListSkeleton />;
  return (
    <div className="flex flex-col gap-5">
      <EmailSendingSetup base={base} canWrite={canWrite} />
      <SenderEditor
        key={`sender/${config.data.version}`}
        base={base}
        config={config.data}
        sender={sender.data}
        canWrite={canWrite}
        refresh={refresh}
      />
      <Alert>
        <AlertDescription>
          Each matching recipient receives a separate private message. Duplicate addresses are sent
          once. Optional personal mute never silences urgent alerts. Clock hotels use these same
          MUST email settings.
        </AlertDescription>
      </Alert>
      {topics.data.topics.map((topic) => (
        <TopicEditor
          key={`${topic.topic}/${config.data!.version}`}
          topic={topic}
          options={topics.data!.options}
          base={base}
          version={config.data!.version}
          canWrite={canWrite}
          refresh={refresh}
        />
      ))}
      <ReviewEditor
        key={`reviews/${config.data.version}`}
        base={base}
        reviews={reviews.data}
        version={config.data.version}
        canWrite={canWrite}
        refresh={refresh}
      />
      <SuppressionList base={base} canWrite={canWrite} />
      <PersonalPreference
        base={base}
        data={preferences.data}
        canWrite={canWrite}
        refresh={refresh}
      />
    </div>
  );
}
function SenderEditor({
  base,
  config,
  sender,
  canWrite,
  refresh,
}: {
  base: string;
  config: Configuration;
  sender: { fromAddress: string | null; replyTo: string | null; hotelName: string };
  canWrite: boolean;
  refresh: () => void;
}) {
  const [name, setName] = useState(config.senderName ?? ''),
    [reply, setReply] = useState(config.replyTo ?? ''),
    [language, setLanguage] = useState<string>(config.defaultLanguage),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const writer = useRef(createEmailWriter()).current;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sender and language</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DetailList
          items={[
            { label: 'From address (platform managed)', value: sender.fromAddress ?? 'Unknown' },
            { label: 'Property name', value: sender.hotelName },
            { label: 'Domain authentication', value: 'Unknown - no diagnostic recorded' },
          ]}
        />
        <FormField
          label="Sender display name"
          htmlFor="email-sender-name"
          hint="Leave blank to inherit the hotel name. Applies to guest emails and rendered messages."
        >
          <Input
            id="email-sender-name"
            value={name}
            maxLength={100}
            disabled={!canWrite || busy}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField
          label="Reply-to address"
          htmlFor="email-reply-to"
          hint="Leave blank to inherit the property support address."
        >
          <Input
            id="email-reply-to"
            type="email"
            value={reply}
            disabled={!canWrite || busy}
            onChange={(e) => setReply(e.target.value)}
          />
        </FormField>
        <FormField
          label="Guest message wording language"
          hint="Albanian requires published translations for every supported guest template. Guest preferred language is not captured today. Generated layout labels and date wording remain English."
        >
          <Combobox
            label="Guest message wording language"
            value={language}
            onChange={setLanguage}
            disabled={!canWrite || busy}
            options={[
              { value: 'en', label: 'English' },
              { value: 'sq', label: 'Albanian' },
            ]}
          />
        </FormField>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          disabled={!canWrite || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await writer(
                base + '/email-configuration',
                {
                  version: config.version,
                  senderName: name.trim() || null,
                  replyTo: reply.trim() || null,
                  defaultLanguage: language,
                },
                'PUT',
              );
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Save failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save sender and language
        </Button>
      </CardContent>
    </Card>
  );
}
function ruleKey(rule: NotificationRecipientRule): string {
  switch (rule.target) {
    case 'MEMBERSHIP_ROLE':
      return 'role:' + rule.membershipRole;
    case 'ROLE_TEMPLATE':
      return 'template:' + rule.roleTemplateId;
    case 'STAFF_USER':
      return 'user:' + rule.userId;
    case 'EMAIL':
      return 'email:' + rule.email;
  }
}
function fromRuleKey(value: string): NotificationRecipientRule {
  if (value === 'role:OWNER' || value === 'role:ADMIN')
    return {
      target: 'MEMBERSHIP_ROLE',
      membershipRole: value === 'role:OWNER' ? 'OWNER' : 'ADMIN',
    };
  if (value.startsWith('template:'))
    return { target: 'ROLE_TEMPLATE', roleTemplateId: value.slice(9) };
  if (value.startsWith('user:')) return { target: 'STAFF_USER', userId: value.slice(5) };
  return { target: 'EMAIL', email: value.slice(6) };
}
export function TopicEditor({
  topic,
  options,
  base,
  version,
  canWrite,
  refresh,
}: {
  topic: NotificationTopicSettings;
  options: NotificationSettingsResponse['options'];
  base: string;
  version: number;
  canWrite: boolean;
  refresh: () => void;
}) {
  const [guest, setGuest] = useState(topic.guestEnabled),
    [staff, setStaff] = useState(topic.staffEnabled),
    [custom, setCustom] = useState(topic.customStaffRecipients),
    [rules, setRules] = useState(topic.rules.map(ruleKey)),
    [address, setAddress] = useState(''),
    [days, setDays] = useState(topic.daysOffset?.value ?? 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<{
    input: string;
    guest: boolean;
    staff: { email: string }[];
    suppressed?: { email: string; reason: string }[];
  } | null>(null);
  const writer = useRef(createEmailWriter()).current;
  const draft = {
    guestEnabled: guest,
    ...(topic.hasStaffEmail ? { staffEnabled: staff } : {}),
    customStaffRecipients: custom,
    rules: custom ? rules.map(fromRuleKey) : [],
    ...(topic.daysOffset ? { daysOffset: days } : {}),
  };
  const draftKey = JSON.stringify(draft);
  const currentPreview = preview?.input === draftKey ? preview : null;
  const choices = [
    { value: 'role:OWNER', label: 'All owners', group: 'Account roles' },
    { value: 'role:ADMIN', label: 'All admins', group: 'Account roles' },
    ...options.roleTemplates.map((role) => ({
      value: 'template:' + role.id,
      label: role.name,
      group: 'Property roles',
    })),
    ...options.staff.map((member) => ({
      value: 'user:' + member.userId,
      label: member.name || member.email,
      description: member.email,
      group: 'Staff',
    })),
    ...rules
      .filter((value) => value.startsWith('email:'))
      .map((value) => ({ value, label: value.slice(6), group: 'Extra addresses' })),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{topic.label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {topic.hasGuestEmail ? (
          <>
            <Badge variant="outline">Guest (booking email)</Badge>
            <p className="text-sm text-muted-foreground">
              The guest address comes from the booking and cannot be replaced here.
            </p>
            <Toggle
              label="Send guest email"
              checked={guest}
              disabled={!canWrite || busy}
              onChange={setGuest}
            />
          </>
        ) : null}
        {topic.hasStaffEmail ? (
          <>
            <Toggle
              label="Send staff email"
              checked={staff}
              disabled={!canWrite || busy}
              onChange={setStaff}
            />
            <Toggle
              label="Use custom staff recipients"
              checked={custom}
              disabled={!canWrite || busy}
              onChange={setCustom}
            />
            {custom ? (
              <>
                <MultiSelect
                  label={`${topic.label} recipients`}
                  options={choices}
                  value={rules}
                  onChange={setRules}
                  disabled={!canWrite || busy}
                  placeholder="Choose recipients"
                />
                <div className="flex gap-2">
                  <Input
                    aria-label={`${topic.label} extra email`}
                    type="email"
                    value={address}
                    disabled={!canWrite || busy}
                    placeholder="Extra email address"
                    onChange={(e) => setAddress(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!canWrite || busy || !address.trim()}
                    onClick={() => {
                      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())) {
                        setError('Enter a valid email address.');
                        return;
                      }
                      setRules((current) => [
                        ...new Set([...current, 'email:' + address.trim().toLowerCase()]),
                      ]);
                      setAddress('');
                      setError('');
                    }}
                  >
                    Add address
                  </Button>
                </div>
              </>
            ) : null}
            <DetailList
              stackOnMobile
              items={[
                {
                  label: 'Saved recipients',
                  value:
                    topic.staffRecipients.map((row) => row.email).join(', ') || 'No recipients',
                },
              ]}
            />
          </>
        ) : null}
        {topic.daysOffset ? (
          <FormField label={topic.daysOffset.label}>
            <Input
              aria-label={`${topic.label} days`}
              type="number"
              min={topic.daysOffset.min}
              max={topic.daysOffset.max}
              value={days}
              disabled={!canWrite || busy}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </FormField>
        ) : null}
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const result = await emailRequest<{
                guest: boolean;
                staff: { email: string }[];
                suppressed?: { email: string; reason: string }[];
              }>(`${base}/notification-settings/${topic.topic}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: draftKey,
              });
              setPreview({ ...result, input: draftKey });
            } catch (e) {
              setPreview(null);
              setError(e instanceof Error ? e.message : 'Recipient preview failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Preview recipients
        </Button>
        {currentPreview ? (
          <div role="status" className="flex flex-col gap-2">
            <DetailList
              stackOnMobile
              items={[
                ...(topic.hasGuestEmail
                  ? [
                      {
                        label: 'Guest',
                        value: currentPreview.guest
                          ? 'Guest (booking email)'
                          : 'Guest email switched off',
                      },
                    ]
                  : []),
                ...(topic.hasStaffEmail
                  ? [
                      {
                        label: 'Staff recipients for these choices',
                        value:
                          currentPreview.staff.map((row) => row.email).join(', ') ||
                          'No recipients',
                      },
                    ]
                  : []),
              ]}
            />
            {topic.hasStaffEmail && staff && !currentPreview.staff.length ? (
              <Alert variant="warning">
                <AlertDescription>
                  No staff will receive this email. Choose recipients or restore the default list.
                </AlertDescription>
              </Alert>
            ) : null}
            {currentPreview.suppressed?.length ? (
              <Alert variant="warning">
                <AlertDescription>
                  Suppressed addresses will not receive this email:{' '}
                  {currentPreview.suppressed
                    .map(({ email, reason }) => `${email} (${reason})`)
                    .join(', ')}
                  . Review suppressed recipients below after resolving the delivery problem or
                  confirming consent.
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Preview only. Nothing was saved or sent. Membership and personal optional-email
              preferences are checked again when sending.
            </p>
          </div>
        ) : preview ? (
          <p className="text-sm text-muted-foreground">
            Choices changed. Preview recipients again.
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          disabled={!canWrite || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await writer(
                `${base}/email-configuration/topics/${topic.topic}`,
                {
                  version,
                  ...draft,
                },
                'PUT',
              );
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Save failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save {topic.label.toLowerCase()}
        </Button>
      </CardContent>
    </Card>
  );
}
function ReviewEditor({
  base,
  reviews,
  version,
  canWrite,
  refresh,
}: {
  base: string;
  reviews: Reviews;
  version: number;
  canWrite: boolean;
  refresh: () => void;
}) {
  const [draft, setDraft] = useState(reviews.links),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const writer = useRef(createEmailWriter()).current;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review links</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertDescription>
            Every guest receives the same review links in the post-stay email.
          </AlertDescription>
        </Alert>
        {reviews.sites.map((site) => (
          <FormField key={site.key} label={site.label} htmlFor={`review-${site.key}`}>
            <Input
              id={`review-${site.key}`}
              type="url"
              placeholder="https://"
              value={draft[site.key] ?? ''}
              disabled={!canWrite || busy}
              onChange={(e) => setDraft({ ...draft, [site.key]: e.target.value })}
            />
          </FormField>
        ))}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          disabled={!canWrite || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await writer(
                base + '/email-configuration/review-links',
                { version, links: draft },
                'PUT',
              );
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Save failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save review links
        </Button>
      </CardContent>
    </Card>
  );
}
function PersonalPreference({
  base,
  data,
  canWrite,
  refresh,
}: {
  base: string;
  data: Preferences;
  canWrite: boolean;
  refresh: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const writer = useRef(createEmailWriter()).current;
  return (
    <Card>
      <CardHeader>
        <CardTitle>My optional emails</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Toggle
          label="Mute my non-urgent emails"
          checked={data.muteOptionalEmails}
          disabled={!canWrite || busy}
          onChange={async (checked) => {
            setBusy(true);
            setError('');
            try {
              await writer(
                base + '/email-configuration/preferences',
                { version: data.version, muteOptionalEmails: checked },
                'PUT',
              );
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Save failed.');
            } finally {
              setBusy(false);
            }
          }}
        />
        <DetailList
          items={[
            {
              label: 'Optional topics',
              value: data.optionalEmails.map((row) => row.label).join(', '),
            },
            {
              label: 'Scope',
              value: 'Your account across all properties. Urgent alerts remain enabled.',
            },
          ]}
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Suppression = { recipient: string; reason: string; version: number; updatedAt: string };
function SuppressionList({ base, canWrite }: { base: string; canWrite: boolean }) {
  const query = useQuery({
    queryKey: ['emails', base, 'suppressions'],
    queryFn: () => emailRequest<Suppression[]>(base + '/email-suppressions'),
  });
  const [selected, setSelected] = useState<Suppression | null>(null);
  const writer = useRef(createEmailWriter()).current;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suppressed recipients</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <AlertDescription>
            Permanent bounces and spam complaints block future MUST messages to this address at this
            hotel. Clear only after resolving the delivery problem or confirming consent. An old
            webhook replay cannot reinstate a cleared suppression.
          </AlertDescription>
        </Alert>
        {query.error ? (
          <ErrorPanel description={query.error.message} onRetry={() => void query.refetch()} />
        ) : !query.data ? (
          <ListSkeleton />
        ) : (
          <RecordDirectory
            storageKey="must.email-suppressions.table"
            rows={query.data.map((row) => ({ ...row, id: row.recipient }))}
            columns={[
              { id: 'recipient', label: 'Recipient', value: (row) => row.recipient },
              { id: 'reason', label: 'Reason', value: (row) => row.reason },
              {
                id: 'updated',
                label: 'Updated',
                value: (row) => new Date(row.updatedAt).toLocaleString(),
              },
            ]}
            emptyTitle="No suppressed recipients"
            onRow={setSelected}
            actions={
              canWrite
                ? (row) => [{ label: 'Clear suppression', onSelect: () => setSelected(row) }]
                : undefined
            }
          />
        )}
        <ConfirmDialog
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          title="Clear suppression"
          description={
            selected
              ? `Allow future messages to ${selected.recipient}. Previous suppressed messages are not automatically resent.`
              : ''
          }
          reasonLabel="Reason for clearing"
          reasonRequired
          reasonPlaceholder="Recorded with this email action"
          confirmDisabled={!canWrite}
          confirmLabel="Clear suppression"
          onConfirm={async (reason) => {
            if (!selected) return;
            await writer(base + '/email-suppressions/clear', {
              recipient: selected.recipient,
              version: selected.version,
              reason,
            });
            await query.refetch();
          }}
        />
      </CardContent>
    </Card>
  );
}
