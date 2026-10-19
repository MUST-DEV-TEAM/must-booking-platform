'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Combobox } from '../../../../components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { DetailList } from '../../../../components/ui/detail-list';
import { FilterChips } from '../../../../components/ui/filter-chips';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { PageHeader } from '../../../../components/ui/page-header';
import { Pagination } from '../../../../components/ui/pagination';
import { PermissionPanel } from '../../../../components/ui/permission-panel';
import { SearchInput } from '../../../../components/ui/search-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select';
import { Skeleton } from '../../../../components/ui/skeleton';
import { EmptyPanel, ErrorPanel, NoResultsPanel } from '../../../../components/ui/state-panel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import {
  type AuditRow,
  ConsoleApiError,
  consoleGet,
  consoleRequest,
  type HotelDirectory,
} from '../../../../lib/platform-api';
import { actionLabel, formatDateTime } from '../../../../lib/platform-format';
import { useConsoleSession } from '../console-frame';

const FAMILIES = [
  { value: 'all', label: 'All actions', prefix: '' },
  { value: 'auth', label: 'Sign-in and sessions', prefix: 'platform.auth.' },
  { value: 'hotel', label: 'Hotels and status', prefix: 'platform.hotel.' },
  { value: 'support', label: 'Support access', prefix: 'platform.support.' },
  { value: 'team', label: 'Team', prefix: 'platform.team.' },
  { value: 'access', label: 'Denied access', prefix: 'platform.access.' },
  { value: 'audit', label: 'Audit exports', prefix: 'platform.audit.' },
] as const;

const RESULT_TONE = { succeeded: 'success', failed: 'danger', denied: 'warning' } as const;

type Result = { items: AuditRow[]; total: number; page: number; pageSize: number };

function pretty(value: unknown): string {
  return value === null || value === undefined ? '—' : JSON.stringify(value, null, 2);
}

export default function AuditPage() {
  const { can } = useConsoleSession();
  const [actor, setActor] = useState('');
  const [family, setFamily] = useState<(typeof FAMILIES)[number]['value']>('all');
  const [tenantId, setTenantId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const prefix = FAMILIES.find((entry) => entry.value === family)?.prefix ?? '';
  const filters = () => {
    const params = new URLSearchParams();
    if (actor.trim()) params.set('actor', actor.trim());
    if (prefix) params.set('actionFamily', prefix);
    if (tenantId) params.set('tenantId', tenantId);
    if (from) params.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
    return params;
  };

  const hotels = useQuery({
    queryKey: ['platform-console', 'hotels', 'picker'],
    enabled: can('platform.audit.view') && can('platform.hotels.view'),
    queryFn: () => consoleGet<HotelDirectory>('/hotels?pageSize=100&sort=name&direction=asc'),
  });

  const query = useQuery({
    queryKey: ['platform-console', 'audit', actor, family, tenantId, from, to, page, pageSize],
    enabled: can('platform.audit.view'),
    queryFn: () => {
      const params = filters();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      return consoleGet<Result>(`/audit?${params}`);
    },
    placeholderData: (previous) => previous,
  });

  const exportCsv = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(filters());
      const csv = await consoleRequest<string>('POST', '/audit/export', body, {
        idempotencyKey: null,
        raw: true,
      });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'platform-audit.csv';
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  if (!can('platform.audit.view')) return <PermissionPanel />;

  const chips = [
    ...(actor.trim() ? [{ key: 'actor', label: `Person: ${actor.trim()}` }] : []),
    ...(family !== 'all'
      ? [{ key: 'family', label: FAMILIES.find((f) => f.value === family)!.label }]
      : []),
    ...(tenantId
      ? [
          {
            key: 'tenant',
            label: `Hotel: ${hotels.data?.items.find((h) => h.id === tenantId)?.name ?? tenantId}`,
          },
        ]
      : []),
    ...(from ? [{ key: 'from', label: `From ${from}` }] : []),
    ...(to ? [{ key: 'to', label: `To ${to}` }] : []),
  ];
  const clear = (key?: string) => {
    setPage(1);
    if (!key || key === 'actor') setActor('');
    if (!key || key === 'family') setFamily('all');
    if (!key || key === 'tenant') setTenantId('');
    if (!key || key === 'from') setFrom('');
    if (!key || key === 'to') setTo('');
  };
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Everything done in the console, in order. Entries can’t be edited or deleted."
        actions={
          can('platform.audit.export') ? (
            <Button
              variant="outline"
              onClick={() => exportCsv.mutate()}
              loading={exportCsv.isPending}
            >
              <Download aria-hidden="true" /> Export CSV
            </Button>
          ) : null
        }
      />
      {exportCsv.error instanceof ConsoleApiError ? (
        <Alert variant="destructive">
          <AlertDescription>
            The export failed: {exportCsv.error.message}
            {exportCsv.error.reference ? ` Reference: ${exportCsv.error.reference}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-end gap-3 border-b p-4">
          <SearchInput
            aria-label="Search by person"
            placeholder="Person’s email"
            className="w-full sm:w-64"
            value={actor}
            onChange={(event) => {
              setPage(1);
              setActor(event.target.value);
            }}
          />
          <Select
            value={family}
            onValueChange={(value) => {
              setPage(1);
              setFamily(value as typeof family);
            }}
          >
            <SelectTrigger aria-label="Filter by action" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FAMILIES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hotels.data ? (
            <div className="w-56">
              <Combobox
                label="Hotel"
                value={tenantId}
                onChange={(value) => {
                  setPage(1);
                  setTenantId(value);
                }}
                options={[
                  { value: '', label: 'All hotels' },
                  ...hotels.data.items.map((hotel) => ({ value: hotel.id, label: hotel.name })),
                ]}
              />
            </div>
          ) : null}
          <FormField label="From" htmlFor="audit-from" className="w-40">
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(e) => {
                setPage(1);
                setFrom(e.target.value);
              }}
            />
          </FormField>
          <FormField label="To" htmlFor="audit-to" className="w-40">
            <Input
              id="audit-to"
              type="date"
              value={to}
              onChange={(e) => {
                setPage(1);
                setTo(e.target.value);
              }}
            />
          </FormField>
        </div>
        {chips.length > 0 ? (
          <div className="border-b px-4 py-3">
            <FilterChips chips={chips} onRemove={clear} onClearAll={() => clear()} />
          </div>
        ) : null}

        {query.isError ? (
          <div className="p-4">
            <ErrorPanel
              title="We couldn’t load the audit log"
              reference={
                query.error instanceof ConsoleApiError
                  ? (query.error.reference ?? undefined)
                  : undefined
              }
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : query.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading audit log">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data && data.total === 0 ? (
          <div className="p-4">
            {chips.length > 0 ? (
              <NoResultsPanel onClear={() => clear()} />
            ) : (
              <EmptyPanel
                title="Nothing recorded yet"
                description="Console activity appears here as it happens."
              />
            )}
          </div>
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Hotel</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>
                    <span className="sr-only">Details</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      {row.actorEmail ?? 'Unknown'}
                      {row.actorRole ? (
                        <span className="block text-xs text-muted-foreground">{row.actorRole}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-medium">{actionLabel(row.action)}</TableCell>
                    <TableCell>
                      {row.tenantName ?? (row.tenantId ? row.tenantId.slice(0, 8) : '—')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RESULT_TONE[row.result]}>{row.result}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                        Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              noun="entries"
              onPage={setPage}
              pageSizeOptions={[25, 50, 100, 200]}
              onPageSize={(size) => {
                setPage(1);
                setPageSize(size);
              }}
            />
          </>
        ) : null}
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{actionLabel(selected.action)}</DialogTitle>
                <DialogDescription>{selected.action}</DialogDescription>
              </DialogHeader>
              <DetailList
                items={[
                  { label: 'When', value: formatDateTime(selected.createdAt) },
                  {
                    label: 'Who',
                    value: [selected.actorEmail, selected.actorRole].filter(Boolean).join(' · '),
                  },
                  { label: 'Hotel', value: selected.tenantName ?? selected.tenantId },
                  {
                    label: 'Target',
                    value: [selected.targetType, selected.targetId].filter(Boolean).join(' '),
                  },
                  { label: 'Reason', value: selected.reason },
                  { label: 'Result', value: selected.result },
                  { label: 'IP address', value: selected.ip },
                  { label: 'Request reference', value: selected.requestId },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="m-0 mb-1 text-xs font-semibold text-muted-foreground">Before</p>
                  <pre className="m-0 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {pretty(selected.before)}
                  </pre>
                </div>
                <div>
                  <p className="m-0 mb-1 text-xs font-semibold text-muted-foreground">After</p>
                  <pre className="m-0 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {pretty(selected.after)}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
