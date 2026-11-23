'use client';

import { formatDateTime } from '../../lib/hotel-format';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { SettingToggle as Toggle } from '../../components/ui/setting-toggle';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { RecordDirectory } from '../../components/ui/record-directory';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { emailRequest, createEmailWriter } from '../../lib/email-workspace';
import { EmailStaffNotifications } from './email-staff-notifications';

export type EmailConfigurationData = Configuration;
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
export function EmailConfiguration<T extends { key: string; label: string }>({
  tenantId,
  base,
  canWrite,
  templates,
  renderEditor,
}: {
  tenantId: string;
  base: string;
  canWrite: boolean;
  templates: T[];
  renderEditor: (template: T, onClose: () => void) => ReactNode;
}) {
  const preferences = useQuery({
    queryKey: ['emails', tenantId, 'preferences'],
    queryFn: () => emailRequest<Preferences>(`/api/tenants/${tenantId}/my-email-preferences`),
  });
  return (
    <EmailStaffNotifications
      base={base}
      canWrite={canWrite}
      templates={templates}
      renderEditor={renderEditor}
      footer={
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:h-full">
          <ReviewLinksMoved />
          {preferences.data ? (
            <PersonalPreference
              base={base}
              data={preferences.data}
              canWrite={canWrite}
              refresh={() => void preferences.refetch()}
            />
          ) : null}
        </div>
      }
    />
  );
}
export function SenderEditor({
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
function ReviewLinksMoved() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review links</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert>
          <AlertDescription>
            Review links are set once under Settings, Contact and brand, and the post-stay email
            uses them from there.
          </AlertDescription>
        </Alert>
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
export function SuppressionList({ base, canWrite }: { base: string; canWrite: boolean }) {
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
                value: (row) => formatDateTime(row.updatedAt),
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
