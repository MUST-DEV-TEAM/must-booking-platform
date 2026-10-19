'use client';
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
import { QuickPeek } from '../../components/ui/quick-peek';
import { RecordDirectory } from '../../components/ui/record-directory';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { StatTile } from '../../components/ui/stat-tile';
import {
  auditRequest,
  auditPage,
  AuditRequestError,
  createAuditExporter,
  downloadAuditCsv,
  type AuditEvent,
  type AuditExport,
} from '../../lib/activity-audit';
/** Property evidence directory; every CSV is created and audited on the server. */
export function ActivityAudit({
  tenantId,
  propertyId,
  userId = 'session',
}: {
  tenantId: string;
  propertyId: string;
  userId?: string;
}) {
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(25),
    [search, setSearch] = useState(''),
    [family, setFamily] = useState(''),
    [actor, setActor] = useState(''),
    [target, setTarget] = useState(''),
    [result, setResult] = useState(''),
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
      <PageHeader
        title="Activity and audit log"
        description="Recorded actions for this hotel. Missing historical evidence stays explicit."
        actions={
          <Button variant="outline" disabled={!canExport} onClick={() => setExportIds(null)}>
            Export filtered CSV
          </Button>
        }
      />
      {data && !data.canExport ? (
        <Alert>
          <AlertDescription>
            Read only. Verify your email to export audit evidence.
          </AlertDescription>
        </Alert>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Today"
              value={data.counts.today}
              note="Matching events on the property local date"
            />
            <StatTile
              label="Critical events"
              value={data.counts.critical}
              note="Sensitive access, refunds, providers and exports"
            />
            <StatTile
              label="Unique actors"
              value={data.counts.uniqueActors}
              note="Recorded human identities in this result"
            />
          </div>
          <Alert>
            <AlertDescription>
              {data.canViewActors
                ? 'Actor labels reflect the current account identity.'
                : 'Actor identity is hidden. Required permission: staff.view.'}{' '}
              Sensitive fields are hidden. Large snapshots may be shortened.
            </AlertDescription>
          </Alert>
        </>
      ) : null}
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField label="Search audit log">
          <Input
            aria-label="Search audit log"
            placeholder="Action, target or evidence ID"
            maxLength={100}
            value={search}
            onChange={(e) => change(setSearch)(e.target.value)}
          />
        </FormField>
        <FormField label="Action family">
          <Combobox
            label="Action family"
            value={family}
            onChange={change(setFamily)}
            options={[
              { value: '', label: 'All permitted families' },
              ...(data?.families ?? []).map((value) => ({ value, label: value })),
            ]}
          />
        </FormField>
        <FormField label="Target">
          <Input
            aria-label="Target"
            placeholder="Type or identifier"
            value={target}
            onChange={(e) => change(setTarget)(e.target.value)}
            maxLength={320}
          />
        </FormField>
        <FormField label="Recorded result">
          <Combobox
            label="Recorded result"
            value={result}
            onChange={change(setResult)}
            options={[
              { value: '', label: 'All recorded results' },
              ...['Succeeded', 'Failed', 'Denied', 'Not recorded'].map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
        </FormField>
        <FormField label="From">
          <Input
            aria-label="Audit from date"
            type="date"
            value={from || data?.filters.from || ''}
            onChange={(e) => change(setFrom)(e.target.value)}
          />
        </FormField>
        <FormField label="To">
          <Input
            aria-label="Audit to date"
            type="date"
            value={to || data?.filters.to || ''}
            onChange={(e) => change(setTo)(e.target.value)}
          />
        </FormField>
        {data?.canViewActors ? (
          <FormField label="Actor">
            <Combobox
              label="Actor"
              value={actor}
              onChange={change(setActor)}
              options={[
                { value: '', label: 'All actors' },
                { value: 'system', label: 'System' },
                ...data.actors.map((a) => ({ value: a.id, label: a.label })),
              ]}
            />
          </FormField>
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
          defaultHidden={['risk', 'evidence']}
          initialSort={{ key: 'createdAt', direction: 'desc' }}
          onRow={(e) => setSelected(e.id)}
          emptyTitle="No recorded audit events match these filters"
          columns={[
            {
              id: 'action',
              label: 'Action',
              value: (e) => e.action,
              render: (e) => (
                <span className="block max-w-52 truncate" title={e.action}>
                  {e.action}
                </span>
              ),
            },
            {
              id: 'result',
              label: 'Recorded result',
              value: (e) => e.result,
              render: (e) => (
                <Badge
                  variant={
                    e.result === 'Failed'
                      ? 'danger'
                      : e.result === 'Succeeded'
                        ? 'success'
                        : 'secondary'
                  }
                >
                  {e.result}
                </Badge>
              ),
            },
            {
              id: 'createdAt',
              label: 'Time',
              value: (e) => e.createdAt,
              render: (e) => new Date(e.createdAt).toLocaleString(),
            },
            { id: 'family', label: 'Family', value: (e) => e.family },
            {
              id: 'actor',
              label: 'Actor',
              value: (e) => e.actor,
              render: (e) => (
                <span className="block max-w-36 truncate" title={e.actor}>
                  {e.actor}
                </span>
              ),
            },
            {
              id: 'target',
              label: 'Target',
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
              label: 'Classification',
              value: (e) => (e.critical ? 'Critical' : 'Standard'),
            },
            { id: 'evidence', label: 'Evidence ID', value: (e) => e.id },
          ]}
          actions={(e) => [{ label: 'View evidence', onSelect: () => setSelected(e.id) }]}
          selectionActions={(rows) => [
            {
              label: 'Export selected CSV',
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
        title="Audit event detail"
        description="Stored evidence only. Related events have the same target within 24 hours."
        badges={
          event ? (
            <>
              <Badge>{event.family}</Badge>
              <Badge variant={event.critical ? 'warning' : 'secondary'}>
                {event.critical ? 'Critical classification' : 'Standard classification'}
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
                { label: 'Evidence ID', value: event.id },
                { label: 'Time', value: new Date(event.createdAt).toLocaleString() },
                { label: 'Action', value: event.action },
                { label: 'Actor', value: event.actor },
                {
                  label: 'Target',
                  value: `${event.targetType} / ${event.targetId ?? 'Hidden (requires staff.view)'}`,
                },
                { label: 'Recorded result', value: event.result },
                { label: 'Reason', value: event.reason ?? 'Not recorded' },
              ]}
            />
            <DataSnapshot title="Before (recorded)" value={event.before} />
            <DataSnapshot title="After (recorded)" value={event.after} />
            <DataSnapshot title="Request context (recorded)" value={event.requestContext} />
            <DataSnapshot title="Other recorded details" value={event.details} />
            {event.related?.length ? (
              <DataSnapshot
                title="Related evidence identifiers"
                value={event.related.map((e) => ({
                  id: e.id,
                  action: e.action,
                  time: e.createdAt,
                }))}
              />
            ) : null}
            {event.related?.map((e) => (
              <Button key={e.id} variant="outline" size="sm" onClick={() => setSelected(e.id)}>
                {e.action}
              </Button>
            ))}
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
        title="Export audit evidence"
        description={`Create an audited CSV for ${exportIds ? exportIds.length + ' selected events' : 'the authorized filtered result'} through ${data?.through ?? 'the observed time'}. Maximum 5,000 events and 2 MB. Recorded snapshots may contain sensitive business information.`}
        confirmLabel="Create audited CSV"
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
