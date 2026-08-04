'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';

import { EChart, type ChartOption } from './echart';
import { DashboardLoadingSkeleton } from './loading-skeleton';
import styles from './reports.module.css';

// Charts render to <canvas>, which cannot resolve CSS custom properties, so these mirror
// --must-color-ink / --must-color-success from packages/ui/src/styles.css.
const INK_COLOR = '#174c3c';
const SUCCESS_COLOR = '#027a48';

type PropertyReports = {
  from: string;
  to: string;
  occupancy: Array<{
    date: string;
    bookedRoomNights: number;
    availableRoomNights: number;
    rate: number | null;
  }>;
  bookingsCreated: Array<{ date: string; count: number }>;
  revenue: Array<{ date: string; currency: string; amount: string }>;
  cancellationRate: { createdBookings: number; cancelledBookings: number; rate: number | null };
};

type TooltipParam = {
  axisValueLabel?: string;
  name?: string;
  seriesName?: string;
  value?: unknown;
};

export function DashboardReports({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const reportsQuery = useQuery({
    queryKey: ['dashboard', 'reports', tenantId, propertyId, range],
    queryFn: async () => {
      const query = range
        ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
        : '';
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/reports${query}`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Unable to load reports.');
      return (await response.json()) as PropertyReports;
    },
  });

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!from || !to) {
      setFormError('Choose both a start and end date.');
      return;
    }
    if (from > to) {
      setFormError('The start date must be on or before the end date.');
      return;
    }
    setFormError(null);
    setRange({ from, to });
  }

  if (reportsQuery.isPending) return <DashboardLoadingSkeleton label="Loading reports…" />;
  if (reportsQuery.isError)
    return (
      <div className={styles.error} role="alert">
        <Text>{reportsQuery.error.message}</Text>
        <button onClick={() => void reportsQuery.refetch()} type="button">
          Retry
        </button>
      </div>
    );

  const reports = reportsQuery.data;

  return (
    <Stack className={styles.page} gap="lg">
      <header className={styles.heading}>
        <div>
          <Text className={styles.eyebrow} tone="secondary">
            PERFORMANCE REPORTING
          </Text>
          <Heading>Reports</Heading>
          <Text tone="secondary">
            Occupancy, booking activity, and payment revenue from {reports.from} to {reports.to}.
          </Text>
        </div>
        <form className={styles.dateRange} onSubmit={applyRange}>
          <label className="must-field">
            <span className="must-field__label">From</span>
            <input
              aria-label="Report start date"
              className="must-input"
              onChange={(event) => setFrom(event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label className="must-field">
            <span className="must-field__label">To</span>
            <input
              aria-label="Report end date"
              className="must-input"
              onChange={(event) => setTo(event.target.value)}
              type="date"
              value={to}
            />
          </label>
          <button className="must-button must-button--primary" type="submit">
            Apply range
          </button>
        </form>
      </header>
      {formError ? <Text className={styles.error}>{formError}</Text> : null}

      <section className={styles.summary} aria-label="Booking cancellation summary">
        <Card className={styles.summaryCard}>
          <Text tone="secondary">Cancellation rate</Text>
          <strong>{formatPercent(reports.cancellationRate.rate)}</strong>
          <Text tone="secondary">
            {reports.cancellationRate.cancelledBookings} cancelled of{' '}
            {reports.cancellationRate.createdBookings} bookings created
          </Text>
        </Card>
      </section>

      <OccupancyChart occupancy={reports.occupancy} />
      <BookingsChart bookingsCreated={reports.bookingsCreated} />
      <RevenueCharts revenue={reports.revenue} />
    </Stack>
  );
}

function OccupancyChart({ occupancy }: { occupancy: PropertyReports['occupancy'] }) {
  const option = useMemo<ChartOption>(
    () => ({
      grid: { left: 8, right: 16, top: 32, bottom: 28, outerBoundsContain: 'axisLabel' },
      legend: { data: ['Occupancy'] },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const [point] = (Array.isArray(params) ? params : [params]) as TooltipParam[];
          return `${point?.axisValueLabel ?? ''}<br/>${point?.seriesName}: ${formatNumber(point?.value)}%`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: occupancy.map((day) => day.date),
        axisLabel: { formatter: shortDate },
      },
      yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `${value}%` } },
      series: [
        {
          name: 'Occupancy',
          type: 'line',
          smooth: true,
          data: occupancy.map((day) => day.rate),
          color: INK_COLOR,
        },
      ],
    }),
    [occupancy],
  );

  return (
    <ReportChart
      title="Occupancy"
      description="Booked room-nights as a percentage of available room-nights."
    >
      <EChart option={option} />
      <ReportTable headers={['Date', 'Booked', 'Available', 'Occupancy']}>
        {occupancy.map((day) => (
          <tr key={day.date}>
            <td>{day.date}</td>
            <td>{day.bookedRoomNights}</td>
            <td>{day.availableRoomNights}</td>
            <td>{formatPercent(day.rate)}</td>
          </tr>
        ))}
      </ReportTable>
    </ReportChart>
  );
}

function BookingsChart({
  bookingsCreated,
}: {
  bookingsCreated: PropertyReports['bookingsCreated'];
}) {
  const option = useMemo<ChartOption>(
    () => ({
      grid: { left: 8, right: 16, top: 24, bottom: 28, outerBoundsContain: 'axisLabel' },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: bookingsCreated.map((day) => day.date),
        axisLabel: { formatter: shortDate },
      },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: 'Bookings',
          type: 'bar',
          data: bookingsCreated.map((day) => day.count),
          color: INK_COLOR,
        },
      ],
    }),
    [bookingsCreated],
  );

  return (
    <ReportChart title="Bookings created" description="New bookings created each day.">
      <EChart option={option} />
      <ReportTable headers={['Date', 'Bookings created']}>
        {bookingsCreated.map((day) => (
          <tr key={day.date}>
            <td>{day.date}</td>
            <td>{day.count}</td>
          </tr>
        ))}
      </ReportTable>
    </ReportChart>
  );
}

function RevenueCharts({ revenue }: { revenue: PropertyReports['revenue'] }) {
  const currencies = useMemo(
    () => Array.from(new Set(revenue.map((day) => day.currency))).sort(),
    [revenue],
  );
  return (
    <ReportChart
      title="Revenue"
      description="Succeeded charges minus refunds, shown separately for each currency."
    >
      <div className={styles.revenueCharts}>
        {currencies.map((currency) => (
          <CurrencyChart
            currency={currency}
            days={revenue.filter((day) => day.currency === currency)}
            key={currency}
          />
        ))}
      </div>
      <ReportTable headers={['Date', 'Currency', 'Revenue']}>
        {revenue.map((day) => (
          <tr key={`${day.date}-${day.currency}`}>
            <td>{day.date}</td>
            <td>{day.currency}</td>
            <td>{formatCurrency(day.amount, day.currency)}</td>
          </tr>
        ))}
      </ReportTable>
    </ReportChart>
  );
}

function CurrencyChart({ currency, days }: { currency: string; days: PropertyReports['revenue'] }) {
  const option = useMemo<ChartOption>(
    () => ({
      grid: { left: 8, right: 16, top: 24, bottom: 28, outerBoundsContain: 'axisLabel' },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const [point] = (Array.isArray(params) ? params : [params]) as TooltipParam[];
          return `${point?.axisValueLabel ?? ''}<br/>Revenue: ${formatCurrency(point?.value, currency)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: days.map((day) => day.date),
        axisLabel: { formatter: shortDate },
      },
      yAxis: { type: 'value' },
      series: [
        {
          name: 'Revenue',
          type: 'bar',
          data: days.map((day) => Number(day.amount)),
          color: SUCCESS_COLOR,
        },
      ],
    }),
    [days, currency],
  );

  return (
    <div className={styles.currencyChart}>
      <Text className={styles.currencyTitle}>{currency}</Text>
      <EChart height={260} option={option} />
    </div>
  );
}

function ReportChart({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={styles.chart}>
      <Heading level={2}>{title}</Heading>
      <Text className={styles.chartDescription} tone="secondary">
        {description}
      </Text>
      {children}
    </Card>
  );
}

function ReportTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 10) / 10}%`;
}

function formatNumber(value: unknown) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatCurrency(value: unknown, currency: string) {
  return `${currency} ${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(value: string) {
  return value.slice(5);
}
