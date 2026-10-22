'use client';
import {
  UnsavedChangesBoundary,
  useUnsavedNavigation,
  useUnsavedChanges,
} from '../../components/ui/unsaved-changes';
import { DashboardQueryProvider } from './query-provider';
import { downloadCsv } from '../../lib/download-csv';
import { Clock } from 'lucide-react';
import { ActivityFeed } from '../../components/ui/activity-feed';
import { TextComparison } from '../../components/ui/text-comparison';
import { EmailHealthOverview } from './email-health-overview';
import { EmailConfiguration } from './email-configuration';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Combobox } from '../../components/ui/combobox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input, Textarea } from '../../components/ui/input';
import { MessagePreview } from '../../components/ui/message-preview';
import { PageHeader } from '../../components/ui/page-header';
import { QuickPeek } from '../../components/ui/quick-peek';
import { FilterGrid } from '../../components/ui/filter-grid';
import { RecordDirectory, type RecordServerControls } from '../../components/ui/record-directory';
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
    <DashboardQueryProvider
      key={`${props.viewerId ?? 'session'}/${props.tenantId}/${props.propertyId}`}
    >
      <UnsavedChangesBoundary key={`${props.tenantId}/${props.propertyId}`}>
        <EmailsWorkspaceContent {...props} />
      </UnsavedChangesBoundary>
    </DashboardQueryProvider>
  );
}
function EmailsWorkspaceContent({
  tenantId,
  propertyId,
  canWrite = false,
  initialTab = 'overview',
}: {
  viewerId?: string;
  tenantId: string;
  propertyId: string;
  canWrite?: boolean;
  initialTab?: string;
}) {
  const { request: navigate } = useUnsavedNavigation();
  const [tab, setTab] = useState(initialTab);
  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [messageId, setMessageId] = useState<string | null>(null);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('emailMessageId');
    if (
      value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ) {
      setTab('delivery');
      setMessageId(value);
    }
  }, [tenantId, propertyId]);
  const [deliveryPage, setDeliveryPage] = useState(1),
    [deliverySize, setDeliverySize] = useState(25),
    [deliveryFilter, setDeliveryFilter] = useState('all'),
    [deliveryTopic, setDeliveryTopic] = useState(''),
    [deliveryHours, setDeliveryHours] = useState<number | undefined>(),
    [deliveryStatus, setDeliveryStatus] = useState(''),
    [deliveryRecipient, setDeliveryRecipient] = useState(''),
    [deliveryFrom, setDeliveryFrom] = useState(''),
    [deliveryTo, setDeliveryTo] = useState(''),
    [deliverySearch, setDeliverySearch] = useState(''),
    [deliverySort, setDeliverySort] = useState<RecordServerControls['sort']>({
      key: 'created',
      direction: 'desc',
    });
  const deliveryParams = new URLSearchParams({
    page: String(deliveryPage),
    pageSize: String(deliverySize),
    filter: deliveryFilter,
    topic: deliveryTopic,
    status: deliveryStatus,
    recipient: deliveryRecipient,
    from: deliveryFrom,
    to: deliveryTo,
    search: deliverySearch,
    sort: deliverySort.key,
    direction: deliverySort.direction,
    ...(deliveryHours ? { hours: String(deliveryHours) } : {}),
  });
  const updateDelivery = (action: () => void) => {
    action();
    setDeliveryPage(1);
  };
  const server: RecordServerControls = {
    search: deliverySearch,
    onSearch: (value) => updateDelivery(() => setDeliverySearch(value)),
    sort: deliverySort,
    onSort: (value) => updateDelivery(() => setDeliverySort(value)),
  };
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const templates = useQuery({
    queryKey: ['emails', base, 'templates'],
    queryFn: () => emailRequest<EmailTemplate[]>(`${base}/email-templates`),
  });
  const deliveries = useQuery({
    queryKey: ['emails', base, 'delivery', deliveryParams.toString()],
    placeholderData: keepPreviousData,
    queryFn: () => emailRequest<EmailPage>(`${base}/email-activity?${deliveryParams}`),
  });
  const overview = useQuery({
    queryKey: ['emails', base, 'overview'],
    queryFn: () => emailRequest<EmailOverview>(`${base}/email-activity/overview`),
  });
  const error = templates.error ?? overview.error ?? (tab === 'delivery' ? null : deliveries.error);
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
      ) : !templates.data || (!deliveries.data && !deliveries.error) || !overview.data ? (
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
                items={deliveries.data?.items ?? []}
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
              <FilterGrid>
                <FormField label="Status">
                  <Combobox
                    label="Delivery status"
                    value={deliveryStatus}
                    options={[
                      { value: '', label: 'All statuses' },
                      ...[
                        'QUEUED',
                        'SENT',
                        'FAILED',
                        'DELIVERED',
                        'BOUNCED',
                        'COMPLAINED',
                        'SUPPRESSED',
                      ].map((value) => ({
                        value,
                        label: value.charAt(0) + value.slice(1).toLowerCase(),
                      })),
                    ]}
                    onChange={(value) => updateDelivery(() => setDeliveryStatus(value))}
                  />
                </FormField>
                <FormField label="Topic">
                  <Combobox
                    label="Delivery topic"
                    value={deliveryTopic}
                    options={[
                      { value: '', label: 'All topics' },
                      ...(deliveries.data?.topics ?? []),
                      ...(deliveryTopic &&
                      !deliveries.data?.topics?.some((t) => t.value === deliveryTopic)
                        ? [{ value: deliveryTopic, label: deliveryTopic }]
                        : []),
                    ]}
                    onChange={(value) => updateDelivery(() => setDeliveryTopic(value))}
                  />
                </FormField>
                <FormField label="Recipient">
                  <Input
                    aria-label="Delivery recipient"
                    value={deliveryRecipient}
                    placeholder="Email address"
                    onChange={(e) => updateDelivery(() => setDeliveryRecipient(e.target.value))}
                  />
                </FormField>
                <FormField label="From date">
                  <Input
                    aria-label="Delivery from date"
                    type="date"
                    value={deliveryFrom}
                    onChange={(e) =>
                      updateDelivery(() => {
                        setDeliveryFrom(e.target.value);
                        setDeliveryHours(undefined);
                      })
                    }
                  />
                </FormField>
                <FormField label="Through date">
                  <Input
                    aria-label="Delivery through date"
                    type="date"
                    value={deliveryTo}
                    onChange={(e) =>
                      updateDelivery(() => {
                        setDeliveryTo(e.target.value);
                        setDeliveryHours(undefined);
                      })
                    }
                  />
                </FormField>
                <FormField label="Time window">
                  <Combobox
                    label="Delivery time window"
                    value={String(deliveryHours ?? '')}
                    options={[
                      { value: '', label: 'All recorded time' },
                      { value: '24', label: 'Last 24 hours' },
                      { value: '168', label: 'Last 7 days' },
                    ]}
                    onChange={(value) =>
                      updateDelivery(() => {
                        setDeliveryHours(value ? Number(value) : undefined);
                        setDeliveryFrom('');
                        setDeliveryTo('');
                      })
                    }
                  />
                </FormField>
              </FilterGrid>
              <DetailList
                items={[
                  { label: 'Hotel', value: 'Selected hotel in the header' },
                  {
                    label: 'Date time zone',
                    value: deliveries.data?.timezone ?? 'Property-local dates',
                  },
                ]}
              />
              <Button
                variant="outline"
                className="self-start"
                onClick={() =>
                  updateDelivery(() => {
                    setDeliveryFilter('all');
                    setDeliveryTopic('');
                    setDeliveryStatus('');
                    setDeliveryRecipient('');
                    setDeliverySearch('');
                    setDeliveryHours(undefined);
                    setDeliveryFrom('');
                    setDeliveryTo('');
                  })
                }
              >
                Clear delivery filters
              </Button>
              {deliveries.error ? (
                <ErrorPanel
                  title={
                    deliveries.error instanceof EmailRequestError && deliveries.error.status === 403
                      ? 'Email access unavailable'
                      : 'Delivery unavailable'
                  }
                  description={deliveries.error.message}
                  reference={
                    deliveries.error instanceof EmailRequestError
                      ? (deliveries.error.reference ?? undefined)
                      : undefined
                  }
                  onRetry={() => void deliveries.refetch()}
                />
              ) : (
                <DeliveryDirectory
                  server={server}
                  exportScope={
                    deliveries.data?.observedAt && deliveries.data.exportVersion !== undefined
                      ? {
                          filters: Object.fromEntries(deliveryParams),
                          through: deliveries.data.observedAt,
                          version: deliveries.data.exportVersion,
                        }
                      : undefined
                  }
                  base={base}
                  canWrite={canWrite}
                  items={deliveries.data?.items ?? []}
                  onRow={(row) => setMessageId(row.id)}
                  pagination={{
                    page: deliveryPage,
                    pageSize: deliverySize,
                    total: deliveries.data?.total ?? 0,
                    onPage: setDeliveryPage,
                    onPageSize: (size) => {
                      setDeliverySize(size);
                      setDeliveryPage(1);
                    },
                  }}
                />
              )}
            </>
          ) : null}
          {tab === 'configuration' ? (
            <EmailConfiguration tenantId={tenantId} base={base} canWrite={canWrite} />
          ) : null}
        </>
      )}
      {messageId && !error && !deliveries.error ? (
        <EmailDeliveryDetail
          key={messageId}
          base={base}
          id={messageId}
          onClose={() => setMessageId(null)}
          canWrite={canWrite}
          onMessage={setMessageId}
          onConfiguration={() => {
            setMessageId(null);
            setTab('configuration');
          }}
        />
      ) : null}
    </div>
  );
}
function DeliveryDirectory({
  items,
  onRow,
  pagination,
  server,
  base,
  canWrite = false,
  exportScope,
}: {
  exportScope?: { filters: Record<string, string>; through: string; version: number };
  base?: string;
  canWrite?: boolean;
  server?: RecordServerControls;
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
  const [bulk, setBulk] = useState<EmailMessage[]>([]);
  const [exportIntent, setExportIntent] = useState<{
    scope: NonNullable<typeof exportScope>;
    ids: string[] | null;
  }>();
  const startExport = (ids: string[] | null) => {
    if (exportScope) setExportIntent({ scope: exportScope, ids });
  };
  const [exportNotice, setExportNotice] = useState('');
  const writer = useRef(createEmailWriter()).current;
  const client = useQueryClient();
  return (
    <>
      {exportNotice ? (
        <Alert>
          <AlertDescription>{exportNotice}</AlertDescription>
        </Alert>
      ) : null}
      <RecordDirectory
        rows={items}
        exportable={false}
        visibleActions={
          base && exportScope
            ? () => [
                {
                  label: 'Export filtered CSV',
                  disabled: !canWrite,
                  onSelect: () => startExport(null),
                },
              ]
            : undefined
        }
        selectionActions={
          base
            ? (rows) => [
                {
                  label: 'Retry selected failed',
                  disabled:
                    !canWrite ||
                    !rows.length ||
                    rows.length > 50 ||
                    rows.some((row) => row.status !== 'FAILED' || !row.canResend),
                  onSelect: () => setBulk([...rows]),
                },
                ...(exportScope
                  ? [
                      {
                        label: 'Export selected CSV',
                        disabled: !canWrite || !rows.length || rows.length > 100,
                        onSelect: () => startExport(rows.map((row) => row.id)),
                      },
                    ]
                  : []),
              ]
            : undefined
        }
        server={server}
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
      <ConfirmDialog
        open={bulk.length > 0}
        onOpenChange={(open) => {
          if (!open) setBulk([]);
        }}
        title={`Retry ${bulk.length} failed emails?`}
        description="Uses the original recipients and approved wording. Every selected message must still be eligible; otherwise none are changed. Maximum 50."
        reasonRequired
        reasonLabel="Reason for bulk retry"
        reasonPlaceholder="Recorded with this email action"
        confirmLabel="Retry selected"
        onConfirm={async (reason) => {
          await writer(`${base}/email-activity/bulk-retry`, {
            messages: bulk.map((row) => ({ id: row.id, version: row.version })),
            reason,
          });
          setBulk([]);
          await client.invalidateQueries({ queryKey: ['emails', base] });
        }}
      />
      <ConfirmDialog
        open={exportIntent !== undefined}
        onOpenChange={(open) => {
          if (!open) setExportIntent(undefined);
        }}
        title="Export email deliveries"
        description="Exports current delivery outcomes for messages created through the recorded observation time. Recipient addresses are included; keep the downloaded file private. Maximum 5,000 rows or 2 MB."
        confirmLabel="Export CSV"
        reasonRequired
        reasonLabel="Reason for export"
        reasonPlaceholder="Recorded with this email action"
        onConfirm={async (reason) => {
          if (!exportIntent) return;
          const file = await writer<{
            csv: string;
            filename: string;
            count: number;
            version: number;
          }>(`${base}/email-activity/export`, {
            ...exportIntent.scope,
            reason,
            ...(exportIntent.ids ? { ids: exportIntent.ids } : {}),
          });
          downloadCsv(file);
          setExportNotice(`${file.count} email deliveries exported. The download has started.`);
          setExportIntent(undefined);
          await client.invalidateQueries({ queryKey: ['emails', base] });
        }}
      />
    </>
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
  const [reloading, setReloading] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const query = useQuery({
    queryKey: ['emails', base, template.key, language],
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      emailRequest<EmailVersions>(
        `${base}/email-template-versions/${template.key}?language=${language}`,
      ),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" disabled={formBusy || reloading} onClick={() => navigate(onClose)}>
          Back to templates
        </Button>
        <Button
          variant="outline"
          className="self-start"
          disabled={formBusy || reloading || query.isFetching}
          onClick={() =>
            navigate(() => {
              setReloading(true);
              void query.refetch().finally(() => setReloading(false));
            })
          }
        >
          Reload wording
        </Button>
      </div>
      <FormField label="Language" className="w-full sm:max-w-56">
        <Combobox
          label="Language"
          disabled={formBusy || reloading}
          value={language}
          onChange={(value) => navigate(() => setLanguage(value))}
          options={[
            { value: 'en', label: 'English' },
            { value: 'sq', label: 'Albanian' },
          ]}
        />
      </FormField>
      {reloading ? (
        <ListSkeleton />
      ) : query.error ? (
        <ErrorPanel description={query.error.message} onRetry={() => void query.refetch()} />
      ) : query.data && query.isFetchedAfterMount ? (
        <TemplateDraft
          key={`${language}/${query.data.version}`}
          base={base}
          template={template}
          data={query.data}
          canWrite={canWrite}
          onBusyChange={setFormBusy}
          onSaved={() => client.invalidateQueries({ queryKey: ['emails', base] })}
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
  onBusyChange,
}: {
  base: string;
  template: EmailTemplate;
  data: EmailVersions;
  canWrite: boolean;
  onSaved: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void;
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
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
      if (!mounted.current) return;
      clean();
      await onSaved();
    } catch (e) {
      if (!mounted.current) return;
      guardDirty(dirty);
      setError(e instanceof Error ? e.message : 'The template could not be saved.');
    } finally {
      if (mounted.current) setBusy(false);
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
  onMessage,
  onConfiguration,
}: {
  base: string;
  id: string;
  onClose: () => void;
  canWrite: boolean;
  onMessage: (id: string) => void;
  onConfiguration: () => void;
}) {
  const query = useQuery({
    queryKey: ['emails', base, 'detail', id],
    queryFn: () => emailRequest<EmailMessage>(`${base}/email-activity/${id}`),
  });
  const [retry, setRetry] = useState(false);
  const [showRendered, setShowRendered] = useState(false);
  const [copy, setCopy] = useState(false);
  const [copyVersion, setCopyVersion] = useState<number>();
  const [retryVersion, setRetryVersion] = useState<number>();
  const [newCopyId, setNewCopyId] = useState<string | null>(null);
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
        <ErrorPanel
          title={
            query.error instanceof EmailRequestError && query.error.status === 403
              ? 'Email access unavailable'
              : 'Email delivery unavailable'
          }
          description={query.error.message}
          reference={
            query.error instanceof EmailRequestError
              ? (query.error.reference ?? undefined)
              : undefined
          }
          onRetry={() => void query.refetch()}
        />
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
          {query.data.recipientEnvelope ? (
            <Card>
              <CardHeader>
                <CardTitle>Staff recipients</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <DetailList
                  stackOnMobile
                  items={(['to', 'cc', 'bcc'] as const)
                    .filter((channel) => query.data!.recipientEnvelope![channel].length > 0)
                    .map((channel) => ({
                      label: channel === 'to' ? 'To' : channel.toUpperCase(),
                      value: query
                        .data!.recipientEnvelope![channel].map(
                          (email) =>
                            `${email} - ${query.data!.recipientOutcomes?.[email] ?? 'No delivery confirmation'}`,
                        )
                        .join(', '),
                    }))}
                />
                <p className="text-sm text-muted-foreground">
                  One separate staff email. BCC addresses are shown only in this authorized delivery
                  view and are hidden from the other email recipients. Delivered means every
                  recipient has a delivery confirmation; a problem may affect only one recipient.
                </p>
              </CardContent>
            </Card>
          ) : null}
          <DetailList
            items={[
              { label: 'Provider', value: query.data.provider ?? 'Not recorded' },
              { label: 'Provider receipt', value: query.data.providerMessageId ?? 'Not recorded' },
            ]}
          />
          {query.data.bookingHref ? (
            <Button variant="outline" asChild>
              <a href={query.data.bookingHref}>Open booking</a>
            </Button>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Observed delivery timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {!query.data.timelineHasCreation ? (
                <DetailList
                  items={[
                    {
                      label: 'Earlier history',
                      value: 'Earlier steps were not recorded and are not reconstructed.',
                    },
                  ]}
                />
              ) : null}
              {query.data.timelineTruncated ? (
                <DetailList
                  items={[{ label: 'History window', value: 'Latest 200 recorded events.' }]}
                />
              ) : null}
              <ActivityFeed
                entries={(query.data.timeline ?? []).map((event) => ({
                  key: event.id,
                  title:
                    event.kind === 'ATTEMPT'
                      ? 'Sending attempt'
                      : event.kind === 'RETRY_WAIT'
                        ? 'Waiting for retry'
                        : event.kind.charAt(0) + event.kind.slice(1).toLowerCase(),
                  at: event.observedAt,
                  detail: `Attempt ${event.attemptCount}${event.provider ? ` / ${event.provider}` : ''}`,
                  icon: Clock,
                  tone: ['FAILED', 'BOUNCED', 'COMPLAINED'].includes(event.kind)
                    ? ('danger' as const)
                    : ('default' as const),
                }))}
                empty="No detailed events were recorded for this message."
              />
            </CardContent>
          </Card>
          {query.data.canResend ? (
            <Button
              disabled={!canWrite}
              onClick={() => {
                setRetryVersion(query.data!.version);
                setRetry(true);
              }}
            >
              Retry approved message
            </Button>
          ) : query.data.status === 'FAILED' || query.data.retryUnavailableReason ? (
            <Alert>
              <AlertDescription>
                {query.data.retryUnavailableReason ??
                  'Retry unavailable: only a failed message with its original non-sensitive command still retained can be retried.'}
              </AlertDescription>
            </Alert>
          ) : null}
          {query.data.retryUnavailableReason ? (
            <Button variant="outline" onClick={onConfiguration}>
              {query.data.transportBlocked || query.data.eventType === 'sender.test'
                ? 'Review sender setup'
                : 'Review suppression'}
            </Button>
          ) : null}
          {query.data.canSendCopy === true ? (
            <Button
              variant="outline"
              disabled={!canWrite}
              onClick={() => {
                setCopyVersion(query.data!.version);
                setCopy(true);
              }}
            >
              Send another copy
            </Button>
          ) : null}
          {newCopyId ? (
            <Alert>
              <AlertDescription>
                Another copy was queued. Check the new delivery for its outcome.
              </AlertDescription>
              <Button variant="link" onClick={() => onMessage(newCopyId)}>
                View new delivery
              </Button>
            </Alert>
          ) : null}
          {query.data.resendOfMessageId ? (
            <Button variant="outline" onClick={() => onMessage(query.data!.resendOfMessageId!)}>
              View original delivery
            </Button>
          ) : null}
          <ConfirmDialog
            open={copy}
            onOpenChange={setCopy}
            title="Send another copy?"
            description={
              query.data.recipientEnvelope
                ? 'Sends the original approved staff wording to EVERY saved To, CC and BCC recipient as a new delivery, keeping the same visible/hidden headers. This deliberately duplicates an email they may already have received. Private guest links are not included.'
                : 'Sends the original approved wording to the same recipient as a new delivery. This can duplicate an email they already received. Booking and payment details are not recalculated.'
            }
            confirmLabel="Send copy"
            reasonRequired
            reasonLabel="Reason for another copy"
            reasonPlaceholder="Recorded with this email action"
            onConfirm={async (reason) => {
              if (copyVersion === undefined) throw new Error('Reload the source delivery first.');
              const result = await writer<{ messageId: string }>(
                `${base}/email-activity/${id}/resend-copy`,
                { version: copyVersion, reason },
              );
              setNewCopyId(result.messageId);
              await client.invalidateQueries({ queryKey: ['emails', base] });
            }}
          />
          {query.data.renderedPreview ? (
            <>
              <DetailList
                items={[
                  {
                    label: 'Preview captured',
                    value: new Date(query.data.renderedPreview.capturedAt).toLocaleString(),
                  },
                  {
                    label: 'Preview expires',
                    value: new Date(query.data.renderedPreview.expiresAt).toLocaleString(),
                  },
                ]}
              />
              <Button
                variant="outline"
                aria-expanded={showRendered}
                aria-controls={`retained-email-${id}`}
                onClick={() => setShowRendered(!showRendered)}
              >
                {showRendered ? 'Hide retained message' : 'View retained message'}
              </Button>
              {showRendered ? (
                <Dialog open={showRendered} onOpenChange={setShowRendered}>
                  <DialogContent
                    id={`retained-email-${id}`}
                    className="sm:!max-w-[760px] max-h-[90dvh] overflow-y-auto"
                  >
                    <DialogTitle>Retained email preview</DialogTitle>
                    <DialogDescription>
                      Review the saved message in desktop, mobile or plain text view.
                    </DialogDescription>
                    <DetailList
                      items={[
                        {
                          label: 'Safe preview',
                          value:
                            'Links, remote images and active content are removed. This is prepared content, not proof of delivery.',
                        },
                      ]}
                    />
                    <MessagePreview
                      subject={query.data.renderedPreview.subject}
                      html={query.data.renderedPreview.html}
                      text={query.data.renderedPreview.text}
                    />
                    <Button variant="outline" onClick={() => setShowRendered(false)}>
                      Close preview
                    </Button>
                  </DialogContent>
                </Dialog>
              ) : null}
            </>
          ) : (
            <DetailList
              items={[
                {
                  label: 'Retained message',
                  value:
                    'No retained preview. Copies expire after seven days; security links are excluded.',
                },
              ]}
            />
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
              if (retryVersion === undefined) throw new Error('Reload the source delivery first.');
              await writer(`${base}/email-activity/${id}/retry`, {
                version: retryVersion,
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
