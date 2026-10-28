'use client';
import { HotelMoney } from './approximate-money';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FilterGrid } from '../../components/ui/filter-grid';
import { reportMissingReason, reportDisplayEvidence } from '../../lib/report-display';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page-header';
import { TabBar } from '../../components/ui/tab-bar';
import { StatTile } from '../../components/ui/stat-tile';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { FormField } from '../../components/ui/form-field';
import { Combobox } from '../../components/ui/combobox';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { ReportTable } from '../../components/ui/report-table';
import { ReportChart } from '../../components/ui/report-chart';
import { ReportBreakdown } from '../../components/ui/report-breakdown';
import { ReportPrint, type PrintReport } from '../../components/ui/report-print';
import { ReportViewEditor } from '../../components/ui/report-view-editor';
import { RecordDirectory } from '../../components/ui/record-directory';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ReportExportHistory } from './report-export-history';
import { ReportDefinitions } from './report-definitions';
import { GuestReviewReport } from './guest-review-report';
import {
  reportNames,
  type ReportKind,
  type ReportQuery,
  type ReportWorkspace,
  type ReportView,
  type ViewConfiguration,
  type ReportExport,
} from '../../lib/report-types';
import {
  ReportRequestError,
  reportRequest,
  reportSearch,
  reportLabel,
  reportValue,
  reportPreset,
} from '../../lib/report-presentation';
import { createReportWriter } from '../../lib/report-writer';
import { DateField } from '../../components/ui/date-field';
const tiles: Record<ReportKind, string[]> = {
  overview: ['bookings', 'cancelled', 'occupancy', 'soldNights', 'arrivals', 'departures'],
  reservations: [
    'bookings',
    'cancelled',
    'cancellationRate',
    'averageLengthOfStay',
    'averageLeadDays',
    'adults',
    'children',
    'sameDay',
    'advance',
  ],
  revenue: [
    'refundCount',
    'failedPayments',
    'failedPaymentBookings',
    'expiredUnpaidCheckouts',
    'reconciliationDifferences',
  ],
  occupancy: [
    'soldNights',
    'availableNights',
    'occupancy',
    'blockedNights',
    'soldOutDays',
    'lowAvailabilityDays',
    'stopSellTypeDays',
    'minStayTypeDays',
    'arrivals',
    'departures',
  ],
  accommodation: ['soldNights', 'availableNights', 'occupancy', 'cancelled'],
  guests: ['newGuests', 'returningGuests', 'unmatchedBookings', 'unmatchedStayBookings'],
  pricing: ['soldNights', 'blockedNights', 'stopSellTypeDays', 'minStayTypeDays'],
  operations: ['bookings'],
  quality: ['issues'],
};
const breakdowns: Record<ReportKind, string[]> = {
  overview: ['onTheBooksHistory', 'today', 'forward'],
  reservations: [
    'statuses',
    'funnel',
    'leadTimeDistribution',
    'lengthOfStayDistribution',
    'sourceMix',
    'roomTypeMix',
    'ratePlanMix',
    'mealPlanMix',
    'paymentMethodMix',
    'cancellationAnalysis',
    'noShow',
  ],
  revenue: ['financial', 'refunds', 'paymentMethods', 'byWeekday', 'breakdowns', 'chargeCoverage'],
  occupancy: ['onTheBooksHistory', 'forward', 'inventorySchedules', 'lengthOfStayDistribution'],
  accommodation: [],
  guests: ['guestOrigins', 'averageGuestRoomRevenue'],
  pricing: ['pricingHealth', 'inventorySchedules'],
  operations: ['emailStatus', 'staffActivity', 'staffByUser', 'staffByDay'],
  quality: [],
};
const details: Record<string, string[]> = {
  revenue: ['default', 'balances', 'reconciliation', 'charges', 'refunds'],
  pricing: ['default', 'issues'],
  operations: ['emails', 'staff'],
};
export function DashboardReports(props: { tenantId: string; propertyId: string }) {
  return <ReportsWorkspace key={`${props.tenantId}:${props.propertyId}`} {...props} />;
}
function ReportsWorkspace({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const queryClient = useQueryClient();
  const root = `/api/tenants/${tenantId}/properties/${propertyId}/reports`,
    writer = useRef(createReportWriter());
  const lastAction = useRef<(() => Promise<void>) | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]),
    [query, setQuery] = useState<ReportQuery>({ report: 'overview' }),
    [custom, setCustom] = useState(false),
    [reviewsTab, setReviewsTab] = useState(false),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [display, setDisplay] = useState<'chart' | 'table'>('chart'),
    [chartMetric, setChartMetric] = useState('bookings'),
    [selectedView, setSelectedView] = useState<ReportView | null>(null),
    [editing, setEditing] = useState<ReportView | true | null>(null),
    [deleting, setDeleting] = useState<ReportView | null>(null),
    [print, setPrint] = useState<PrintReport | null>(null);
  const reports = useQuery({
    queryKey: ['dashboard', 'report-workspace', tenantId, propertyId, query],
    queryFn: () => reportRequest<ReportWorkspace>(`${root}/workspace?${reportSearch(query)}`),
    retry: false,
  });
  const views = useQuery({
    queryKey: ['dashboard', 'report-views', tenantId, propertyId],
    queryFn: () => reportRequest<{ views: ReportView[] }>(root + '/views'),
    retry: false,
  });
  const data = reports.data;
  useEffect(() => {
    if (data) {
      setFrom(data.query.from ?? '');
      setTo(data.query.to ?? '');
    }
  }, [data?.query.from, data?.query.to]);
  const change = (patch: Partial<ReportQuery>) => {
    setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }));
    setError('');
  };
  const switchReport = (report: ReportKind) => {
    setSelectedView(null);
    setVisibleColumns([]);
    setChartMetric('bookings');
    setQuery((q) => ({ report, from: q.from, to: q.to, comparison: q.comparison, group: q.group }));
  };
  const metricColumns =
      data?.seriesColumns.filter(
        (c) =>
          !['date', 'currency'].includes(c.key) &&
          data.series.some((r) => r[c.key] !== null && r[c.key] !== undefined),
      ) ?? [],
    metric = metricColumns.find((c) => c.key === chartMetric) ?? metricColumns[0];
  const configuration: ViewConfiguration = {
    query: data?.query ?? query,
    columns:
      (visibleColumns.length
        ? visibleColumns.filter((k) => data?.columns.some((c) => c.key === k))
        : undefined) ??
      selectedView?.configuration.columns.filter((key) =>
        data?.columns.some((c) => c.key === key),
      ) ??
      data?.columns.slice(0, 7).map((c) => c.key) ??
      [],
    metrics:
      selectedView?.configuration.metrics ??
      tiles[query.report]
        .filter((k) =>
          [
            'bookings',
            'cancelled',
            'cancellationRate',
            'averageLengthOfStay',
            'averageLeadDays',
            'soldNights',
            'availableNights',
            'occupancy',
            'blockedNights',
            'arrivals',
            'departures',
          ].includes(k),
        )
        .slice(0, 4),
    display,
    chartMetric: metric?.key ?? 'bookings',
  };
  if (!configuration.metrics.length) configuration.metrics = ['bookings'];
  const operation = async (work: () => Promise<void>) => {
    lastAction.current = work;
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action failed. Try again.');
    } finally {
      setBusy(false);
    }
  };
  async function loadView(view: ReportView) {
    const result = await reportRequest<{ view: ReportView; workspace: ReportWorkspace }>(
      `${root}/views/${view.id}/workspace`,
    );
    setSelectedView(result.view);
    setQuery(result.workspace.query);
    setDisplay(view.configuration.display);
    setChartMetric(view.configuration.chartMetric);
  }
  async function exportReport(
    columns: string[],
    ids?: string[],
    copy = false,
    format: 'csv' | 'print' = 'csv',
    target: 'rows' | 'series' = 'rows',
  ) {
    if (!data) return;
    const result = await reportRequest<ReportExport>(root + '/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: data.query,
        columns,
        rowIds: ids,
        format,
        target,
        expectedFingerprint: data.meta.fingerprint,
      }),
    });
    void queryClient.invalidateQueries({
      queryKey: ['dashboard', 'report-exports', tenantId, propertyId],
    });
    if (format === 'print') {
      setPrint(JSON.parse(result.content) as PrintReport);
      return;
    }
    if (copy) {
      await navigator.clipboard.writeText(result.content);
      return;
    }
    const url = URL.createObjectURL(new Blob([result.content], { type: result.contentType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  const errorPanel = (e: unknown, retry: () => void) => (
    <ErrorPanel
      title={
        e instanceof ReportRequestError && e.status === 403
          ? 'Report access unavailable'
          : 'Report unavailable'
      }
      description={e instanceof Error ? e.message : undefined}
      reference={e instanceof ReportRequestError ? e.reference : undefined}
      onRetry={retry}
    />
  );
  const choose = (
    label: string,
    value: string,
    options: { value: string; label: string }[],
    onChange: (value: string) => void,
  ) => (
    <FormField label={label} className="min-w-0">
      <Combobox
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        triggerClassName="w-full min-w-0 text-left"
      />
    </FormField>
  );
  const options = (values: string[]) =>
    values.map((value) => ({ value, label: reportLabel(value) }));
  const filter = (
    label: string,
    key: keyof ReportQuery,
    values: { value: string; label: string }[],
  ) =>
    choose(label, String(query[key] ?? 'all'), [{ value: 'all', label: 'All' }, ...values], (v) =>
      change({
        [key]: v === 'all' ? undefined : v,
        ...(key === 'roomTypeId' ? { roomId: undefined } : {}),
      }),
    );
  const noDimensions =
    query.report === 'operations' || (query.report === 'pricing' && query.detail === 'issues');
  const financial = Array.isArray(data?.summary.financial)
    ? (data.summary.financial as Record<string, unknown>[])
    : [];
  const showTiles = selectedView ? selectedView.configuration.metrics : tiles[query.report];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="Hotel performance from stored evidence, with clear dates, definitions and currencies."
        actions={
          <>
            <ReportDefinitions tenantId={tenantId} propertyId={propertyId} />
            {data && !reviewsTab ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                  Save current view
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void operation(() =>
                      exportReport(
                        visibleColumns.length
                          ? visibleColumns
                          : data.columns.slice(0, 7).map((c) => c.key),
                        undefined,
                        false,
                        'print',
                      ),
                    )
                  }
                >
                  Print report
                </Button>
                <Button
                  variant="outline"
                  disabled={reports.isFetching}
                  onClick={() => void reports.refetch()}
                >
                  Refresh
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <TabBar
        label="Report categories"
        tabs={[
          ...Object.entries(reportNames).map(([id, label]) => ({ id, label })),
          { id: 'reviews', label: 'Guest reviews' },
          { id: 'custom', label: 'Custom views' },
        ]}
        current={reviewsTab ? 'reviews' : custom ? 'custom' : query.report}
        onSelect={(id) => {
          setReviewsTab(id === 'reviews');
          setCustom(id === 'custom');
          if (id !== 'custom' && id !== 'reviews') switchReport(id as ReportKind);
        }}
      />
      {reviewsTab ? <GuestReviewReport tenantId={tenantId} propertyId={propertyId} /> : null}
      {!reviewsTab ? (
        <>
          {custom ? (
            <Card>
              <CardHeader>
                <CardTitle>Saved hotel views</CardTitle>
                <CardDescription>
                  Private to the creator or shared with this hotel team. Execution uses your current
                  permissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {views.isPending ? (
                  <ListSkeleton />
                ) : views.isError ? (
                  errorPanel(views.error, () => void views.refetch())
                ) : (
                  <RecordDirectory
                    exportable={false}
                    rows={views.data.views}
                    storageKey={`must.reports.views.${propertyId}`}
                    columns={[
                      { id: 'name', label: 'Name', value: (v) => v.name },
                      { id: 'visibility', label: 'Visibility', value: (v) => v.visibility },
                      {
                        id: 'report',
                        label: 'Base report',
                        value: (v) => reportNames[v.configuration.query.report],
                      },
                      { id: 'updated', label: 'Last changed', value: (v) => v.updatedAt },
                    ]}
                    onRow={(view) => void operation(() => loadView(view))}
                    emptyTitle="No saved views yet"
                    actions={(view) => [
                      {
                        label: 'Open report',
                        onSelect: () => void operation(() => loadView(view)),
                      },
                      {
                        label: 'Duplicate as private',
                        onSelect: () =>
                          void operation(async () => {
                            await writer.current(`${root}/views/${view.id}/duplicate`, 'POST', {
                              version: view.version,
                            });
                            await views.refetch();
                          }),
                      },
                      ...(view.canEdit
                        ? [
                            {
                              label: 'Edit view',
                              onSelect: () =>
                                void operation(async () => {
                                  await loadView(view);
                                  setEditing(view);
                                }),
                            },
                            { label: 'Delete view', onSelect: () => setDeleting(view) },
                          ]
                        : []),
                    ]}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}
          {custom ? (
            <ReportExportHistory key={propertyId} tenantId={tenantId} propertyId={propertyId} />
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Action unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              <Button
                variant="outline"
                className="col-start-2 mt-2 justify-self-start"
                disabled={busy}
                onClick={() =>
                  lastAction.current
                    ? void operation(lastAction.current)
                    : document.getElementById('report-from')?.focus()
                }
              >
                {lastAction.current ? 'Try action again' : 'Change dates'}
              </Button>
            </Alert>
          ) : null}
          <Card>
            <CardContent className="pt-5">
              <form
                className="flex flex-col gap-4"
                aria-label="Report date filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    !from ||
                    !to ||
                    from > to ||
                    (Date.parse(to) - Date.parse(from)) / 86400000 >= 366
                  ) {
                    lastAction.current = null;
                    setError('Choose a valid range of 1 to 366 days.');
                    return;
                  }
                  change({ from, to });
                }}
              >
                <FilterGrid>
                  <FormField label="From" htmlFor="report-from">
                    <DateField
                      id="report-from"
                      aria-label="Report start date"

                      value={from}
                      onChange={(date) => setFrom(date)}
                    />
                  </FormField>
                  <FormField label="To" htmlFor="report-to">
                    <DateField
                      id="report-to"
                      aria-label="Report end date"

                      value={to}
                      onChange={(date) => setTo(date)}
                    />
                  </FormField>
                  <Button type="submit">Apply range</Button>
                  {data
                    ? choose(
                        'Date preset',
                        'custom',
                        [
                          { value: 'custom', label: 'Custom range' },
                          { value: 'today', label: 'Today' },
                          { value: 'week', label: 'Last 7 days' },
                          { value: 'last30', label: 'Last 30 days' },
                          { value: 'month', label: 'This month' },
                        ],
                        (v) => v !== 'custom' && change(reportPreset(data.meta.today, v)),
                      )
                    : null}
                  {choose(
                    'Compare',
                    query.comparison ?? 'none',
                    [
                      { value: 'none', label: 'No comparison' },
                      { value: 'previous', label: 'Previous period' },
                      { value: 'year', label: 'Same period last year' },
                    ],
                    (v) => change({ comparison: v }),
                  )}
                  {choose(
                    'Group by',
                    query.group ?? 'day',
                    [
                      { value: 'day', label: 'Day' },
                      { value: 'week', label: 'Week (Monday)' },
                      { value: 'month', label: 'Month' },
                    ],
                    (v) => change({ group: v }),
                  )}
                </FilterGrid>
              </form>
              {data ? (
                <FilterGrid className="mt-4">
                  {custom
                    ? choose(
                        'Base report',
                        query.report,
                        Object.entries(reportNames).map(([value, label]) => ({ value, label })),
                        (v) => switchReport(v as ReportKind),
                      )
                    : null}
                  {!noDimensions ? (
                    <>
                      {filter('Room type', 'roomTypeId', data.facets.roomTypes)}
                      {data.facets.rooms.length
                        ? filter(
                            'Room',
                            'roomId',
                            data.facets.rooms.filter(
                              (r) => !query.roomTypeId || r.roomTypeId === query.roomTypeId,
                            ),
                          )
                        : null}
                      {filter('Rate plan', 'ratePlanId', data.facets.ratePlans)}
                      {filter(
                        'Status',
                        'status',
                        options([
                          'DRAFT',
                          'PAYMENT_PENDING',
                          'PAYMENT_FAILED',
                          'QUOTED',
                          'INVENTORY_REVALIDATING',
                          'PAYMENT_NOT_REQUIRED',
                          'PMS_CREATION_PENDING',
                          'PMS_CONFIRMATION_PENDING',
                          'PMS_UNKNOWN_RESULT',
                          'PMS_REJECTED',
                          'MANUAL_REVIEW',
                          'AVAILABILITY_FAILED',
                          'CONFIRMED',
                          'CANCELLED',
                          'EXPIRED',
                        ]),
                      )}
                      {filter(
                        'Payment method',
                        'paymentMethod',
                        options(['STRIPE_CHECKOUT', 'POKPAY', 'PAY_AT_HOTEL', 'FREE']),
                      )}
                      {filter('Source', 'source', [
                        { value: 'DIRECT', label: 'Staff flow' },
                        { value: 'WEBSITE', label: 'Website' },
                        { value: 'UNKNOWN', label: 'Unknown' },
                      ])}
                      {filter(
                        'Booking mode',
                        'bookingMode',
                        options(['ROOM_TYPE_ONLY', 'INDIVIDUAL_ROOM_ONLY', 'MIXED']),
                      )}
                      {filter(
                        'Currency',
                        'currency',
                        data.facets.currencies.map((value) => ({ value, label: value })),
                      )}
                    </>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedView(null);
                      setQuery((q) => ({
                        report: q.report,
                        from: q.from,
                        to: q.to,
                        comparison: q.comparison,
                        group: q.group,
                      }));
                    }}
                  >
                    Clear filters
                  </Button>
                </FilterGrid>
              ) : null}
            </CardContent>
          </Card>
          {reports.isPending ? (
            <ListSkeleton />
          ) : reports.isError ? (
            errorPanel(reports.error, () => void reports.refetch())
          ) : data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-xl font-bold">
                  {selectedView?.name ?? reportNames[query.report]}
                </h3>
                <Badge variant="secondary">
                  {data.meta.source === 'CLOCK' ? 'Synced from Clock' : 'MUST local data'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Time zone: {data.meta.timezone}. Last updated{' '}
                  {new Date(data.meta.asOf).toLocaleString(undefined, {
                    timeZone: data.meta.timezone,
                  })}
                </span>
              </div>
              {['overview', 'occupancy', 'accommodation', 'pricing'].includes(query.report) &&
              !data.meta.coverage.supplyKnown ? (
                <p className="m-0 text-sm text-muted-foreground">
                  {data.meta.source === 'CLOCK'
                    ? 'Stock and occupancy are managed in Clock.'
                    : 'Historical room capacity was not recorded for these dates.'}
                </p>
              ) : null}
              {(data.meta.coverage.unknownNightlyBookings > 0 ||
                data.meta.coverage.invalidStays > 0) &&
              ['overview', 'revenue', 'occupancy', 'accommodation', 'guests'].includes(
                query.report,
              ) ? (
                <Alert variant="warning">
                  <AlertTitle>Incomplete stored evidence</AlertTitle>
                  <AlertDescription>
                    {data.meta.coverage.unknownNightlyBookings} reservations have no recorded
                    nightly prices; {data.meta.coverage.invalidStays} have invalid stay dates.
                  </AlertDescription>
                  <Button
                    className="col-start-2 mt-2 justify-self-start"
                    variant="outline"
                    onClick={() => switchReport('quality')}
                  >
                    Review data quality
                  </Button>
                </Alert>
              ) : null}
              {!data.meta.hasData ? (
                <EmptyPanel
                  title="No recorded activity for this report"
                  description="No matching records for these dates and filters."
                />
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {showTiles
                  .filter(
                    (key) =>
                      data.summary[key] !== undefined &&
                      data.summary[key] !== null &&
                      (typeof data.summary[key] !== 'object' || data.summary[key] === null),
                  )
                  .map((key) => (
                    <StatTile
                      key={key}
                      label={reportLabel(key)}
                      value={reportValue(
                        data.summary[key],
                        key.toLowerCase().includes('rate') || key === 'occupancy'
                          ? 'percent'
                          : undefined,
                      )}
                      note={
                        data.comparison
                          ? data.comparison.hasData
                            ? `Comparison: ${reportValue(data.comparison.summary?.[key])}`
                            : undefined
                          : undefined
                      }
                      onClick={
                        data.meta.drilldowns[key]
                          ? () => {
                              setSelectedView(null);
                              setQuery(data.meta.drilldowns[key]);
                            }
                          : undefined
                      }
                    />
                  ))}
              </div>
              {financial.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {financial.flatMap((row) =>
                    [
                      'roomRevenue',
                      'collected',
                      'refunded',
                      'netCollected',
                      'adr',
                      'revpar',
                      'outstanding',
                      'collectionRate',
                    ]
                      .filter(
                        (key) =>
                          row[key] !== null &&
                          row[key] !== undefined &&
                          (!selectedView || selectedView.configuration.metrics.includes(key)),
                      )
                      .map((key) => {
                        const prior = (
                          data.comparison?.summary?.financial as
                            Record<string, unknown>[] | undefined
                        )?.find((r) => r.currency === row.currency);
                        return (
                          <StatTile
                            key={`${row.currency}:${key}`}
                            label={`${reportLabel(key)} - ${row.currency}`}
                            value={
                              key === 'collectionRate' ? (
                                reportValue(row[key], 'percent')
                              ) : (
                                <HotelMoney
                                  tenantId={tenantId}
                                  propertyId={propertyId}
                                  amount={String(row[key])}
                                  currency={String(row.currency)}
                                />
                              )
                            }
                            note={
                              data.comparison ? (
                                data.comparison.hasData ? (
                                  <>
                                    Comparison:{' '}
                                    {prior?.[key] == null ? (
                                      'Unknown'
                                    ) : key === 'collectionRate' ? (
                                      reportValue(prior[key], 'percent')
                                    ) : (
                                      <HotelMoney
                                        tenantId={tenantId}
                                        propertyId={propertyId}
                                        amount={String(prior[key])}
                                        currency={String(row.currency)}
                                      />
                                    )}
                                  </>
                                ) : undefined
                              ) : key === 'roomRevenue' ? (
                                'Accrual by stay night; mandatory charges excluded.'
                              ) : (
                                'See Definitions for the date and cohort basis.'
                              )
                            }
                            onClick={() => {
                              setSelectedView(null);
                              setQuery({
                                ...data.query,
                                report: key === 'outstanding' ? 'revenue' : 'reservations',
                                detail: key === 'outstanding' ? 'balances' : 'default',
                                rowBasis: ['roomRevenue', 'adr', 'revpar'].includes(key)
                                  ? 'stay'
                                  : 'payment',
                                currency: String(row.currency),
                                page: 1,
                                sort: '',
                              });
                            }}
                          />
                        );
                      }),
                  )}
                </div>
              ) : null}
              {data.comparison && !data.comparison.hasData ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    No matching activity for comparison ({data.comparison.from} to{' '}
                    {data.comparison.to}
                    ).
                  </span>
                  <Button
                    variant="outline"
                    onClick={() => document.getElementById('report-from')?.focus()}
                  >
                    Change dates
                  </Button>
                </div>
              ) : null}
              {metric ? (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    {choose(
                      'Trend metric',
                      metric.key,
                      metricColumns.map((c) => ({ value: c.key, label: c.label })),
                      setChartMetric,
                    )}
                    <Button
                      variant={display === 'chart' ? 'default' : 'outline'}
                      aria-pressed={display === 'chart'}
                      onClick={() => setDisplay('chart')}
                    >
                      Chart
                    </Button>
                    <Button
                      variant={display === 'table' ? 'default' : 'outline'}
                      aria-pressed={display === 'table'}
                      onClick={() => setDisplay('table')}
                    >
                      Table
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void operation(() =>
                          exportReport(
                            data.seriesColumns.map((c) => c.key),
                            undefined,
                            false,
                            'csv',
                            'series',
                          ),
                        )
                      }
                    >
                      Export trend table
                    </Button>
                  </div>
                  {display === 'chart' ? (
                    <ReportChart
                      rows={data.series}
                      column={metric}
                      comparison={data.comparison?.hasData ? data.comparison.series : undefined}
                    />
                  ) : (
                    <ReportBreakdown
                      moneyKeys={[
                        ...data.meta.definitions.filter((d) => d.money).map((d) => d.key),
                        ...data.columns
                          .filter((c) => c.money || c.type === 'money')
                          .map((c) => c.key),
                        ...data.seriesColumns
                          .filter((c) => c.money || c.type === 'money')
                          .map((c) => c.key),
                      ]}
                      title="Trend table"
                      value={data.series.map((row) =>
                        Object.fromEntries(
                          Object.entries(row).filter(([key]) => key !== 'id' && key !== 'href'),
                        ),
                      )}
                    />
                  )}
                </>
              ) : null}
              <Card>
                <CardHeader>
                  <CardTitle>Report detail</CardTitle>
                  <CardDescription>
                    Server-filtered, sortable records. Click a row for a quick peek or use its
                    record link.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {details[query.report]
                    ? choose(
                        'Detail table',
                        query.detail ?? (query.report === 'operations' ? 'emails' : 'default'),
                        options(
                          details[query.report].filter(
                            (v) =>
                              !(
                                query.report === 'operations' &&
                                v === 'staff' &&
                                !data.meta.staffActivityVisible
                              ) &&
                              !(
                                query.report === 'revenue' &&
                                v !== 'default' &&
                                !data.meta.moneyVisible
                              ),
                          ),
                        ),
                        (v) => {
                          const next: ReportQuery = { ...data.query, detail: v, sort: '', page: 1 };
                          if (v === 'issues')
                            for (const key of [
                              'roomTypeId',
                              'roomId',
                              'ratePlanId',
                              'status',
                              'paymentMethod',
                              'source',
                              'bookingMode',
                              'currency',
                            ] as const)
                              delete next[key];
                          setQuery(next);
                        },
                      )
                    : null}
                  {query.report === 'reservations'
                    ? choose(
                        'Reservation date basis',
                        query.rowBasis ?? 'created',
                        options([
                          'created',
                          'stay',
                          'arrival',
                          'departure',
                          'cancellation',
                          'payment',
                        ]),
                        (v) => change({ rowBasis: v }),
                      )
                    : null}
                  <ReportTable
                    key={`${query.report}:${query.detail ?? 'default'}:${reportSearch(data.query)}`}
                    rows={data.rows}
                    missingReason={(key) => reportMissingReason(key, data.meta.source)}
                    columns={data.columns}
                    initialColumns={selectedView?.configuration.columns}
                    storageKey={`must.reports.${propertyId}.${query.report}.${query.detail ?? 'default'}`}
                    {...data.pagination}
                    sort={data.query.sort || data.columns[0]?.key || ''}
                    direction={data.query.direction === 'desc' ? 'desc' : 'asc'}
                    onSort={(key) =>
                      change({
                        sort: key,
                        direction:
                          data.query.sort === key && data.query.direction === 'asc'
                            ? 'desc'
                            : 'asc',
                      })
                    }
                    onPage={(page) => change({ page })}
                    onPageSize={(pageSize) => change({ pageSize })}
                    onVisibleColumns={setVisibleColumns}
                    onExport={exportReport}
                  />
                </CardContent>
              </Card>
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {breakdowns[query.report]
                  .filter((key) => data.summary[key] !== undefined && data.summary[key] !== null)
                  .map((key) => (
                    <ReportBreakdown
                      moneyKeys={[
                        ...data.meta.definitions.filter((d) => d.money).map((d) => d.key),
                        ...data.columns
                          .filter((c) => c.money || c.type === 'money')
                          .map((c) => c.key),
                        ...data.seriesColumns
                          .filter((c) => c.money || c.type === 'money')
                          .map((c) => c.key),
                      ]}
                      key={key}
                      title={reportLabel(key)}
                      value={reportDisplayEvidence(data.summary[key])}
                    />
                  ))}
              </div>
            </>
          ) : null}
          {editing && data ? (
            <ReportViewEditor
              key={editing === true ? 'new' : editing.id}
              view={editing === true ? undefined : editing}
              configuration={configuration}
              columns={data.columns}
              metricColumns={metricColumns}
              onClose={() => setEditing(null)}
              onSave={async (body) => {
                const saved = await writer.current<ReportView>(
                  `${root}/views${editing === true ? '' : '/' + editing.id}`,
                  editing === true ? 'POST' : 'PATCH',
                  body,
                );
                if (editing !== true) setSelectedView({ ...saved, canEdit: true });
                await views.refetch();
              }}
            />
          ) : null}
          <ConfirmDialog
            open={!!deleting}
            onOpenChange={(open) => !open && setDeleting(null)}
            title="Delete saved view?"
            description="Only this saved configuration is removed. Bookings and report facts are unchanged."
            confirmLabel="Delete view"
            destructive
            onConfirm={async () => {
              await writer.current(`${root}/views/${deleting!.id}`, 'DELETE', {
                version: deleting!.version,
              });
              if (selectedView?.id === deleting!.id) setSelectedView(null);
              await views.refetch();
            }}
          />
        </>
      ) : null}
      <ReportPrint model={print} onClose={() => setPrint(null)} />
    </div>
  );
}
