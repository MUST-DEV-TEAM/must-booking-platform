'use client';

import { formatDateTime } from '../../lib/hotel-format';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Combobox } from '../../components/ui/combobox';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DataSnapshot } from '../../components/ui/data-snapshot';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { TabBar } from '../../components/ui/tab-bar';
import { QuickPeek } from '../../components/ui/quick-peek';
import { RecordDirectory } from '../../components/ui/record-directory';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { StatTile } from '../../components/ui/stat-tile';
import {
  auditRequest,
  auditResultLabel,
  recordedChanges,
  auditPage,
  AuditRequestError,
  createAuditExporter,
  downloadAuditCsv,
  type AuditEvent,
  type AuditExport,
} from '../../lib/activity-audit';
import { DateField } from '../../components/ui/date-field';
/** Property evidence directory; every CSV is created and audited on the server. */
export function ActivityAudit({
  tenantId,
  propertyId,
  userId = 'session',
  embedded = false,
}: {
  tenantId: string;
  propertyId: string;
  userId?: string;
  /** Inside Settings, where the page already has its title: no second header. */
  embedded?: boolean;
}) {
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [search, setSearch] = useState(''),
    [family, setFamily] = useState(''),
    [actor, setActor] = useState(''),
    [target, setTarget] = useState(''),
    [result, setResult] = useState(''),
    [view, setView] = useState('business'),
    [source, setSource] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [exportIds, setExportIds] = useState<string[] | null | undefined>(undefined),
    [lastExport, setLastExport] = useState<(AuditExport & { scopeKey: string }) | null>(null),
    [downloadError, setDownloadError] = useState('');
  const base = `/api/tenants/${tenantId}/properties/${propertyId}/activity-audit`,
    client = useQueryClient(),
    exporter = useRef(createAuditExporter());
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    search,
    family,
    actor,
    target,
    result,
    view,
    source,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const query = useQuery({
    queryKey: ['activity-audit', base, userId, params.toString()],
    queryFn: async () => auditPage(await auditRequest<unknown>(`${base}?${params}`)),
  });
  const data = query.error ? undefined : query.data;
  const detail = useQuery({
    queryKey: ['activity-audit-detail', base, userId, selected, data?.scopeKey],
    queryFn: () => auditRequest<AuditEvent>(`${base}/${selected}`),
    enabled: !!selected && !!data,
  });
  const event = selected && !query.error && !detail.error ? detail.data : null;
  const canExport = !!data?.canExport && !query.isFetching;
  const change = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
    setLastExport(null);
  };
  return (
    <div className="flex flex-col gap-6">
      {(() => {
        const exportButton = (
          <Button variant="outline" disabled={!canExport} onClick={() => setExportIds(null)}>
            Export CSV
          </Button>
        );
        return embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 max-w-2xl text-sm text-muted-foreground">
              Every change made in this hotel, by whom and when. Entries are kept as recorded and
              cannot be edited.
            </p>
            {exportButton}
          </div>
        ) : (
          <PageHeader
            title="Activity and audit log"
            description="Every change made in this hotel, by whom and when."
            actions={exportButton}
          />
        );
      })()}
      {data && !data.canExport ? (
        <Alert>
          <AlertDescription>
            You can look at the log, but exporting needs a verified email address.
          </AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <>
          <TabBar
            label="Audit activity views"
            current={view}
            onSelect={change(setView)}
            tabs={[
              { id: 'business', label: 'Business activity' },
              { id: 'system', label: 'System activity' },
              { id: 'all', label: 'Everything' },
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Today" value={data.counts.today} note="Events recorded today" />
            <StatTile
              label="Critical events"
              value={data.counts.critical}
              note="Refunds, integrations, exports and other sensitive actions"
            />
            <StatTile
              label="People active"
              value={data.counts.uniqueActors}
              note="Different people who made changes"
            />
          </div>
        </>
      ) : null}
      <div className="flex flex-col gap-3">
        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FormField label="Search">
            <Input
              aria-label="Search audit log"
              placeholder="What happened, or a reference"
              maxLength={100}
              value={search}
              onChange={(e) => change(setSearch)(e.target.value)}
            />
          </FormField>
          <FormField label="From">
            <DateField
              aria-label="Audit from date"
              value={from || data?.filters.from || ''}
              onChange={(date) => change(setFrom)(date)}
            />
          </FormField>
          <FormField label="To">
            <DateField
              aria-label="Audit to date"
              value={to || data?.filters.to || ''}
              onChange={(date) => change(setTo)(date)}
            />
          </FormField>
          <FormField label="Result">
            <Combobox
              label="Recorded result"
              value={result}
              onChange={change(setResult)}
              options={[
                { value: '', label: 'Any result' },
                ...['Succeeded', 'Failed', 'Denied', 'Pending', 'Unknown', 'Not recorded'].map(
                  (value) => ({
                    value,
                    label: auditResultLabel(value),
                  }),
                ),
              ]}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Quick range</span>
          {(
            [
              ['Today', 1],
              ['Last 7 days', 7],
              ['Last 30 days', 30],
            ] as const
          ).map(([label, days]) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              onClick={() => {
                const end = data?.filters.to || new Date().toISOString().slice(0, 10);
                const start = new Date(Date.parse(end) - (days - 1) * 86400000)
                  .toISOString()
                  .slice(0, 10);
                setFrom(start);
                setTo(end);
                setPage(1);
                setLastExport(null);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <details className="rounded-lg border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">More filters</summary>
          <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data?.canViewActors ? (
              <FormField label="Who">
                <Combobox
                  label="Who"
                  value={actor}
                  onChange={change(setActor)}
                  options={[
                    { value: '', label: 'Anyone' },
                    { value: 'system', label: 'System' },
                    ...data.actors.map((a) => ({ value: a.id, label: a.label })),
                  ]}
                />
              </FormField>
            ) : null}
            <FormField label="Area">
              <Combobox
                label="Action family"
                value={family}
                onChange={change(setFamily)}
                options={[
                  { value: '', label: 'All areas' },
                  ...(data?.families ?? []).map((value) => ({ value, label: value })),
                ]}
              />
            </FormField>
            <FormField label="Record">
              <Input
                aria-label="Target"
                placeholder="Type or identifier"
                value={target}
                onChange={(e) => change(setTarget)(e.target.value)}
                maxLength={320}
              />
            </FormField>
            <FormField label="Source">
              <Combobox
                label="Source"
                value={source}
                onChange={change(setSource)}
                options={[
                  { value: '', label: 'All sources' },
                  ...Object.entries({
                    MUST_STAFF: 'Staff in MUST',
                    MUST_AUTOMATION: 'MUST automation',
                    GUEST: 'Guest',
                    CLOCK: 'Clock',
                    POKPAY: 'PokPay',
                    STRIPE: 'Stripe',
                    PLATFORM_ADMIN: 'Platform administrator',
                  }).map(([value, label]) => ({ value, label })),
                ]}
              />
            </FormField>
          </div>
        </details>
        {data ? (
          <p className="m-0 text-xs text-muted-foreground">
            {data.canViewActors
              ? 'Names are shown as they are in the account today.'
              : 'Names are hidden. You need the staff permission to see who did what.'}{' '}
            Sensitive values are hidden, and long records may be shortened.
          </p>
        ) : null}
      </div>
      {lastExport && canExport && lastExport.scopeKey === data?.scopeKey ? (
        <Alert>
          <AlertDescription>
            Exported {lastExport.count} recorded events. Evidence: {lastExport.evidenceId}.{' '}
            <Button
              variant="link"
              onClick={() => {
                try {
                  downloadAuditCsv(lastExport);
                  setDownloadError('');
                } catch {
                  setDownloadError(
                    'Download could not start. Try downloading the same audited file again.',
                  );
                }
              }}
            >
              Download same file again
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {downloadError ? (
        <ErrorPanel title="Download unavailable" description={downloadError} />
      ) : null}
      {query.error ? (
        <ErrorPanel
          title={
            query.error instanceof AuditRequestError && query.error.status === 403
              ? 'Audit access denied'
              : 'Audit log unavailable'
          }
          description={query.error.message}
          reference={
            query.error instanceof AuditRequestError
              ? (query.error.reference ?? undefined)
              : undefined
          }
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <ListSkeleton rows={6} />
      ) : data ? (
        <RecordDirectory
          rows={data.items}
          storageKey="must.audit.table"
          exportable={false}
          defaultHidden={['risk', 'evidence', 'family', 'source', 'target']}
          initialSort={{ key: 'createdAt', direction: 'desc' }}
          onRow={(e) => setSelected(e.id)}
          emptyTitle="No recorded audit events match these filters"
          columns={[
            {
              id: 'action',
              label: 'What happened',
              value: (e) => e.title ?? e.action,
              render: (e) => (
                <span className="block max-w-52 truncate" title={e.action}>
                  {e.title ?? e.action}
                  {e.summary ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {e.summary}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              id: 'result',
              label: 'Result',
              value: (e) => e.result,
              render: (e) => (
                <Badge
                  variant={
                    ['Failed', 'Denied'].includes(e.result)
                      ? 'danger'
                      : e.result === 'Succeeded'
                        ? 'success'
                        : ['Pending', 'Unknown'].includes(e.result)
                          ? 'warning'
                          : 'secondary'
                  }
                >
                  {auditResultLabel(e.result)}
                </Badge>
              ),
            },
            {
              id: 'createdAt',
              label: 'When',
              value: (e) => e.createdAt,
              render: (e) => formatDateTime(e.createdAt),
            },
            { id: 'family', label: 'Area', value: (e) => e.family },
            { id: 'source', label: 'Source', value: (e) => e.source ?? 'Not specified' },
            {
              id: 'actor',
              label: 'Who',
              value: (e) => e.actor,
              render: (e) => (
                <span className="block max-w-36 truncate" title={e.actor}>
                  {e.actor}
                </span>
              ),
            },
            {
              id: 'target',
              label: 'Record',
              value: (e) => `${e.targetType} / ${e.targetId ?? 'Hidden'}`,
              render: (e) => (
                <span
                  className="block max-w-44 truncate"
                  title={`${e.targetType} / ${e.targetId ?? 'Hidden'}`}
                >
                  {e.targetType} / {e.targetId ?? 'Hidden'}
                </span>
              ),
            },
            {
              id: 'risk',
              label: 'Importance',
              value: (e) => (e.critical ? 'Critical' : 'Normal'),
            },
            { id: 'evidence', label: 'Reference', value: (e) => e.id },
          ]}
          actions={(e) => [{ label: 'See details', onSelect: () => setSelected(e.id) }]}
          selectionActions={(rows) => [
            {
              label: 'Export selected',
              disabled: !canExport,
              onSelect: () => setExportIds(rows.map((r) => r.id)),
            },
          ]}
          pagination={{
            page,
            pageSize,
            total: data.total,
            onPage: setPage,
            onPageSize: (size) => {
              setPageSize(size);
              setPage(1);
            },
          }}
        />
      ) : null}
      <QuickPeek
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Event detail"
        description="What was recorded for this event."
        badges={
          event ? (
            <>
              <Badge>{event.family}</Badge>
              <Badge variant={event.critical ? 'warning' : 'secondary'}>
                {event.critical ? 'Critical' : 'Normal'}
              </Badge>
            </>
          ) : null
        }
      >
        {detail.error ? (
          <ErrorPanel
            title="Audit evidence unavailable"
            description={detail.error.message}
            onRetry={() => void detail.refetch()}
          />
        ) : event ? (
          <>
            <DetailList
              items={[
                { label: 'Reference', value: event.id },
                { label: 'When', value: formatDateTime(event.createdAt) },
                { label: 'What happened', value: event.title ?? event.action },
                { label: 'Source', value: event.source ?? 'Not specified' },
                ...(event.operationId
                  ? [{ label: 'Action reference', value: event.operationId }]
                  : []),
                { label: 'Who', value: event.actor },
                {
                  label: 'Record',
                  value: `${event.targetType} / ${event.targetId ?? 'Hidden (needs the staff permission)'}`,
                },
                { label: 'Result', value: auditResultLabel(event.result) },
                { label: 'Reason', value: event.reason ?? 'Not recorded' },
              ]}
            />
            {event.result === 'Unknown' ? (
              <Alert>
                <AlertDescription>
                  The outcome needs verification. This entry is not proof of success or failure in
                  the provider.
                </AlertDescription>
              </Alert>
            ) : null}
            {recordedChanges(event).length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm" aria-label="Recorded changes">
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-3">Field</th>
                      <th className="p-3">Before</th>
                      <th className="p-3">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordedChanges(event).map((change) => (
                      <tr key={change.field} className="border-t">
                        <th className="p-3 font-medium">{change.field}</th>
                        <td className="p-3 break-words">
                          {typeof change.before === 'object'
                            ? JSON.stringify(change.before)
                            : String(change.before ?? 'Not specified')}
                        </td>
                        <td className="p-3 break-words">
                          {typeof change.after === 'object'
                            ? JSON.stringify(change.after)
                            : String(change.after ?? 'Not specified')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No field-by-field changes were saved for this event.
              </p>
            )}
            {event.linked?.length ? (
              <section aria-label="Operation timeline">
                <h3 className="mb-3 font-semibold">Operation timeline</h3>
                <ol className="space-y-3 border-l pl-4">
                  {event.linked.map((item) => (
                    <li key={item.id}>
                      <Button
                        variant="link"
                        className="h-auto p-0 text-left"
                        onClick={() => setSelected(item.id)}
                      >
                        {item.title ?? item.action}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {auditResultLabel(item.result)}
                        {item.source ? ' · ' + item.source : ''} · {formatDateTime(item.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
                {event.linkedTruncated ? (
                  <p className="text-xs text-muted-foreground">
                    Showing the first 50 linked events.
                  </p>
                ) : null}
              </section>
            ) : null}
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
              <p className="break-all text-xs text-muted-foreground">Event type: {event.action}</p>
              <DataSnapshot title="Before (recorded)" value={event.before} />
              <DataSnapshot title="After (recorded)" value={event.after} />
              <DataSnapshot title="Request context (recorded)" value={event.requestContext} />
              <DataSnapshot title="Other recorded details" value={event.details} />
            </details>
            {event.related?.length ? (
              <section aria-label="Other nearby activity">
                <h3 className="mb-2 font-semibold">Other nearby activity</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  These events concern the same record. They may belong to separate actions.
                </p>
                <ul className="space-y-2">
                  {event.related.map((item) => (
                    <li key={item.id}>
                      <Button
                        variant="link"
                        className="h-auto p-0 text-left"
                        onClick={() => setSelected(item.id)}
                      >
                        {item.title ?? item.action}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {auditResultLabel(item.result)} · {formatDateTime(item.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <ListSkeleton rows={3} />
        )}
      </QuickPeek>
      <ConfirmDialog
        open={exportIds !== undefined}
        onOpenChange={(open) => {
          if (!open) setExportIds(undefined);
        }}
        title="Export the audit log"
        description={`Create an audited CSV for ${exportIds ? exportIds.length + ' selected events' : 'the authorized filtered result'} through ${data?.through ?? 'the observed time'}. Maximum 5,000 events and 2 MB. Recorded snapshots may contain sensitive business information.`}
        confirmLabel="Create CSV"
        cancelLabel="Cancel"
        confirmDisabled={!canExport}
        onConfirm={async () => {
          if (!data) throw new Error('Reload the audit log before exporting.');
          let file: AuditExport;
          try {
            file = await exporter.current(`${base}/export`, {
              version: data.version,
              through: data.through,
              filters: data.filters,
              ...(exportIds ? { ids: exportIds } : {}),
            });
          } catch (error) {
            if (error instanceof AuditRequestError && [403, 409].includes(error.status))
              await client.invalidateQueries({ queryKey: ['activity-audit', base] });
            throw error;
          }
          setLastExport({ ...file, scopeKey: data.scopeKey });
          try {
            downloadAuditCsv(file);
            setDownloadError('');
          } catch {
            setDownloadError(
              'Download could not start. Use Download same file again; the export is already audited.',
            );
          }
          await client.invalidateQueries({ queryKey: ['activity-audit', base] });
        }}
      />
    </div>
  );
}
