'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import styles from './reports.module.css';

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

export function DashboardReports({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [reports, setReports] = useState<PropertyReports | null>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const query = range
      ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      : '';
    setReports(undefined);
    setError(null);
    void fetch(`/api/tenants/${tenantId}/properties/${propertyId}/reports${query}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load reports.');
        return (await response.json()) as PropertyReports;
      })
      .then((value) => {
        if (active) setReports(value);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setReports(null);
        setError(reason instanceof Error ? reason.message : 'Unable to load reports.');
      });
    return () => {
      active = false;
    };
  }, [propertyId, range, tenantId]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!from || !to) {
      setError('Choose both a start and end date.');
      return;
    }
    if (from > to) {
      setError('The start date must be on or before the end date.');
      return;
    }
    setRange({ from, to });
  }

  if (reports === undefined) return <Text>Loading reports…</Text>;
  if (!reports) return <Text className={styles.error}>{error}</Text>;

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
      {error ? <Text className={styles.error}>{error}</Text> : null}

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

      <ReportChart
        title="Occupancy"
        description="Booked room-nights as a percentage of available room-nights."
      >
        <ResponsiveContainer height={280} width="100%">
          <LineChart data={reports.occupancy} margin={{ left: -16, right: 12 }}>
            <CartesianGrid stroke="var(--must-color-border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={shortDate} />
            <YAxis tickFormatter={(value) => `${value}%`} />
            <Tooltip formatter={(value) => `${formatNumber(value)}%`} />
            <Legend />
            <Line dataKey="rate" name="Occupancy" stroke="var(--must-color-ink)" type="monotone" />
          </LineChart>
        </ResponsiveContainer>
        <ReportTable headers={['Date', 'Booked', 'Available', 'Occupancy']}>
          {reports.occupancy.map((day) => (
            <tr key={day.date}>
              <td>{day.date}</td>
              <td>{day.bookedRoomNights}</td>
              <td>{day.availableRoomNights}</td>
              <td>{formatPercent(day.rate)}</td>
            </tr>
          ))}
        </ReportTable>
      </ReportChart>

      <ReportChart title="Bookings created" description="New bookings created each day.">
        <ResponsiveContainer height={280} width="100%">
          <BarChart data={reports.bookingsCreated} margin={{ left: -16, right: 12 }}>
            <CartesianGrid stroke="var(--must-color-border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={shortDate} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="var(--must-color-ink)" name="Bookings" />
          </BarChart>
        </ResponsiveContainer>
        <ReportTable headers={['Date', 'Bookings created']}>
          {reports.bookingsCreated.map((day) => (
            <tr key={day.date}>
              <td>{day.date}</td>
              <td>{day.count}</td>
            </tr>
          ))}
        </ReportTable>
      </ReportChart>

      <RevenueCharts revenue={reports.revenue} />
    </Stack>
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
        {currencies.map((currency) => {
          const days = revenue
            .filter((day) => day.currency === currency)
            .map((day) => ({ ...day, numericAmount: Number(day.amount) }));
          return (
            <div className={styles.currencyChart} key={currency}>
              <Text className={styles.currencyTitle}>{currency}</Text>
              <ResponsiveContainer height={260} width="100%">
                <BarChart data={days} margin={{ left: -16, right: 12 }}>
                  <CartesianGrid stroke="var(--must-color-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={shortDate} />
                  <YAxis />
                  <Tooltip formatter={(value) => formatCurrency(value, currency)} />
                  <Bar dataKey="numericAmount" fill="var(--must-color-success)" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })}
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
