'use client';
import {
  UnsavedChangesBoundary,
  useUnsavedNavigation,
  useUnsavedChanges,
} from '../../components/ui/unsaved-changes';
import { TextComparison } from '../../components/ui/text-comparison';
import { EmailHealthOverview } from './email-health-overview';
import { EmailConfiguration } from './email-configuration';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input, Textarea } from '../../components/ui/input';
import { MessagePreview } from '../../components/ui/message-preview';
import { PageHeader } from '../../components/ui/page-header';
import { QuickPeek } from '../../components/ui/quick-peek';
import { RecordDirectory } from '../../components/ui/record-directory';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { TabBar } from '../../components/ui/tab-bar';
import {
  createEmailWriter,
  emailRequest,
  EmailRequestError,
  type EmailTemplate,
  type EmailVersions,
  type EmailOverview,
  type EmailPage,
  type EmailMessage,
} from '../../lib/email-workspace';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'templates', label: 'Templates' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'configuration', label: 'Configuration' },
];
export function EmailsWorkspace(props: Parameters<typeof EmailsWorkspaceContent>[0]) {
  return (
    <UnsavedChangesBoundary>
      <EmailsWorkspaceContent {...props} />
    </UnsavedChangesBoundary>
  );
}
function EmailsWorkspaceContent({
  tenantId,
  propertyId,
  canWrite = false,
  initialTab = 'overview',
}: {
  tenantId: string;
  propertyId: string;
  canWrite?: boolean;
  initialTab?: string;
}) {
  const { request: navigate } = useUnsavedNavigation();
  const [tab, setTab] = useState(initialTab);
  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  const [deliveryPage, setDeliveryPage] = useState(1),
    [deliverySize, setDeliverySize] = useState(25),
    [deliveryFilter, setDeliveryFilter] = useState('all'),
    [deliveryTopic, setDeliveryTopic] = useState(''),
    [deliveryHours, setDeliveryHours] = useState<number | undefined>();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const templates = useQuery({
    queryKey: ['emails', base, 'templates'],
    queryFn: () => emailRequest<EmailTemplate[]>(`${base}/email-templates`),
  });
  const deliveries = useQuery({
    queryKey: [
      'emails',
      base,
      'delivery',
      deliveryPage,
      deliverySize,
      deliveryFilter,
      deliveryTopic,
      deliveryHours,
    ],
    queryFn: () =>
      emailRequest<EmailPage>(
        `${base}/email-activity?page=${deliveryPage}&pageSize=${deliverySize}&filter=${deliveryFilter}&topic=${encodeURIComponent(deliveryTopic)}${deliveryHours ? `&hours=${deliveryHours}` : ''}`,
      ),
  });
  const overview = useQuery({
    queryKey: ['emails', base, 'overview'],
    queryFn: () => emailRequest<EmailOverview>(`${base}/email-activity/overview`),
  });
  const error = templates.error ?? deliveries.error ?? overview.error;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Emails"
        description="Transactional messages, approved wording and delivery evidence. Booking and payment triggers stay protected."
      />
      {!canWrite ? (
        <Alert>
          <AlertDescription>
            Read only. Verify your email to change email settings.
          </AlertDescription>
        </Alert>
      ) : null}
      <TabBar
        label="Emails"
        tabs={tabs}
        current={tab}
        onSelect={(id) => {
          navigate(() => {
            setTab(id);
            setTemplate(null);
          });
        }}
      />
      {error ? (
        <ErrorPanel
          title={
            error instanceof EmailRequestError && error.status === 403
              ? 'Email access unavailable'
              : 'Emails unavailable'
          }
          description={error.message}
          reference={
            error instanceof EmailRequestError ? (error.reference ?? undefined) : undefined
          }
          onRetry={() => {
            void templates.refetch();
            void deliveries.refetch();
            void overview.refetch();
          }}
        />
      ) : !templates.data || !deliveries.data || !overview.data ? (
        <ListSkeleton />
      ) : (
        <>
          {tab === 'overview' ? (
            <>
              <EmailHealthOverview
                data={overview.data}
                onDelivery={(filter, topic, hours) => {
                  setDeliveryFilter(filter);
                  setDeliveryTopic(topic ?? '');
                  setDeliveryHours(hours);
                  setDeliveryPage(1);
                  setTab('delivery');
                }}
                onConfiguration={() => setTab('configuration')}
                onMessage={setMessageId}
              />
              <PageHeader
                title="Recent deliveries"
                description="Most recent loaded messages. Use Delivery to page through the complete log."
              />
              <DeliveryDirectory
                items={deliveries.data.items}
                onRow={(row) => setMessageId(row.id)}
              />
            </>
          ) : null}
          {tab === 'templates' ? (
            template ? (
              <TemplateEditor
                key={`${base}/${template.key}`}
                base={base}
                template={template}
                canWrite={canWrite}
                onClose={() => setTemplate(null)}
              />
            ) : (
              <RecordDirectory
                storageKey="must.email-templates.table"
                rows={templates.data.map((row) => ({ ...row, id: row.key }))}
                columns={[
                  { id: 'label', label: 'Template', value: (row) => row.label },
                  { id: 'key', label: 'Trigger key', value: (row) => row.key },
                  { id: 'audience', label: 'Audience', value: (row) => row.audience ?? 'Guest' },
                  {
                    id: 'draft',
                    label: 'State',
                    value: (row) =>
                      row.triggerAvailable === false
                        ? 'Wording only'
                        : row.enabled === false
                          ? 'Disabled'
                          : row.hasDraft
                            ? 'Draft + live'
                            : 'Live',
                  },
                  {
                    id: 'locales',
                    label: 'Published locales',
                    value: (row) => (row.locales ?? ['en']).join(' / ').toUpperCase(),
                  },
                  {
                    id: 'wording',
                    label: 'Live wording',
                    value: (row) => (row.custom ? 'Hotel override' : 'Built-in English'),
                  },
                ]}
                onRow={setTemplate}
              />
            )
          ) : null}
          {tab === 'delivery' ? (
            <>
              <TabBar
                label="Delivery filter"
                tabs={[
                  { id: 'all', label: 'All deliveries' },
                  { id: 'problems', label: 'Needs attention' },
                  { id: 'queued', label: 'Queued' },
                  { id: 'bounced', label: 'Bounced' },
                  { id: 'complained', label: 'Complained' },
                ]}
                current={deliveryFilter}
                onSelect={(value) => {
                  setDeliveryFilter(value);
                  setDeliveryPage(1);
                }}
              />
              <DeliveryDirectory
                items={deliveries.data.items}
                onRow={(row) => setMessageId(row.id)}
                pagination={{
                  page: deliveryPage,
                  pageSize: deliverySize,
                  total: deliveries.data.total,
                  onPage: setDeliveryPage,
                  onPageSize: (size) => {
                    setDeliverySize(size);
                    setDeliveryPage(1);
                  },
                }}
              />
            </>
          ) : null}
          {tab === 'configuration' ? (
            <EmailConfiguration tenantId={tenantId} base={base} canWrite={canWrite} />
          ) : null}
        </>
      )}
      {messageId ? (
        <EmailDeliveryDetail
          key={messageId}
          base={base}
          id={messageId}
          onClose={() => setMessageId(null)}
          canWrite={canWrite}
        />
      ) : null}
    </div>
  );
}
function DeliveryDirectory({
  items,
  onRow,
  pagination,
}: {
  items: EmailMessage[];
  onRow: (message: EmailMessage) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPage: (page: number) => void;
    onPageSize: (size: number) => void;
  };
}) {
  return (
    <RecordDirectory
      rows={items}
      pagination={pagination}
      initialSort={{ key: 'created', direction: 'desc' }}
      storageKey="must.email-delivery.table"
      emptyTitle="No email deliveries yet"
      columns={[
        { id: 'label', label: 'Event', value: (row) => row.label },
        { id: 'recipient', label: 'Recipient', value: (row) => row.recipient },
        {
          id: 'status',
          label: 'Status',
          value: (row) => row.status,
          render: (row) => (
            <Badge
              className="capitalize"
              variant={
                ['FAILED', 'BOUNCED', 'COMPLAINED'].includes(row.status)
                  ? 'danger'
                  : row.status === 'SUPPRESSED'
                    ? 'warning'
                    : row.status === 'QUEUED'
                      ? 'outline'
                      : 'success'
              }
            >
              {row.status.toLowerCase()}
            </Badge>
          ),
        },
        {
          id: 'subject',
          label: 'Subject',
          value: (row) => row.subject,
          render: (row) => (
            <span className="block max-w-[22rem] truncate" title={row.subject}>
              {row.subject}
            </span>
          ),
        },
        { id: 'attempts', label: 'Attempts', value: (row) => row.attemptCount },
        {
          id: 'created',
          label: 'Created',
          value: (row) => row.createdAt,
          render: (row) => new Date(row.createdAt).toLocaleString(),
        },
        { id: 'booking', label: 'Booking', value: (row) => row.bookingReference ?? 'Not linked' },
      ]}
      onRow={onRow}
    />
  );
}
function TemplateEditor({
  base,
  template,
  canWrite,
  onClose,
}: {
  base: string;
  template: EmailTemplate;
  canWrite: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { request: navigate } = useUnsavedNavigation();
  const [language, setLanguage] = useState('en');
  const query = useQuery({
    queryKey: ['emails', base, template.key, language],
    queryFn: () =>
      emailRequest<EmailVersions>(
        `${base}/email-template-versions/${template.key}?language=${language}`,
      ),
  });
  return (
    <div className="flex flex-col gap-4">
      <Button variant="ghost" onClick={() => navigate(onClose)}>
        Back to templates
      </Button>
      <FormField label="Language">
        <Combobox
          label="Language"
          value={language}
          onChange={(value) => navigate(() => setLanguage(value))}
          options={[
            { value: 'en', label: 'English' },
            { value: 'sq', label: 'Albanian' },
          ]}
        />
      </FormField>
      {query.error ? (
        <ErrorPanel description={query.error.message} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <TemplateDraft
          key={`${language}/${query.data.version}`}
          base={base}
          template={template}
          data={query.data}
          canWrite={canWrite}
          onSaved={() => void client.invalidateQueries({ queryKey: ['emails', base] })}
        />
      ) : (
        <ListSkeleton />
      )}
    </div>
  );
}
function TemplateDraft({
  base,
  template,
  data,
  canWrite,
  onSaved,
}: {
  base: string;
  template: EmailTemplate;
  data: EmailVersions;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState(data.draft?.subject ?? data.live?.subject ?? '');
  const [body, setBody] = useState(data.draft?.body ?? data.live?.body ?? '');
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(
    null,
  );
  const [previewText, setPreviewText] = useState(
    data.draft?.previewText ?? data.live?.previewText ?? '',
  );
  const [previewError, setPreviewError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);
  const [comparison, setComparison] = useState<(typeof data.history)[number] | null>(null);
  const initial = data.draft ?? data.live;
  const dirty =
    subject !== (initial?.subject ?? '') ||
    body !== (initial?.body ?? '') ||
    previewText !== (initial?.previewText ?? '');
  const clean = useUnsavedChanges(dirty),
    { request: navigate, setDirty: guardDirty } = useUnsavedNavigation();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPreviewError('');
      void emailRequest<{ subject: string; html: string; text: string }>(
        `${base}/email-templates/${template.key}/preview`,
        {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({ subject, body, previewText, language: data.language }),
        },
      )
        .then((value) => {
          if (!controller.signal.aborted) setPreview(value);
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setPreview(null);
            setPreviewError(e instanceof Error ? e.message : 'Preview unavailable.');
          }
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, template.key, subject, body, previewText, data.language, previewRetry]);
  const [testNotice, setTestNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [test, setTest] = useState(false),
    [publish, setPublish] = useState(false);
  const writer = useRef(createEmailWriter()).current;
  async function act(operation: string, revision?: number) {
    setBusy(true);
    setError('');
    try {
      await writer(
        `${base}/email-template-versions/${template.key}/${operation}`,
        {
          language: data.language,
          version: data.version,
          ...(operation === 'draft' ? { subject, body, previewText } : {}),
          ...(revision === undefined ? {} : { revision }),
        },
        operation === 'draft' ? 'PUT' : 'POST',
      );
      clean();
      onSaved();
    } catch (e) {
      guardDirty(dirty);
      setError(e instanceof Error ? e.message : 'The template could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={template.label}
        description={`${template.audience ?? 'Guest'} template / ${data.language.toUpperCase()} / version ${data.version}${dirty ? ' / Unsaved changes' : ''}`}
      />
      <Alert>
        <AlertDescription>
          Edits remain draft until published. Required booking details, trigger eligibility and
          payment rules cannot be edited here. Albanian wording must be supplied by the hotel; no
          automatic translation.
        </AlertDescription>
      </Alert>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <FormField label="Subject" htmlFor="template-subject" required>
              <Input
                id="template-subject"
                value={subject}
                maxLength={300}
                disabled={!canWrite || busy}
                onChange={(e) => setSubject(e.target.value)}
              />
            </FormField>
            <FormField
              label="Preview text"
              htmlFor="template-preview-text"
              hint="A short inbox preview line; safe variables are supported."
            >
              <Input
                id="template-preview-text"
                value={previewText}
                maxLength={200}
                disabled={!canWrite || busy}
                onChange={(e) => setPreviewText(e.target.value)}
              />
            </FormField>
            {template.placeholders.includes('stay_range') ? (
              <FormField label="Stay date display">
                <Combobox
                  label="Stay date display"
                  value={body.includes('{stay_nights}') ? 'nights' : 'range'}
                  options={[
                    { value: 'range', label: 'Date range' },
                    { value: 'nights', label: 'Per-night list with recorded rates' },
                  ]}
                  disabled={!canWrite || busy}
                  onChange={(mode) => {
                    const token = mode === 'nights' ? '{stay_nights}' : '{stay_range}';
                    setBody((current) =>
                      /\{stay_(range|nights)\}/.test(current)
                        ? current.replace(/\{stay_(range|nights)\}/g, token)
                        : current + '\n\n' + token,
                    );
                  }}
                />
              </FormField>
            ) : null}
            <FormField
              label="Message"
              htmlFor="template-body"
              required
              hint="Plain text only. Publish requires {guest_name}, plus {payment_note} for confirmation or {refund_amount} for refunds. Hotel identity and booking reference remain in protected generated blocks."
            >
              <Textarea
                id="template-body"
                value={body}
                maxLength={5000}
                rows={8}
                disabled={!canWrite || busy}
                onChange={(e) => setBody(e.target.value)}
              />
            </FormField>
            <FormField label="Insert safe variable">
              <Combobox
                label="Insert safe variable"
                value=""
                options={template.placeholders.map((name) => ({ value: name, label: `{${name}}` }))}
                placeholder="Search variables"
                disabled={!canWrite || busy}
                onChange={(name) => setBody((current) => `${current} {${name}}`)}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!canWrite || busy || data.language !== 'en'}
                onClick={() => {
                  setSubject(template.defaultSubject ?? template.subject);
                  setBody(template.defaultBody ?? template.body);
                  setPreviewText('');
                }}
              >
                Use built-in English wording as draft
              </Button>
              <Button
                disabled={!canWrite || busy || !subject.trim() || !body.trim()}
                onClick={() => void act('draft')}
              >
                Save draft
              </Button>
              <Button
                variant="outline"
                disabled={busy || !subject || !body}
                onClick={async () => {
                  setError('');
                  try {
                    setPreview(
                      await emailRequest(`${base}/email-templates/${template.key}/preview`, {
                        method: 'POST',
                        body: JSON.stringify({
                          subject,
                          body,
                          previewText,
                          language: data.language,
                        }),
                      }),
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Preview failed.');
                  }
                }}
              >
                Preview
              </Button>
              <Button
                variant="outline"
                disabled={!canWrite || busy || !data.draft || template.triggerAvailable === false}
                onClick={() => setPublish(true)}
              >
                Publish saved draft
              </Button>
              {
                <Button
                  variant="outline"
                  disabled={!canWrite || busy || !subject || !body}
                  onClick={() => setTest(true)}
                >
                  Send controlled test
                </Button>
              }
            </div>
          </CardContent>
        </Card>
        <div className="min-w-0 xl:sticky xl:top-4">
          {previewError ? (
            <ErrorPanel
              title="Preview unavailable"
              description={previewError}
              onRetry={() => setPreviewRetry((current) => current + 1)}
            />
          ) : preview ? (
            <MessagePreview {...preview} />
          ) : (
            <ListSkeleton rows={3} />
          )}
        </div>
      </div>
      {template.triggerAvailable === false ? (
        <p className="m-0 text-sm text-muted-foreground">{template.unavailableReason}</p>
      ) : null}
      {comparison ? (
        <TextComparison
          before={`${comparison.subject}\n${comparison.previewText ?? ''}\n\n${comparison.body}`}
          after={`${subject}\n${previewText}\n\n${body}`}
          beforeLabel={`Revision ${comparison.revision}`}
        />
      ) : null}
      {testNotice ? (
        <Alert>
          <AlertDescription>{testNotice}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
        </CardHeader>
        <CardContent>
          {data.history.length ? (
            <RecordDirectory
              rows={data.history.map((row) => ({ ...row, id: String(row.revision) }))}
              columns={[
                { id: 'version', label: 'Revision', value: (row) => row.revision },
                {
                  id: 'created',
                  label: 'Saved',
                  value: (row) => new Date(row.createdAt).toLocaleString(),
                },
              ]}
              storageKey="must.email-versions.table"
              onRow={(row) => setComparison(row)}
              actions={
                canWrite
                  ? (row) => [
                      {
                        label: 'Restore as draft',
                        onSelect: () => navigate(() => void act('restore', row.revision)),
                      },
                    ]
                  : undefined
              }
            />
          ) : (
            <EmptyPanel
              title="No saved revisions"
              description="Saving a draft starts the version history."
            />
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={publish}
        onOpenChange={setPublish}
        title="Publish email wording"
        description="The saved draft becomes live for future email events. Already queued messages keep their approved wording."
        confirmLabel="Publish"
        onConfirm={async () => {
          await writer(`${base}/email-template-versions/${template.key}/publish`, {
            language: data.language,
            version: data.version,
          });
          onSaved();
        }}
      />
      <ConfirmDialog
        open={test}
        onOpenChange={setTest}
        title="Send controlled test email"
        description="Only your verified account email is allowed. Example data is used; guests cannot be selected. Maximum five tests per hotel per hour."
        reasonLabel="Reason for test"
        reasonRequired
        reasonPlaceholder="Recorded with this email action"
        confirmLabel="Send test to my address"
        onConfirm={async (reason) => {
          const result = await writer<{ sentTo: string }>(
            `${base}/email-templates/${template.key}/test`,
            {
              subject,
              body,
              previewText,
              reason,
              version: data.version,
              language: data.language,
            },
          );
          setTestNotice(
            `Test requested for ${result.sentTo}. Delivery status is recorded in Delivery.`,
          );
        }}
      />
    </div>
  );
}
function EmailDeliveryDetail({
  base,
  id,
  onClose,
  canWrite,
}: {
  base: string;
  id: string;
  onClose: () => void;
  canWrite: boolean;
}) {
  const query = useQuery({
    queryKey: ['emails', base, 'detail', id],
    queryFn: () => emailRequest<EmailMessage>(`${base}/email-activity/${id}`),
  });
  const [retry, setRetry] = useState(false);
  const client = useQueryClient();
  const writer = useRef(createEmailWriter()).current;
  return (
    <QuickPeek
      open
      onClose={onClose}
      title="Email delivery"
      description="Recorded message evidence and recovery."
    >
      {query.error ? (
        <ErrorPanel description={query.error.message} />
      ) : !query.data ? (
        <ListSkeleton />
      ) : (
        <>
          <Badge>{query.data.status}</Badge>
          <DetailList
            items={[
              { label: 'Event', value: query.data.label },
              { label: 'Recipient', value: query.data.recipient },
              { label: 'Subject', value: query.data.subject },
              { label: 'Booking reference', value: query.data.bookingReference ?? 'Not linked' },
              { label: 'Attempts', value: query.data.attemptCount },
              { label: 'Created', value: new Date(query.data.createdAt).toLocaleString() },
              { label: 'Sent', value: query.data.sentAt ?? 'Not recorded' },
              { label: 'Delivered', value: query.data.deliveredAt ?? 'Not recorded' },
              { label: 'Failure', value: query.data.lastError },
            ]}
          />
          {query.data.canResend ? (
            <Button disabled={!canWrite} onClick={() => setRetry(true)}>
              Retry approved message
            </Button>
          ) : (
            <Alert>
              <AlertDescription>
                {query.data.retryUnavailableReason ??
                  'Retry unavailable: only a failed message with its original non-sensitive command still retained can be retried.'}
              </AlertDescription>
            </Alert>
          )}
          <ConfirmDialog
            open={retry}
            onOpenChange={setRetry}
            title="Retry this email"
            description="Reuses the original recipient and approved wording. Template edits are not applied."
            confirmLabel="Retry"
            reasonLabel="Reason for retry"
            reasonRequired
            reasonPlaceholder="Recorded with this email action"
            onConfirm={async (reason) => {
              await writer(`${base}/email-activity/${id}/retry`, {
                version: query.data!.version,
                reason,
              });
              await client.invalidateQueries({ queryKey: ['emails', base] });
            }}
          />
        </>
      )}
    </QuickPeek>
  );
}
