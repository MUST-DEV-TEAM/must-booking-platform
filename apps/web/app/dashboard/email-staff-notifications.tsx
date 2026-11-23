'use client';

import { useRef, useState, type ReactNode } from 'react';
import type {
  NotificationRecipientRule,
  NotificationSettingsResponse,
  NotificationTopicSettings,
} from '@must/domain-contracts';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Combobox } from '../../components/ui/combobox';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MultiSelect } from '../../components/ui/multi-select';
import { SegmentedControl } from '../../components/ui/segmented-control';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { createEmailWriter, emailRequest } from '../../lib/email-workspace';
import {
  ALWAYS_NEEDS_RECIPIENT,
  STAFF_DEFAULT_RECIPIENTS,
  STAFF_TEMPLATE_BY_TOPIC,
  STAFF_WHEN,
} from './email-catalog';
import { fromRuleKey, ruleKey, useNotificationSettings } from './email-notification-data';

type Mode = 'default' | 'custom' | 'nobody';
const modeOf = (topic: NotificationTopicSettings): Mode =>
  !topic.staffEnabled ? 'nobody' : topic.customStaffRecipients ? 'custom' : 'default';

/** Who gets the staff email today, as short chips: the saved recipients, or "Nobody". */
function Recipients({ topic }: { topic: NotificationTopicSettings }) {
  const shown = topic.staffRecipients.slice(0, 3);
  const more = topic.staffRecipients.length - shown.length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {topic.hasGuestEmail && topic.guestEnabled ? <Badge variant="outline">Guest</Badge> : null}
        {!topic.staffEnabled ? (
          <Badge variant="muted">Staff: nobody</Badge>
        ) : shown.length ? (
          <>
            {shown.map((row) => (
              <Badge key={`${row.channel ?? 'TO'}|${row.email}`} variant="secondary">
                {row.channel && row.channel !== 'TO' ? `${row.channel}: ` : ''}
                {row.email}
              </Badge>
            ))}
            {more > 0 ? <Badge variant="muted">+{more} more</Badge> : null}
          </>
        ) : (
          <Badge variant="warning">No staff recipients</Badge>
        )}
      </div>
      {topic.staffEnabled ? (
        <span className="text-xs text-muted-foreground">
          {topic.customStaffRecipients
            ? 'Custom list'
            : (STAFF_DEFAULT_RECIPIENTS[topic.topic] ?? 'Default recipients')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Emails, Staff notifications: who receives each notification, in one table. A row opens a side panel to change the
 * recipients; the wording of the staff email is edited from there.
 */
export function EmailStaffNotifications<T extends { key: string; label: string }>({
  base,
  canWrite,
  templates,
  renderEditor,
  footer,
}: {
  base: string;
  canWrite: boolean;
  templates: T[];
  renderEditor: (template: T, onClose: () => void) => ReactNode;
  /** Smaller cards shown under the table. */
  footer?: ReactNode;
}) {
  const { config, topics, refresh } = useNotificationSettings(base);
  const [editing, setEditing] = useState<string | null>(null);
  const [wording, setWording] = useState<T | null>(null);
  const failure = config.error ?? topics.error;
  if (failure)
    return (
      <ErrorPanel
        title="Staff notifications unavailable"
        description={failure.message}
        onRetry={() => void refresh()}
      />
    );
  if (!config.data || !topics.data) return <ListSkeleton />;
  if (wording)
    return (
      <div className="flex flex-col gap-5">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setWording(null)}>
            ← Staff notifications
          </Button>
        </div>
        {renderEditor(wording, () => setWording(null))}
      </div>
    );
  const rows = topics.data.topics.filter((topic) => topic.hasStaffEmail);
  const topic = rows.find((row) => row.topic === editing);
  const staffTemplate = (name: string) =>
    templates.find((row) => row.key === STAFF_TEMPLATE_BY_TOPIC[name]);
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-3xl text-sm text-muted-foreground">
        Who receives each notification. A notification that also emails the guest shows Guest; that
        email is set up under Guest emails. Open a row to change who on your team receives it.
      </p>
      <Card className="py-0">
        <CardContent className="p-0">
          <Table className="min-w-[42rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22%]">Notification</TableHead>
                <TableHead className="w-[42%]">Who receives it</TableHead>
                <TableHead className="w-[26%]">Sent when</TableHead>
                <TableHead className="w-[10%] text-right">
                  <span className="sr-only">Edit</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.topic}>
                  <TableCell className="font-medium whitespace-normal">{row.label}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Recipients topic={row} />
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {STAFF_WHEN[row.topic] ?? ''}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit ${row.label}`}
                      onClick={() => setEditing(row.topic)}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {footer}
      {topic ? (
        <StaffNotificationPanel
          key={`${topic.topic}/${config.data.version}`}
          topic={topic}
          options={topics.data.options}
          base={base}
          version={config.data.version}
          canWrite={canWrite}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onEditWording={
            staffTemplate(topic.topic)
              ? () => {
                  setWording(staffTemplate(topic.topic)!);
                  setEditing(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/** The side panel for one notification: who on the team receives it, a preview, and a way to its wording. */
export function StaffNotificationPanel({
  topic,
  options,
  base,
  version,
  canWrite,
  onSaved,
  onClose,
  onEditWording,
}: {
  topic: NotificationTopicSettings;
  options: NotificationSettingsResponse['options'];
  base: string;
  version: number;
  canWrite: boolean;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
  onEditWording?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(modeOf(topic)),
    [rules, setRules] = useState(
      topic.rules.map(
        (rule: NotificationRecipientRule) => `${rule.channel ?? 'TO'}|${ruleKey(rule)}`,
      ),
    ),
    [address, setAddress] = useState(''),
    [addressChannel, setAddressChannel] = useState('TO'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [preview, setPreview] = useState<{
    input: string;
    staff: { email: string; channel?: 'TO' | 'CC' | 'BCC' }[];
    suppressed?: { email: string; reason: string }[];
  } | null>(null);
  const writer = useRef(createEmailWriter());
  const custom = mode === 'custom';
  const draft = {
    guestEnabled: topic.guestEnabled,
    staffEnabled: mode !== 'nobody',
    customStaffRecipients: custom,
    rules: custom
      ? rules.map((value) => {
          const [channel, ...key] = value.split('|');
          return { ...fromRuleKey(key.join('|')), channel: channel as 'TO' | 'CC' | 'BCC' };
        })
      : [],
    ...(topic.daysOffset ? { daysOffset: topic.daysOffset.value } : {}),
  };
  const draftKey = JSON.stringify(draft);
  const currentPreview = preview?.input === draftKey ? preview : null;
  const changed =
    draftKey !==
    JSON.stringify({
      guestEnabled: topic.guestEnabled,
      staffEnabled: topic.staffEnabled,
      customStaffRecipients: topic.customStaffRecipients,
      rules: topic.rules,
      ...(topic.daysOffset ? { daysOffset: topic.daysOffset.value } : {}),
    });
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
    ...[...new Set(rules.map((value) => value.slice(value.indexOf('|') + 1)))]
      .filter((value) => value.startsWith('email:'))
      .map((value) => ({ value, label: value.slice(6), group: 'Extra addresses' })),
  ];
  const modeOptions: Array<{ value: Mode; label: string }> = [
    { value: 'default', label: 'Default recipients' },
    { value: 'custom', label: 'Custom list' },
    ...(ALWAYS_NEEDS_RECIPIENT.has(topic.topic)
      ? []
      : [{ value: 'nobody' as Mode, label: 'Nobody' }]),
  ];
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{topic.label}</SheetTitle>
          <SheetDescription>Choose who on your team receives this notification.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {topic.hasGuestEmail ? (
            <p className="m-0 rounded-md bg-muted p-3 text-sm">
              <span className="font-semibold">Guest:</span> the guest also gets an email, at the
              address on the booking. That email is set up under Guest emails.
            </p>
          ) : null}
          <FormField label="Staff receive it">
            <SegmentedControl
              fullWidth
              label="Staff receive it"
              value={mode}
              disabled={!canWrite || busy}
              onChange={setMode}
              options={modeOptions}
            />
          </FormField>
          {mode === 'default' ? (
            <p className="m-0 text-sm text-muted-foreground">
              {STAFF_DEFAULT_RECIPIENTS[topic.topic] ?? 'The default recipients'}.
            </p>
          ) : null}
          {mode === 'nobody' ? (
            <p className="m-0 text-sm text-muted-foreground">
              No staff email is sent for this notification.
            </p>
          ) : null}
          {custom ? (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                To, CC and BCC apply to one staff email. To and CC are visible to its recipients;
                BCC stays hidden. Private guest booking links are not included.
              </p>
              {(['TO', 'CC', 'BCC'] as const).map((channel) => (
                <FormField
                  key={channel}
                  label={channel === 'TO' ? 'To' : channel}
                  hint={
                    channel === 'BCC'
                      ? 'Hidden from the other recipients.'
                      : channel === 'TO'
                        ? 'At least one available To recipient is required.'
                        : 'Visible to all To and CC recipients.'
                  }
                >
                  <MultiSelect
                    label={`${topic.label} ${channel} recipients`}
                    options={choices}
                    value={rules
                      .filter((value) => value.startsWith(channel + '|'))
                      .map((value) => value.slice(channel.length + 1))}
                    onChange={(values) =>
                      setRules((current) => [
                        ...current.filter((value) => !value.startsWith(channel + '|')),
                        ...values.map((value) => channel + '|' + value),
                      ])
                    }
                    disabled={!canWrite || busy}
                    placeholder={`Choose ${channel === 'TO' ? 'To' : channel} recipients`}
                  />
                </FormField>
              ))}
              <div className="flex flex-wrap gap-2">
                <Combobox
                  label={`${topic.label} extra address channel`}
                  value={addressChannel}
                  onChange={setAddressChannel}
                  options={['TO', 'CC', 'BCC'].map((value) => ({
                    value,
                    label: value === 'TO' ? 'To' : value,
                  }))}
                  disabled={!canWrite || busy}
                />
                <Input
                  aria-label={`${topic.label} extra email`}
                  type="email"
                  className="min-w-0 flex-1"
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
                      ...new Set([
                        ...current,
                        addressChannel + '|email:' + address.trim().toLowerCase(),
                      ]),
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
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="self-start"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await emailRequest<{
                    guest: boolean;
                    staff: { email: string; channel?: 'TO' | 'CC' | 'BCC' }[];
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
              Preview who gets it
            </Button>
            {currentPreview ? (
              <div role="status" className="flex flex-col gap-2">
                <p className="m-0 text-sm">
                  <span className="font-semibold">Staff recipients for these choices: </span>
                  {currentPreview.staff
                    .map((row) => `${row.channel ?? 'TO'}: ${row.email}`)
                    .join(', ') || 'No recipients'}
                </p>
                {mode !== 'nobody' && !currentPreview.staff.length ? (
                  <Alert variant="warning">
                    <AlertDescription>
                      No staff will receive this email. Choose recipients or use the default list.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {custom &&
                currentPreview.staff.length > 0 &&
                !currentPreview.staff.some((row) => !row.channel || row.channel === 'TO') ? (
                  <Alert variant="warning">
                    <AlertDescription>
                      No available To recipient. Add one before saving.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {currentPreview.suppressed?.length ? (
                  <Alert variant="warning">
                    <AlertDescription>
                      These blocked addresses will not receive this email:{' '}
                      {currentPreview.suppressed
                        .map(({ email, reason }) => `${email} (${reason})`)
                        .join(', ')}
                      .
                    </AlertDescription>
                  </Alert>
                ) : null}
                <p className="m-0 text-xs text-muted-foreground">
                  Preview only. Nothing was saved or sent. Membership and personal optional-email
                  preferences are checked again when sending.
                </p>
              </div>
            ) : preview ? (
              <p className="m-0 text-xs text-muted-foreground">
                Choices changed. Preview who gets it again.
              </p>
            ) : null}
          </div>
          {onEditWording ? (
            <div className="flex flex-col gap-1 border-t pt-4">
              <p className="m-0 text-sm font-semibold">Wording</p>
              <p className="m-0 text-sm text-muted-foreground">
                Change what this staff email says.
              </p>
              <Button variant="outline" className="self-start" onClick={onEditWording}>
                Edit the wording
              </Button>
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!canWrite || busy || !changed}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await writer.current(
                    `${base}/email-configuration/topics/${topic.topic}`,
                    { version, ...draft },
                    'PUT',
                  );
                  await onSaved();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Save failed.');
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
