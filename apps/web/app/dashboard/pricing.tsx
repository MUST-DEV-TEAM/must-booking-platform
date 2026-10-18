'use client';
import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page-header';
import { TabBar } from '../../components/ui/tab-bar';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../../components/ui/card';
import { StatTile } from '../../components/ui/stat-tile';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { Combobox } from '../../components/ui/combobox';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { RecordDirectory, type RecordColumn } from '../../components/ui/record-directory';
import { PriceGrid, type PriceGridRow } from '../../components/ui/price-grid';
import { QuickPeek } from '../../components/ui/quick-peek';
import { Timeline } from '../../components/ui/timeline';
import { DetailList } from '../../components/ui/detail-list';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { inventoryRequest, createInventoryWriter } from './inventory-api';
import { PricingEditor } from './pricing-editor';
import { PricingBaseEditor } from './pricing-base-editor';
import { PricingPreviewPanel } from './pricing-preview';
import { ClockPricingPriority } from './pricing-clock-priority';
import {
  priceDay,
  type PricingWorkspace,
  type PricingRecord,
  type PricingKind,
  type PricingIssue,
} from './pricing-types';
const titles = { plans: 'Rate plans', rules: 'Pricing rules', charges: 'Taxes & fees' };
/** Property-scoped rates workspace using the saved pricing contract and shared dashboard components. */
export function PricingSection({
  tenantId,
  propertyId,
  emailVerified,
}: {
  tenantId: string;
  propertyId: string;
  emailVerified: boolean;
}) {
  const root = `/api/tenants/${tenantId}/properties/${propertyId}`,
    base = `${root}/pricing`,
    client = useQueryClient();
  const [tab, setTab] = useState('overview'),
    [view, setView] = useState('All'),
    [scope, setScope] = useState('all'),
    [peek, setPeek] = useState<{ kind: PricingKind; record: PricingRecord } | null>(null),
    [detail, setDetail] = useState(false),
    [editor, setEditor] = useState<{ kind: PricingKind; record?: PricingRecord } | null>(null),
    [baseEdit, setBaseEdit] = useState<{
      roomTypeId?: string;
      date?: string;
      planId?: string;
    } | null>(null),
    [confirm, setConfirm] = useState<{
      kind: PricingKind;
      record: PricingRecord;
      action: string;
    } | null>(null);
  const [issuePeek, setIssuePeek] = useState<PricingIssue | null>(null);
  const writer = useRef(createInventoryWriter());
  const caps = useQuery({
    queryKey: ['dashboard', 'pricing-access', tenantId, propertyId],
    queryFn: () => inventoryRequest<string[]>(`${root}/capabilities/mine`),
  });
  const allowed = Array.isArray(caps.data) && caps.data.includes('rates.manage');
  const query = useQuery({
    queryKey: ['dashboard', 'pricing', tenantId, propertyId],
    enabled: allowed,
    queryFn: () => inventoryRequest<PricingWorkspace>(base),
  });
  const history = useQuery({
    queryKey: [
      'dashboard',
      'pricing-history',
      tenantId,
      propertyId,
      peek?.kind,
      peek?.record.id,
      peek?.record.version,
    ],
    enabled: allowed && !!peek,
    queryFn: () =>
      inventoryRequest<{ id: string; action: string; createdAt: string; actorUserId?: string }[]>(
        `${base}/history/${peek!.kind}/${peek!.record.id}`,
      ),
  });
  const [plan, setPlan] = useState(''),
    [start, setStart] = useState(''),
    [days, setDays] = useState('14');
  const calendar = useQuery({
    queryKey: [
      'dashboard',
      'pricing-calendar',
      tenantId,
      propertyId,
      plan,
      start,
      days,
      query.data?.pricingVersion,
    ],
    enabled: allowed && tab === 'base' && !!query.data,
    queryFn: () =>
      inventoryRequest<{ rows: PriceGridRow[] }>(
        `${base}/calendar?startsOn=${start || query.data!.today}&days=${days}${plan ? `&ratePlanId=${plan}` : ''}`,
      ),
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['dashboard', 'pricing', tenantId, propertyId] });
  if (caps.isPending) return <ListSkeleton />;
  if (caps.error)
    return (
      <ErrorPanel
        title="Pricing access could not be checked"
        description={caps.error.message}
        onRetry={() => void caps.refetch()}
      />
    );
  if (!allowed)
    return (
      <EmptyPanel
        title="Rates access required"
        description="You need rates.manage to view this section."
      />
    );
  if (query.error)
    return (
      <ErrorPanel
        title="Pricing could not be loaded"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  if (!query.data) return <ListSkeleton />;
  const data = query.data,
    canWrite = !data.readOnly && emailVerified,
    kind = tab === 'plans' || tab === 'rules' || tab === 'charges' ? tab : null;
  const record = peek
    ? (data[peek.kind].find((r) => r.id === peek.record.id) ?? peek.record)
    : null;
  const scopeName = (r: PricingRecord) =>
    r.roomTypeIds.length
      ? r.roomTypeIds
          .map((id) => data.roomTypes.find((t) => t.id === id)?.name ?? 'Removed room type')
          .join(', ')
      : 'All room types';
  const actions = (k: PricingKind, r: PricingRecord) =>
    canWrite
      ? [
          ...(r.lifecycle !== 'Archived'
            ? [
                { label: 'Edit', onSelect: () => setEditor({ kind: k, record: r }) },
                ...(r.lifecycle === 'Draft'
                  ? [
                      {
                        label: 'Activate',
                        onSelect: () => setConfirm({ kind: k, record: r, action: 'activate' }),
                      },
                    ]
                  : []),
                ...(!r.isFallback
                  ? [
                      {
                        label: 'Archive',
                        onSelect: () => setConfirm({ kind: k, record: r, action: 'archive' }),
                      },
                    ]
                  : []),
              ]
            : []),
          {
            label: 'Duplicate as draft',
            onSelect: () => setConfirm({ kind: k, record: r, action: 'duplicate' }),
          },
          ...(k === 'plans' && r.lifecycle === 'Active' && !r.isFallback
            ? [
                {
                  label: 'Set fallback',
                  onSelect: () => setConfirm({ kind: k, record: r, action: 'fallback' }),
                },
              ]
            : []),
        ]
      : [];
  const columns: RecordColumn<PricingRecord>[] = [
    { id: 'name', label: 'Name', value: (r) => r.name },
    {
      id: 'status',
      label: 'Status',
      value: (r) => r.lifecycle,
      render: (r) => (
        <Badge variant="outline">
          {r.lifecycle}
          {r.isFallback ? ' - Fallback' : ''}
        </Badge>
      ),
    },
    { id: 'scope', label: 'Room types', value: scopeName },
    {
      id: 'configuration',
      label: 'Pricing',
      value: (r) =>
        kind === 'plans'
          ? `${r.pricingBasis} - ${r.currency}`
          : kind === 'rules'
            ? `${r.value} ${r.mode} - priority ${r.priority}`
            : `${r.value} - ${r.basis} - ${r.display}`,
    },
    { id: 'version', label: 'Version', value: (r) => r.version },
  ];
  const facts = (r: PricingRecord) => [
    { label: 'Status', value: r.lifecycle },
    { label: 'Version', value: r.version },
    { label: 'Code', value: r.code },
    { label: 'Currency', value: r.currency },
    { label: 'Description', value: r.description },
    { label: 'Room types', value: scopeName(r) },
    { label: 'Channels', value: r.channels?.join(', ') },
    { label: 'Meal plan', value: r.mealPlan?.replaceAll('_', ' ') },
    { label: 'Pricing basis', value: r.pricingBasis },
    {
      label: 'Parent plan',
      value: r.basePlanId ? data.plans.find((p) => p.id === r.basePlanId)?.name : null,
    },
    {
      label: 'Adjustment',
      value: r.adjustmentKind
        ? `${r.adjustmentValue} ${r.adjustmentKind}`
        : r.mode
          ? `${r.value} ${r.mode}`
          : null,
    },
    {
      label: 'Schedule',
      value: r.startsOn ? `${r.startsOn} to ${r.endsOn ?? 'no end'} (end inclusive)` : null,
    },
    { label: 'Weekdays', value: r.weekdays?.join(', ') },
    {
      label: 'Stay',
      value:
        r.minStay || r.maxStay ? `${r.minStay ?? 1} to ${r.maxStay ?? 'unlimited'} nights` : null,
    },
    {
      label: 'Advance',
      value:
        r.minAdvance || r.maxAdvance
          ? `${r.minAdvance ?? 0} to ${r.maxAdvance ?? 'unlimited'} days`
          : null,
    },
    {
      label: 'Publication',
      value:
        r.publicationStartsOn || r.publicationEndsOn
          ? `${r.publicationStartsOn ?? 'Any'} to ${r.publicationEndsOn ?? 'Any'}`
          : null,
    },
    { label: 'Charge basis', value: r.basis },
    { label: 'Disclosure', value: r.display },
    { label: 'Applicability confirmed', value: r.basis ? (r.confirmed ? 'Yes' : 'No') : null },
    {
      label: 'Payment terms',
      value: peek?.kind === 'plans' ? 'Property payment settings apply' : null,
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={detail && record ? record.name : 'Rates & Pricing'}
        description="Manage plans, nightly prices, seasons and mandatory charges."
        actions={
          canWrite && kind && !detail ? (
            <Button onClick={() => setEditor({ kind })}>
              Create{' '}
              {kind === 'plans' ? 'rate plan' : kind === 'rules' ? 'pricing rule' : 'tax or fee'}
            </Button>
          ) : undefined
        }
      />
      {data.readOnly ? (
        <Alert>
          <AlertTitle>Managed in Clock</AlertTitle>
          <AlertDescription>
            Prices and rate definitions are read-only. Unknown means no provider price has been
            loaded; MUST does not substitute a calculated price.
          </AlertDescription>
        </Alert>
      ) : !emailVerified ? (
        <Alert>
          <AlertTitle>Verify your email to edit prices</AlertTitle>
        </Alert>
      ) : null}
      {detail && peek && record ? (
        <>
          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              setDetail(false);
              setPeek(null);
            }}
          >
            Back to {titles[peek.kind]}
          </Button>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Status" value={record.lifecycle} size="sm" />
            <StatTile
              label="Pricing basis"
              value={record.pricingBasis ?? record.basis ?? record.mode}
              size="sm"
            />
            <StatTile label="Version" value={record.version} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Saved record - {record.code ?? record.id}</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList items={facts(record)} />
              <div className="mt-4 flex flex-wrap gap-2">
                {actions(peek.kind, record).map((a) => (
                  <Button key={a.label} variant="outline" onClick={a.onSelect}>
                    {a.label}
                  </Button>
                ))}
                {canWrite &&
                peek.kind === 'plans' &&
                record.pricingBasis === 'independent' &&
                record.lifecycle !== 'Archived' ? (
                  <Button onClick={() => setBaseEdit({ planId: record.id })}>
                    Edit base prices
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
          {peek.kind === 'plans' ? (
            <PricingPreviewPanel key={record.id} base={base} data={data} planId={record.id} />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {history.error ? (
                <ErrorPanel
                  title="Activity could not be loaded"
                  onRetry={() => void history.refetch()}
                />
              ) : history.isPending ? (
                <ListSkeleton />
              ) : (
                <Timeline
                  items={(history.data ?? []).map((r) => ({
                    key: r.id,
                    title: r.action,
                    meta: r.createdAt,
                  }))}
                  empty="No activity recorded"
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <TabBar
            label="Pricing sections"
            current={tab}
            onSelect={(t) => {
              setTab(t);
              setView('All');
              setScope('all');
              setPeek(null);
            }}
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'base', label: 'Base prices' },
              {
                id: 'rules',
                label: 'Pricing rules',
                count: data.readOnly ? undefined : data.rules.length,
              },
              {
                id: 'plans',
                label: 'Rate plans',
                count: data.readOnly ? undefined : data.plans.length,
              },
              {
                id: 'charges',
                label: 'Taxes & fees',
                count: data.readOnly ? undefined : data.charges.length,
              },
              {
                id: 'issues',
                label: 'Issues',
                count: data.readOnly ? undefined : data.issues.length,
              },
            ]}
          />
          {tab === 'overview' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Active plans"
                  value={
                    data.readOnly
                      ? 'Managed in Clock'
                      : data.plans.filter((p) => p.lifecycle === 'Active').length
                  }
                />
                <StatTile
                  label="Coverage"
                  value={
                    data.coverage?.percentage == null ? 'Unknown' : `${data.coverage.percentage}%`
                  }
                  note={
                    data.coverage
                      ? `${data.coverage.startsOn} to ${data.coverage.endsOn}${data.coverage.horizonComplete ? '' : ' - 365-day sample'}`
                      : data.readOnly
                        ? 'Managed in Clock'
                        : 'No coverage calculated'
                  }
                />
                <StatTile
                  label="Active rules"
                  value={
                    data.readOnly
                      ? 'Unknown'
                      : data.rules.filter((r) => r.lifecycle === 'Active').length
                  }
                />
                <StatTile
                  label="Pricing issues"
                  value={data.readOnly ? 'Unknown' : data.issues.length}
                  onClick={() => setTab('issues')}
                />
              </div>
              {data.coverage ? (
                <Alert>
                  <AlertTitle>Coverage checks pricing configuration</AlertTitle>
                  <AlertDescription>
                    {data.coverage.example} Stock and availability are not included.
                  </AlertDescription>
                </Alert>
              ) : null}
              <PricingPreviewPanel base={base} data={data} />
              {data.readOnly && caps.data?.includes('settings.manage') ? (
                <ClockPricingPriority root={root} types={data.roomTypes} canWrite={emailVerified} />
              ) : null}
            </>
          ) : null}
          {tab === 'base' ? (
            <>
              <div className="flex flex-wrap items-end gap-3">
                {!data.readOnly ? (
                  <FormField label="Rate plan">
                    <Combobox
                      label="Grid rate plan"
                      value={
                        plan || data.plans.find((p) => p.isFallback)?.id || data.plans[0]?.id || ''
                      }
                      onChange={setPlan}
                      options={data.plans.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </FormField>
                ) : null}
                <FormField label="Start date">
                  <Input
                    aria-label="Price grid start date"
                    type="date"
                    value={start || data.today}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </FormField>
                <FormField label="Days">
                  <Combobox
                    label="Price grid days"
                    value={days}
                    onChange={setDays}
                    options={['7', '14', '30'].map((d) => ({ value: d, label: `${d} days` }))}
                  />
                </FormField>
                <Button
                  variant="outline"
                  onClick={() => setStart(priceDay(start || data.today, -Number(days)))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStart(priceDay(start || data.today, Number(days)))}
                >
                  Next
                </Button>
                {canWrite &&
                data.plans.some(
                  (p) => p.pricingBasis === 'independent' && p.lifecycle !== 'Archived',
                ) ? (
                  <Button onClick={() => setBaseEdit({ planId: plan || undefined })}>
                    Bulk edit base prices
                  </Button>
                ) : null}
              </div>
              <Alert>
                <AlertTitle>
                  {data.readOnly ? 'Managed in Clock' : 'Nightly customer totals'}
                </AlertTitle>
                <AlertDescription>
                  {data.readOnly
                    ? 'Unknown until Clock supplies an actual quote.'
                    : 'One adult, one night, staff channel; includes saved mandatory charges. Cell editing changes the underlying accommodation base. Past dates are read-only.'}
                </AlertDescription>
              </Alert>
              {calendar.error ? (
                <ErrorPanel
                  title="Prices could not be loaded"
                  description={calendar.error.message}
                  onRetry={() => void calendar.refetch()}
                />
              ) : calendar.isPending ? (
                <ListSkeleton />
              ) : calendar.data?.rows.length ? (
                <PriceGrid
                  rows={calendar.data.rows}
                  canEditCell={(_, date) => date >= data.today}
                  onCell={
                    canWrite &&
                    data.plans.find(
                      (p) =>
                        p.id ===
                        (plan || data.plans.find((p) => p.isFallback)?.id || data.plans[0]?.id),
                    )?.pricingBasis === 'independent'
                      ? (roomTypeId, date) => {
                          if (date >= data.today)
                            setBaseEdit({
                              roomTypeId,
                              date,
                              planId:
                                plan ||
                                data.plans.find((p) => p.isFallback)?.id ||
                                data.plans[0]?.id,
                            });
                        }
                      : undefined
                  }
                />
              ) : (
                <EmptyPanel
                  title="No base prices yet"
                  description="Create an independent rate plan, then configure its room-type prices."
                />
              )}
            </>
          ) : null}
          {kind ? (
            data.readOnly ? (
              <EmptyPanel
                title={`${titles[kind]} are managed in Clock`}
                description="Local pricing controls do not apply to this hotel."
              />
            ) : (
              <>
                <TabBar
                  label="Pricing lifecycle"
                  current={view}
                  onSelect={setView}
                  tabs={['All', 'Active', 'Draft', 'Archived'].map((v) => ({
                    id: v,
                    label: v,
                    count: data[kind].filter((r) => v === 'All' || r.lifecycle === v).length,
                  }))}
                />
                <FormField label="Room type">
                  <Combobox
                    label="Filter pricing room type"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: 'all', label: 'All room types' },
                      ...data.roomTypes.map((t) => ({ value: t.id, label: t.name })),
                    ]}
                  />
                </FormField>
                <RecordDirectory
                  key={kind}
                  rows={data[kind].filter(
                    (r) =>
                      (view === 'All' || r.lifecycle === view) &&
                      (scope === 'all' || !r.roomTypeIds.length || r.roomTypeIds.includes(scope)),
                  )}
                  columns={columns}
                  storageKey={`must.pricing.${kind}.table`}
                  onRow={(r) => {
                    setPeek({ kind, record: r });
                    setDetail(false);
                  }}
                  actions={(r) => actions(kind, r)}
                  emptyTitle={`No ${titles[kind].toLowerCase()} in this view`}
                />
              </>
            )
          ) : null}
          {tab === 'issues' ? (
            data.readOnly ? (
              <EmptyPanel
                title="Clock pricing health is unknown"
                description="Local pricing diagnostics cannot verify provider prices."
              />
            ) : (
              <RecordDirectory<PricingIssue>
                rows={data.issues}
                columns={[
                  { id: 'name', label: 'Issue', value: (r) => r.name },
                  { id: 'severity', label: 'Severity', value: (r) => r.severity },
                  { id: 'scope', label: 'Scope', value: (r) => r.scope },
                  { id: 'message', label: 'Details', value: (r) => r.message },
                ]}
                storageKey="must.pricing.issues.table"
                onRow={(r) => {
                  setIssuePeek(r);
                  const target = r.kind && data[r.kind].find((p) => p.id === r.recordId);
                  if (target && r.kind) {
                    setIssuePeek(null);
                    setPeek({ kind: r.kind, record: target });
                    setDetail(false);
                  }
                }}
                emptyTitle="No pricing issues found"
              />
            )
          ) : null}
        </>
      )}
      {peek && record && !detail ? (
        <QuickPeek
          open
          onClose={() => setPeek(null)}
          title={record.name}
          description={titles[peek.kind]}
          badges={<Badge variant="outline">{record.lifecycle}</Badge>}
          actions={
            <>
              <Button onClick={() => setDetail(true)}>Open detail</Button>
              {actions(peek.kind, record).map((a) => (
                <Button key={a.label} variant="outline" onClick={a.onSelect}>
                  {a.label}
                </Button>
              ))}
            </>
          }
        >
          <DetailList items={facts(record)} />
        </QuickPeek>
      ) : null}
      {issuePeek ? (
        <QuickPeek
          open
          onClose={() => setIssuePeek(null)}
          title={issuePeek.name}
          description={issuePeek.scope}
          badges={<Badge variant="outline">{issuePeek.severity}</Badge>}
        >
          <DetailList
            items={[
              { label: 'Issue code', value: issuePeek.code },
              { label: 'Details', value: issuePeek.message },
            ]}
          />
        </QuickPeek>
      ) : null}
      {editor && canWrite ? (
        <PricingEditor
          base={base}
          kind={editor.kind}
          record={editor.record}
          data={data}
          onClose={() => setEditor(null)}
          onStored={() => void refresh()}
          onSaved={(r) => {
            setEditor(null);
            setPeek({ kind: editor.kind, record: r });
            void refresh();
          }}
        />
      ) : null}
      {baseEdit && canWrite ? (
        <PricingBaseEditor
          base={base}
          data={data}
          initial={baseEdit}
          onClose={() => setBaseEdit(null)}
          onSaved={() => {
            setBaseEdit(null);
            void refresh();
          }}
        />
      ) : null}
      {confirm && canWrite ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`${confirm.action[0].toUpperCase() + confirm.action.slice(1)} ${confirm.record.name}?`}
          description="Applies to future price calculations. Issued quotes and existing bookings keep their saved prices."
          confirmLabel="Confirm change"
          reasonLabel="Reason"
          reasonRequired
          onConfirm={async (reason) => {
            const previous = data.plans.find((p) => p.isFallback);
            await writer.current(
              `${base}/${confirm.kind}/${confirm.record.id}/${confirm.action}`,
              'POST',
              {
                version: confirm.record.version,
                changeReason: reason,
                ...(confirm.action === 'fallback'
                  ? {
                      previousFallbackId: previous?.id ?? null,
                      previousFallbackVersion: previous?.version ?? null,
                    }
                  : {}),
              },
            );
            setConfirm(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
