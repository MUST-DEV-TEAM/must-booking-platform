'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FinancialMetrics, type FinancialMetricRow } from '../../components/ui/financial-metrics';
import { FormField } from '../../components/ui/form-field';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../../components/ui/card';
import { ErrorPanel, ListSkeleton, EmptyPanel } from '../../components/ui/state-panel';
import { reportRequest, ReportRequestError } from '../../lib/report-presentation';
import { DateField } from '../../components/ui/date-field';
export type PaymentReportSummaryData = {
  query: { from: string; to: string };
  meta: { source: string; timezone: string; asOf: string; basis: string };
  financial: FinancialMetricRow[];
};
/** Payment headlines use the Reports backend kernel; operational ledger filters remain independent. */
export function PaymentReportSummary({
  tenantId,
  propertyId,
  onOutstanding,
  canOpenReports = false,
}: {
  tenantId: string;
  propertyId: string;
  onOutstanding: () => void;
  canOpenReports?: boolean;
}) {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['dashboard', 'payment-report-summary', tenantId, propertyId, range],
    queryFn: () =>
      reportRequest<PaymentReportSummaryData>(
        `/api/tenants/${tenantId}/properties/${propertyId}/payments/summary${range ? '?' + new URLSearchParams(range) : ''}`,
      ),
    retry: false,
  });
  useEffect(() => {
    if (query.data) {
      setFrom(query.data.query.from);
      setTo(query.data.query.to);
    }
  }, [query.data?.query.from, query.data?.query.to]);
  return (
    <Card aria-label="Payment totals">
      <CardHeader>
        <CardTitle>Payment report totals</CardTitle>
        <CardDescription>
          These totals use the selected period. The booking list below keeps its own filters.
          Collected and refunded use ledger posting dates; outstanding uses confirmed bookings
          created in this period.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !from ||
              !to ||
              from > to ||
              (Date.parse(to) - Date.parse(from)) / 86400000 >= 366
            ) {
              setError('Choose 1 to 366 valid days.');
              return;
            }
            setError('');
            setRange({ from, to });
          }}
        >
          <FormField label="Payment totals from" htmlFor="payment-totals-from">
            <DateField
              id="payment-totals-from"
              aria-label="Payment totals from"

              value={from}
              onChange={(date) => setFrom(date)}
            />
          </FormField>
          <FormField label="Payment totals to" htmlFor="payment-totals-to">
            <DateField
              id="payment-totals-to"
              aria-label="Payment totals to"

              value={to}
              onChange={(date) => setTo(date)}
            />
          </FormField>
          <Button type="submit">Apply totals period</Button>
        </form>
        {error ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorPanel
            title="Payment totals unavailable"
            description={query.error.message}
            reference={
              query.error instanceof ReportRequestError ? query.error.reference : undefined
            }
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <p className="m-0 text-xs text-muted-foreground">
              {query.data.meta.basis}. Time zone: {query.data.meta.timezone}. Last updated{' '}
              {new Date(query.data.meta.asOf).toLocaleString(undefined, {
                timeZone: query.data.meta.timezone,
              })}
              .
            </p>
            {query.data.financial.length ? (
              <FinancialMetrics
                rows={query.data.financial}
                interactiveKeys={canOpenReports ? undefined : ['outstanding']}
                onSelect={(key) => {
                  if (key === 'outstanding') onOutstanding();
                  else
                    window.location.assign(
                      `/dashboard/${tenantId}?propertyId=${propertyId}&section=reports`,
                    );
                }}
              />
            ) : (
              <EmptyPanel title="No financial activity for this period" />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
